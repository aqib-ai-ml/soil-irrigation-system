

"use strict";

/* ============================================================================
 * 1. CONFIGURATION
 * ========================================================================== */

const CONFIG = Object.freeze({
  
  apiEndpoint: "/api/data",

  // How often we poll the device, in milliseconds.
  pollIntervalMs: 1000,

  // How many samples each graph keeps in its rolling window.
  // At a 1s poll rate this is a 2-minute window.
  historyLength: 120,

  // If this many consecutive requests fail, the dashboard switches to
  // an offline simulator so the UI remains demonstrable without hardware.
  maxConsecutiveFailuresBeforeFallback: 4,

  // Network timeout for a single fetch, in milliseconds.
  requestTimeoutMs: 2500,

  // Sensible physical bounds + alert thresholds. These mirror constants
  // that would normally live in the firmware (config.h) so the UI can
  // reason about "is this value concerning" without server round-trips.
  thresholds: {
    temperature: { min: 0, max: 50, highWarn: 32, highDanger: 38 },
    humidity: { min: 0, max: 100, lowWarn: 35, lowDanger: 20 },
    soil: { min: 0, max: 100, dryWarn: 30, dryDanger: 15 },
  },
});

/* ============================================================================
 * 2. UTILITIES
 * ========================================================================== */

/**
 * Clamp a number between [min, max].
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Format a number for display, guarding against null/undefined/NaN.
 */
function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "--";
  return value.toFixed(decimals);
}

/**
 * Compute a "nice" step size for axis labels (1, 2, 5, 10, 20, 50 ... pattern)
 * so gridlines land on human-friendly numbers instead of ugly fractions.
 */
function niceStep(roughStep) {
  if (roughStep <= 0) return 1;
  const exponent = Math.floor(Math.log10(roughStep));
  const fraction = roughStep / Math.pow(10, exponent);
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * Math.pow(10, exponent);
}

/**
 * Format a Date as HH:MM:SS (24h), used on the header clock and x-axis labels.
 */
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Format a duration in milliseconds as e.g. "2h 14m 03s".
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}

/* ============================================================================
 * 3. DATA SERIES — rolling buffer + statistics for a single metric
 * ========================================================================== */

class DataSeries {
  /**
   * @param {number} capacity - maximum number of samples retained.
   */
  constructor(capacity) {
    this.capacity = capacity;
    /** @type {{ t: number, v: number }[]} */
    this.samples = [];
  }

  /** Append a new sample, discarding the oldest once capacity is exceeded. */
  push(value, timestamp = Date.now()) {
    if (value === null || value === undefined || Number.isNaN(value)) return;
    this.samples.push({ t: timestamp, v: value });
    if (this.samples.length > this.capacity) {
      this.samples.shift();
    }
  }

  /** Most recent value, or null if empty. */
  get latest() {
    if (this.samples.length === 0) return null;
    return this.samples[this.samples.length - 1].v;
  }

  get isEmpty() {
    return this.samples.length === 0;
  }

  /** Compute current/average/min/max in a single pass. */
  getStatistics() {
    if (this.isEmpty) {
      return { current: null, average: null, min: null, max: null };
    }
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (const { v } of this.samples) {
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      current: this.latest,
      average: sum / this.samples.length,
      min,
      max,
    };
  }
}

/* ============================================================================
 * 4. GRAPH RENDERER — reusable Canvas 2D chart engine
 * ========================================================================== */

/**
 * GraphRenderer draws a single time-series line chart onto a <canvas>.
 * It is intentionally data-source agnostic: call `render(samples)` any
 * time new data is available and it redraws from scratch. This keeps the
 * class simple to reason about (no incremental-diffing state machine)
 * while still being fast enough for a 1-second refresh rate.
 *
 * Features implemented per spec:
 *   - Smooth curve via quadratic Bezier midpoint smoothing
 *   - Gradient fill under the curve
 *   - Auto-scaling Y axis with "nice" rounded steps
 *   - Dynamic Y-axis and X-axis (time) labels
 *   - Background grid lines
 *   - Latest-value marker with a soft glow
 *   - High-DPI aware resizing (crisp on Retina / mobile screens)
 */
class GraphRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @param {string} options.color        - CSS color used for the line/fill/marker.
   * @param {string} [options.unit]        - Unit suffix shown on Y-axis labels.
   * @param {number} [options.fixedMin]    - Force a fixed Y-axis minimum (e.g. 0 for %).
   * @param {number} [options.fixedMax]    - Force a fixed Y-axis maximum (e.g. 100 for %).
   * @param {number} [options.decimals]    - Decimal places for Y-axis labels.
   * @param {boolean} [options.isBoolean]  - Render as a 0/1 ON-OFF series instead of a continuous value.
   */
  constructor(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.options = {
      color: "#4fd6ff",
      unit: "",
      decimals: 1,
      isBoolean: false,
      ...options,
    };

    // Cached device-pixel-ratio-aware canvas size, recomputed on resize.
    this.cssWidth = 0;
    this.cssHeight = 0;

    this._handleResize = this._handleResize.bind(this);
    this._observeResize();
  }

  /** Keep the canvas backing store in sync with its CSS box + device pixel ratio. */
  _observeResize() {
    const resizeObserver = new ResizeObserver(() => this._handleResize());
    resizeObserver.observe(this.canvas);
    this._handleResize();
  }

  _handleResize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    // Avoid churn when the element is temporarily hidden (rect === 0).
    if (rect.width === 0 || rect.height === 0) return;

    this.cssWidth = rect.width;
    this.cssHeight = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);

    // All subsequent drawing is done in CSS pixel units.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (this._lastSamples) this.render(this._lastSamples);
  }

  /**
   * Redraw the chart for the given samples.
   * @param {{ t: number, v: number }[]} samples
   */
  render(samples) {
    this._lastSamples = samples; // retained so resize can trigger a redraw
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (!width || !height) return;

    ctx.clearRect(0, 0, width, height);

    if (!samples || samples.length === 0) {
      this._drawEmptyState(width, height);
      return;
    }

    const layout = this._computeLayout(width, height);
    const { min: yMin, max: yMax } = this._computeYRange(samples);

    this._drawGrid(layout, yMin, yMax);
    this._drawYAxisLabels(layout, yMin, yMax);
    this._drawXAxisLabels(layout, samples);

    const points = this._mapSamplesToPoints(samples, layout, yMin, yMax);
    this._drawAreaFill(points, layout);
    this._drawSmoothLine(points);
    this._drawLatestMarker(points[points.length - 1]);
  }

  /** Reserve margins for axis labels around the plotting area. */
  _computeLayout(width, height) {
    const margin = { top: 14, right: 12, bottom: 22, left: this.options.isBoolean ? 40 : 38 };
    return {
      margin,
      plotX: margin.left,
      plotY: margin.top,
      plotWidth: width - margin.left - margin.right,
      plotHeight: height - margin.top - margin.bottom,
    };
  }

  /** Determine the Y-axis range, either fixed (e.g. percentages) or auto-scaled. */
  _computeYRange(samples) {
    if (this.options.isBoolean) {
      return { min: -0.15, max: 1.15 };
    }

    if (
      this.options.fixedMin !== undefined &&
      this.options.fixedMax !== undefined
    ) {
      return { min: this.options.fixedMin, max: this.options.fixedMax };
    }

    let min = Infinity;
    let max = -Infinity;
    for (const { v } of samples) {
      if (v < min) min = v;
      if (v > max) max = v;
    }

    // Guard against a perfectly flat series (min === max) by padding.
    if (min === max) {
      min -= 1;
      max += 1;
    }

    // Add ~12% headroom above and below so the curve never touches the frame.
    const padding = (max - min) * 0.12;
    return { min: min - padding, max: max + padding };
  }

  /** Convert data samples into pixel coordinates within the plot area. */
  _mapSamplesToPoints(samples, layout, yMin, yMax) {
    const { plotX, plotY, plotWidth, plotHeight } = layout;
    const n = samples.length;
    return samples.map((sample, i) => {
      const x = n === 1 ? plotX + plotWidth : plotX + (i / (n - 1)) * plotWidth;
      const t = (sample.v - yMin) / (yMax - yMin);
      const y = plotY + plotHeight - clamp(t, 0, 1) * plotHeight;
      return { x, y, raw: sample };
    });
  }

  /** Horizontal + a light vertical grid, drawn behind everything else. */
  _drawGrid(layout, yMin, yMax) {
    const { ctx } = this;
    const { plotX, plotY, plotWidth, plotHeight } = layout;
    const step = niceStep((yMax - yMin) / 4);
    const firstLine = Math.ceil(yMin / step) * step;

    ctx.save();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;

    for (let value = firstLine; value <= yMax; value += step) {
      const t = (value - yMin) / (yMax - yMin);
      const y = plotY + plotHeight - t * plotHeight;
      ctx.beginPath();
      ctx.moveTo(plotX, Math.round(y) + 0.5);
      ctx.lineTo(plotX + plotWidth, Math.round(y) + 0.5);
      ctx.stroke();
    }

    // Frame the plot area faintly so it reads as a contained chart.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.strokeRect(plotX + 0.5, plotY + 0.5, plotWidth - 1, plotHeight - 1);
    ctx.restore();
  }

  _drawYAxisLabels(layout, yMin, yMax) {
    const { ctx } = this;
    const { plotX, plotY, plotHeight } = layout;
    const step = niceStep((yMax - yMin) / 4);
    const firstLine = Math.ceil(yMin / step) * step;

    ctx.save();
    ctx.fillStyle = "rgba(164, 173, 192, 0.85)";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    if (this.options.isBoolean) {
      // Only two meaningful labels for a boolean series.
      const onY = plotY + plotHeight - ((1 - yMin) / (yMax - yMin)) * plotHeight;
      const offY = plotY + plotHeight - ((0 - yMin) / (yMax - yMin)) * plotHeight;
      ctx.fillText("ON", plotX - 8, onY);
      ctx.fillText("OFF", plotX - 8, offY);
      ctx.restore();
      return;
    }

    for (let value = firstLine; value <= yMax; value += step) {
      const t = (value - yMin) / (yMax - yMin);
      const y = plotY + plotHeight - t * plotHeight;
      const label = value.toFixed(step < 1 ? 1 : 0);
      ctx.fillText(label, plotX - 8, y);
    }
    ctx.restore();
  }

  /** Show a handful of evenly-spaced HH:MM:SS labels beneath the plot. */
  _drawXAxisLabels(layout, samples) {
    const { ctx } = this;
    const { plotX, plotWidth, plotY, plotHeight } = layout;
    const labelCount = Math.min(4, samples.length);
    if (labelCount < 2) return;

    ctx.save();
    ctx.fillStyle = "rgba(164, 173, 192, 0.75)";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let i = 0; i < labelCount; i++) {
      const sampleIndex = Math.round((i / (labelCount - 1)) * (samples.length - 1));
      const sample = samples[sampleIndex];
      const x = plotX + (sampleIndex / (samples.length - 1 || 1)) * plotWidth;
      const label = formatTime(new Date(sample.t)).slice(0, 5); // HH:MM
      ctx.fillText(label, clamp(x, plotX + 14, plotX + plotWidth - 14), plotY + plotHeight + 6);
    }
    ctx.restore();
  }

  /**
   * Draw a smooth line through `points` using quadratic curves between
   * successive midpoints. This is the standard "midpoint smoothing"
   * technique: each segment's control point is the raw data point, and
   * the curve passes through the midpoints between consecutive points,
   * producing a continuous, kink-free line without needing a full spline.
   */
  _buildSmoothPath(points) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let i = 1; i < points.length - 1; i++) {
      const current = points[i];
      const next = points[i + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    // Final segment goes straight into the last real point.
    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  _drawSmoothLine(points) {
    if (points.length < 2) {
      // Single point: draw a dot instead of a degenerate line.
      this._drawLatestMarker(points[0]);
      return;
    }
    const { ctx } = this;
    ctx.save();
    this._buildSmoothPath(points);
    ctx.strokeStyle = this.options.color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = this.options.color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }

  /** Fill the area under the smooth line with a vertical gradient. */
  _drawAreaFill(points, layout) {
    if (points.length < 2) return;
    const { ctx } = this;
    const { plotY, plotHeight } = layout;
    const floorY = plotY + plotHeight;

    ctx.save();
    this._buildSmoothPath(points);
    ctx.lineTo(points[points.length - 1].x, floorY);
    ctx.lineTo(points[0].x, floorY);
    ctx.closePath();

    const gradient = ctx.createLinearGradient(0, plotY, 0, floorY);
    gradient.addColorStop(0, this._withAlpha(this.options.color, 0.35));
    gradient.addColorStop(1, this._withAlpha(this.options.color, 0.02));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  /** Highlight the most recent sample with a glowing dot. */
  _drawLatestMarker(point) {
    if (!point) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = this.options.color;
    ctx.shadowColor = this.options.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();

    // Outer ring for extra emphasis.
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawEmptyState(width, height) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = "rgba(164, 173, 192, 0.6)";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Waiting for data\u2026", width / 2, height / 2);
    ctx.restore();
  }

  /** Convert a "#rrggbb" color into an rgba() string with the given alpha. */
  _withAlpha(hexColor, alpha) {
    const hex = hexColor.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
}

/* ============================================================================
 * 5. ALERT ENGINE — derives human-readable alerts from live readings
 * ========================================================================== */

class AlertEngine {
  /**
   * @param {Object} thresholds - CONFIG.thresholds
   */
  constructor(thresholds) {
    this.thresholds = thresholds;
  }

  /**
   * Evaluate the latest readings and return an ordered list of alerts.
   * Each alert: { severity: 'info'|'success'|'warning'|'danger', message: string }
   * More severe conditions are listed first.
   */
  evaluate({ temperature, humidity, soil, irrigation }) {
    const alerts = [];
    const t = this.thresholds;

    if (temperature !== null) {
      if (temperature >= t.temperature.highDanger) {
        alerts.push({ severity: "danger", message: `Critical temperature: ${formatNumber(temperature)}\u00b0C. Check ventilation immediately.` });
      } else if (temperature >= t.temperature.highWarn) {
        alerts.push({ severity: "warning", message: `Temperature is elevated at ${formatNumber(temperature)}\u00b0C.` });
      }
    }

    if (humidity !== null) {
      if (humidity <= t.humidity.lowDanger) {
        alerts.push({ severity: "danger", message: `Humidity critically low at ${formatNumber(humidity)}%.` });
      } else if (humidity <= t.humidity.lowWarn) {
        alerts.push({ severity: "warning", message: `Humidity is low at ${formatNumber(humidity)}%.` });
      }
    }

    if (soil !== null) {
      if (soil <= t.soil.dryDanger) {
        alerts.push({ severity: "danger", message: `Soil is very dry (${formatNumber(soil, 0)}%). Irrigation recommended.` });
      } else if (soil <= t.soil.dryWarn) {
        alerts.push({ severity: "warning", message: `Soil moisture is trending low (${formatNumber(soil, 0)}%).` });
      }
    }

    if (irrigation) {
      alerts.push({ severity: "info", message: "Irrigation is currently active." });
    }

    if (alerts.length === 0) {
      alerts.push({ severity: "success", message: "All readings are within normal range." });
    }

    // Danger > warning > info > success, so the most urgent item appears first.
    const severityRank = { danger: 0, warning: 1, info: 2, success: 3 };
    alerts.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
    return alerts;
  }
}

/* ============================================================================
 * 6. SENSOR SIMULATOR — offline fallback so the UI is demoable without hardware
 * ========================================================================== */

class SensorSimulator {
  constructor() {
    this.temperature = 26;
    this.humidity = 55;
    this.soil = 45;
    this.startedAt = Date.now();
  }

  /** Produce the next synthetic reading using a gentle random walk. */
  next() {
    const wander = (value, delta, min, max) => clamp(value + (Math.random() - 0.5) * delta, min, max);

    this.temperature = wander(this.temperature, 0.6, 18, 34);
    this.humidity = wander(this.humidity, 1.2, 30, 80);
    this.soil = wander(this.soil, 1.0, 10, 90);

    return {
      temperature: this.temperature,
      humidity: this.humidity,
      soil: this.soil,
      irrigation: this.soil < 30,
      uptime: Date.now() - this.startedAt,
    };
  }
}

/* ============================================================================
 * 7. IRRIGATION DASHBOARD — top-level controller
 * ========================================================================== */

class IrrigationDashboard {
  constructor() {
    this._cacheDom();

    // One rolling data series per metric. `irrigation` is stored as 0/1
    // so it can reuse the exact same GraphRenderer as the numeric metrics.
    this.series = {
      temperature: new DataSeries(CONFIG.historyLength),
      humidity: new DataSeries(CONFIG.historyLength),
      soil: new DataSeries(CONFIG.historyLength),
      irrigation: new DataSeries(CONFIG.historyLength),
    };

    this.alertEngine = new AlertEngine(CONFIG.thresholds);
    this.simulator = new SensorSimulator();

    this.consecutiveFailures = 0;
    this.usingSimulatedData = false;
    this.startedAt = Date.now();

    this._initGraphs();
    this._startClock();
    this._startPolling();
  }

  /** Grab every DOM element we'll touch, once, up front. */
  _cacheDom() {
    this.dom = {
      connectionIndicator: document.getElementById("connectionIndicator"),
      connectionLabel: document.getElementById("connectionLabel"),
      headerClock: document.getElementById("headerClock"),

      tempValue: document.getElementById("tempValue"),
      tempRange: document.getElementById("tempRange"),
      tempBar: document.getElementById("tempBar"),

      humidityValue: document.getElementById("humidityValue"),
      humidityRange: document.getElementById("humidityRange"),
      humidityBar: document.getElementById("humidityBar"),

      soilValue: document.getElementById("soilValue"),
      soilRange: document.getElementById("soilRange"),
      soilBar: document.getElementById("soilBar"),

      statusLamp: document.getElementById("statusLamp"),
      statusText: document.getElementById("statusText"),
      statusDescription: document.getElementById("statusDescription"),

      alertList: document.getElementById("alertList"),

      statTempCurrent: document.getElementById("statTempCurrent"),
      statTempAvg: document.getElementById("statTempAvg"),
      statTempMin: document.getElementById("statTempMin"),
      statTempMax: document.getElementById("statTempMax"),

      statHumidityCurrent: document.getElementById("statHumidityCurrent"),
      statHumidityAvg: document.getElementById("statHumidityAvg"),
      statHumidityMin: document.getElementById("statHumidityMin"),
      statHumidityMax: document.getElementById("statHumidityMax"),

      statSoilCurrent: document.getElementById("statSoilCurrent"),
      statSoilAvg: document.getElementById("statSoilAvg"),
      statSoilMin: document.getElementById("statSoilMin"),
      statSoilMax: document.getElementById("statSoilMax"),

      footerUptime: document.getElementById("footerUptime"),
      footerLastUpdate: document.getElementById("footerLastUpdate"),
    };
  }

  /** Instantiate one GraphRenderer per canvas. */
  _initGraphs() {
    this.graphs = {
      temperature: new GraphRenderer(document.getElementById("tempCanvas"), {
        color: "#ff8a5c",
        unit: "\u00b0C",
        decimals: 1,
      }),
      humidity: new GraphRenderer(document.getElementById("humidityCanvas"), {
        color: "#4fd6ff",
        unit: "%",
        fixedMin: 0,
        fixedMax: 100,
        decimals: 0,
      }),
      soil: new GraphRenderer(document.getElementById("soilCanvas"), {
        color: "#5cf2b0",
        unit: "%",
        fixedMin: 0,
        fixedMax: 100,
        decimals: 0,
      }),
      irrigation: new GraphRenderer(document.getElementById("statusCanvas"), {
        color: "#b98cff",
        isBoolean: true,
      }),
    };
  }

  /** Header clock ticks independently of the poll loop for a smooth 1s tick. */
  _startClock() {
    const tick = () => {
      this.dom.headerClock.textContent = formatTime(new Date());
    };
    tick();
    setInterval(tick, 1000);
  }

  /** Kick off the recurring fetch-and-render loop. */
  _startPolling() {
    this._pollOnce();
    setInterval(() => this._pollOnce(), CONFIG.pollIntervalMs);
  }

  async _pollOnce() {
    try {
      const reading = this.usingSimulatedData
        ? this.simulator.next()
        : await this._fetchReading();

      this.consecutiveFailures = 0;
      this._setConnectionState(this.usingSimulatedData ? "simulated" : "online");
      this._ingestReading(reading);
    } catch (error) {
      this.consecutiveFailures += 1;

      if (this.consecutiveFailures >= CONFIG.maxConsecutiveFailuresBeforeFallback) {
        this.usingSimulatedData = true;
        this._ingestReading(this.simulator.next());
        this._setConnectionState("simulated");
      } else {
        this._setConnectionState("offline");
      }
    }
  }

  /** Fetch one reading from the ESP32, aborting if it takes too long. */
  async _fetchReading() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

    try {
      const response = await fetch(CONFIG.apiEndpoint, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Push a new reading into every series and refresh the entire UI. */
  _ingestReading(reading) {
    const now = Date.now();
    const temperature = clamp(reading.temperature, CONFIG.thresholds.temperature.min, CONFIG.thresholds.temperature.max);
    const humidity = clamp(reading.humidity, CONFIG.thresholds.humidity.min, CONFIG.thresholds.humidity.max);
    const soil = clamp(reading.soil, CONFIG.thresholds.soil.min, CONFIG.thresholds.soil.max);
    const irrigationOn = Boolean(reading.irrigation);

    this.series.temperature.push(temperature, now);
    this.series.humidity.push(humidity, now);
    this.series.soil.push(soil, now);
    this.series.irrigation.push(irrigationOn ? 1 : 0, now);

    this._renderSensorCards();
    this._renderGraphs();
    this._renderStatistics();
    this._renderIrrigationStatus(irrigationOn, soil);
    this._renderAlerts({ temperature, humidity, soil, irrigation: irrigationOn });
    this._renderFooter(reading.uptime, now);
  }

  /* ---- Rendering: sensor summary cards ---------------------------------- */

  _renderSensorCards() {
    const tempStats = this.series.temperature.getStatistics();
    const humidityStats = this.series.humidity.getStatistics();
    const soilStats = this.series.soil.getStatistics();

    this.dom.tempValue.textContent = formatNumber(tempStats.current, 1);
    this.dom.tempRange.textContent = `${formatNumber(tempStats.min, 1)}\u2013${formatNumber(tempStats.max, 1)}\u00b0C`;
    this.dom.tempBar.style.width = `${clamp((tempStats.current / CONFIG.thresholds.temperature.max) * 100, 0, 100)}%`;

    this.dom.humidityValue.textContent = formatNumber(humidityStats.current, 0);
    this.dom.humidityRange.textContent = `${formatNumber(humidityStats.min, 0)}\u2013${formatNumber(humidityStats.max, 0)}%`;
    this.dom.humidityBar.style.width = `${clamp(humidityStats.current, 0, 100)}%`;

    this.dom.soilValue.textContent = formatNumber(soilStats.current, 0);
    this.dom.soilRange.textContent = `${formatNumber(soilStats.min, 0)}\u2013${formatNumber(soilStats.max, 0)}%`;
    this.dom.soilBar.style.width = `${clamp(soilStats.current, 0, 100)}%`;
  }

  /* ---- Rendering: graphs -------------------------------------------------- */

  _renderGraphs() {
    this.graphs.temperature.render(this.series.temperature.samples);
    this.graphs.humidity.render(this.series.humidity.samples);
    this.graphs.soil.render(this.series.soil.samples);
    this.graphs.irrigation.render(this.series.irrigation.samples);
  }

  /* ---- Rendering: statistics table --------------------------------------- */

  _renderStatistics() {
    const write = (prefix, stats, decimals) => {
      this.dom[`${prefix}Current`].textContent = formatNumber(stats.current, decimals);
      this.dom[`${prefix}Avg`].textContent = formatNumber(stats.average, decimals);
      this.dom[`${prefix}Min`].textContent = formatNumber(stats.min, decimals);
      this.dom[`${prefix}Max`].textContent = formatNumber(stats.max, decimals);
    };

    write("statTemp", this.series.temperature.getStatistics(), 1);
    write("statHumidity", this.series.humidity.getStatistics(), 0);
    write("statSoil", this.series.soil.getStatistics(), 0);
  }

  /* ---- Rendering: irrigation status card ---------------------------------- */

  _renderIrrigationStatus(irrigationOn, soil) {
    let state = "idle";
    let text = "IDLE";
    let description = "System is monitoring soil moisture. No action needed right now.";

    if (irrigationOn) {
      state = "watering";
      text = "WATERING";
      description = "Pump is active — soil moisture dropped below the irrigation threshold.";
    } else if (soil !== null && soil <= CONFIG.thresholds.soil.dryDanger) {
      state = "alert";
      text = "ATTENTION";
      description = "Soil is critically dry but irrigation has not engaged. Check the pump/relay.";
    }

    this.dom.statusLamp.dataset.state = state;
    this.dom.statusText.textContent = text;
    this.dom.statusDescription.textContent = description;
  }

  /* ---- Rendering: alerts --------------------------------------------------- */

  _renderAlerts(latestReadings) {
    const alerts = this.alertEngine.evaluate(latestReadings);

    this.dom.alertList.innerHTML = "";
    for (const alert of alerts) {
      const item = document.createElement("li");
      item.className = `alert-item alert-${alert.severity}`;

      const dot = document.createElement("span");
      dot.className = "alert-dot";

      const message = document.createElement("span");
      message.className = "alert-message";
      message.textContent = alert.message;

      item.append(dot, message);
      this.dom.alertList.appendChild(item);
    }
  }

  /* ---- Rendering: footer + connection state -------------------------------- */

  _renderFooter(deviceUptimeMs, lastUpdateTimestamp) {
    const uptime = typeof deviceUptimeMs === "number" ? deviceUptimeMs : Date.now() - this.startedAt;
    this.dom.footerUptime.textContent = formatDuration(uptime);
    this.dom.footerLastUpdate.textContent = formatTime(new Date(lastUpdateTimestamp));
  }

  _setConnectionState(state) {
    // 'online' -> live ESP32 data, 'simulated' -> offline fallback, 'offline' -> retrying.
    const labels = {
      online: "Connected",
      simulated: "Offline \u2014 demo data",
      offline: "Reconnecting\u2026",
    };
    // The CSS only defines rules for online/connecting/offline; simulated
    // reuses the "connecting" (amber) look to signal "not the real device".
    const cssState = state === "online" ? "online" : state === "simulated" ? "connecting" : "offline";
    this.dom.connectionIndicator.dataset.state = cssState;
    this.dom.connectionLabel.textContent = labels[state];
  }
}

/* ============================================================================
 * 8. BOOTSTRAP
 * ========================================================================== */

document.addEventListener("DOMContentLoaded", () => {
  // Attached to window purely for debugging convenience in devtools
  // (e.g. `dashboard.series.soil.samples` while developing).
  window.dashboard = new IrrigationDashboard();
});