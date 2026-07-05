# Smart IoT Soil Monitoring System

An IoT-based environmental monitoring system built using an ESP32 that measures soil moisture, temperature, and humidity in real time. This project serves as the hardware and data collection foundation for a future AI/ML-powered smart irrigation system capable of predicting soil dryness and optimizing watering schedules.

---

# Project Overview

This project uses an ESP32 microcontroller to continuously collect environmental data from multiple sensors.

The current system monitors:

* Soil Moisture
* Temperature
* Air Humidity

Sensor data is displayed through the Arduino Serial Monitor and will later be transmitted over Wi-Fi to a web dashboard for visualization and machine learning analysis.

---



# Hardware Components

| Component                  | Description                              |
| -------------------------- | ---------------------------------------- |
| ESP32 DevKit V1            | Main microcontroller                     |
| DHT11 Sensor               | Temperature and humidity sensor          |
| HW-080 Soil Moisture Probe | Soil moisture sensing                    |
| HW-103 Comparator Module   | Interfaces the soil probe with the ESP32 |
| Breadboard                 | Circuit prototyping                      |
| Jumper Wires               | Electrical connections                   |
| USB Cable                  | Programming and power                    |

---

# Circuit Connections

## DHT11 Sensor

| DHT11 Pin | ESP32  |
| --------- | ------ |
| VCC       | 3.3V   |
| GND       | GND    |
| DATA      | GPIO 4 |

## Soil Moisture Sensor

### HW-103 Module → ESP32

| Module Pin | ESP32   |
| ---------- | ------- |
| VCC        | 3.3V    |
| GND        | GND     |
| AO         | GPIO 34 |

### HW-080 Probe → HW-103

The two-wire soil moisture probe connects directly to the HW-103 comparator module.

---

# Software

* Arduino IDE
* C++
* ESP32 Arduino Core

Libraries used:

* DHT Sensor Library
* Adafruit Unified Sensor

---

# Firmware

```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <DHT.h>

#define DHTPIN 4
#define DHTTYPE DHT11
#define SOIL_PIN 34

const char* ssid = "Smart-Irrigation-System";
const char* password = "12345678";

DHT dht(DHTPIN, DHTTYPE);
WebServer server(80);

// ---------- SOIL READ ----------
int readSoil() {
  long sum = 0;

  for (int i = 0; i < 10; i++) {
    sum += analogRead(SOIL_PIN);
    delay(5);
  }

  return sum / 10;
}

// ---------- MOISTURE ----------
int getMoisturePercent(int soil) {
  int percent = map(soil, 4095, 1500, 0, 100);
  return constrain(percent, 0, 100);
}

// ---------- SAFE DHT ----------
float safeTemp() {
  float t = dht.readTemperature();
  if (isnan(t)) return 0;
  return t;
}

float safeHum() {
  float h = dht.readHumidity();
  if (isnan(h)) return 0;
  return h;
}

// ---------- HTML ----------
String getHTML() {
  return R"rawliteral(

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Smart Irrigation Control</title>

<style>

/* 🌌 BACKGROUND */
body {
  margin: 0;
  font-family: 'Segoe UI', sans-serif;
  background: radial-gradient(circle at top, #0f172a, #000000);
  color: white;
  overflow-x: hidden;
}

/* ✨ GRID BACKGROUND */
body::before {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-image: linear-gradient(rgba(0,255,150,0.05) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0,255,150,0.05) 1px, transparent 1px);
  background-size: 50px 50px;
  animation: moveGrid 8s linear infinite;
  z-index: 0;
}

@keyframes moveGrid {
  0% { transform: translateY(0); }
  100% { transform: translateY(50px); }
}

/* HEADER */
.header {
  text-align: center;
  padding: 25px;
  position: relative;
  z-index: 1;
}

.header h1 {
  font-size: 28px;
  letter-spacing: 2px;
  color: #00ffcc;
  text-shadow: 0 0 20px #00ffcc;
}

/* LIVE DOT */
.live {
  display: inline-block;
  width: 10px;
  height: 10px;
  background: #00ff88;
  border-radius: 50%;
  margin-left: 10px;
  animation: pulse 1.2s infinite;
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(0,255,150,0.7); }
  70% { box-shadow: 0 0 0 10px rgba(0,255,150,0); }
  100% { box-shadow: 0 0 0 0 rgba(0,255,150,0); }
}

/* GRID */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  max-width: 1000px;
  margin: auto;
  padding: 20px;
  position: relative;
  z-index: 1;
}

/* GLASS CARD */
.card {
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(0,255,200,0.2);
  border-radius: 16px;
  padding: 25px;
  text-align: center;
  box-shadow: 0 0 20px rgba(0,255,200,0.1);
  transition: 0.3s ease;
}

.card:hover {
  transform: translateY(-8px);
  box-shadow: 0 0 30px rgba(0,255,200,0.4);
}

/* VALUE */
.value {
  font-size: 34px;
  font-weight: bold;
  color: #00ffcc;
  text-shadow: 0 0 10px #00ffcc;
  margin-top: 10px;
}

/* LABEL */
.label {
  color: #aaa;
  font-size: 14px;
}

/* STATUS */
.status {
  text-align: center;
  margin-top: 20px;
  font-size: 20px;
  color: #00ff88;
  text-shadow: 0 0 10px #00ff88;
  position: relative;
  z-index: 1;
}

</style>
</head>

<body>

<div class="header">
  <h1>Smart Irrigation Control System <span class="live"></span></h1>
</div>

<div class="grid">

  <div class="card">
    <div class="label">Temperature</div>
    <div class="value"><span id="temp">--</span> °C</div>
  </div>

  <div class="card">
    <div class="label">Humidity</div>
    <div class="value"><span id="hum">--</span> %</div>
  </div>

  <div class="card">
    <div class="label">Soil Moisture</div>
    <div class="value"><span id="soil">--</span> %</div>
  </div>

</div>

<div class="status">
Status: <span id="status">Loading...</span>
</div>

<script>

async function updateData() {
  try {
    const res = await fetch("/data");
    const data = await res.json();

    document.getElementById("temp").innerText = data.temp;
    document.getElementById("hum").innerText = data.hum;
    document.getElementById("soil").innerText = data.soil;
    document.getElementById("status").innerText = data.status;
  } catch (e) {
    console.log("Waiting for ESP32...");
  }
}

setInterval(updateData, 2000);
updateData();

</script>

</body>
</html>

)rawliteral";
}

// ---------- ROOT ----------
void handleRoot() {
  server.send(200, "text/html", getHTML());
}

// ---------- DATA API ----------
void handleData() {

  float temp = safeTemp();
  float hum = safeHum();

  int soilRaw = readSoil();
  int soil = getMoisturePercent(soilRaw);

  String status;
  if (soil < 30) status = "Dry";
  else if (soil < 70) status = "Moderate";
  else status = "Good";

  String json = "{";
  json += "\"temp\":" + String(temp,1) + ",";
  json += "\"hum\":" + String(hum,1) + ",";
  json += "\"soil\":" + String(soil) + ",";
  json += "\"status\":\"" + status + "\"";
  json += "}";

  server.send(200, "application/json", json);
}

// ---------- SETUP ----------
void setup() {

  Serial.begin(115200);
  dht.begin();

  WiFi.softAP(ssid, password);

  Serial.println("WiFi Started");
  Serial.println(WiFi.softAPIP());

  server.on("/", handleRoot);
  server.on("/data", handleData);

  server.begin();
}

// ---------- LOOP ----------
void loop() {
  server.handleClient();
}
```

---

# Sensor Calibration

The ESP32 uses a 12-bit Analog-to-Digital Converter (ADC), producing values between:

```
0 to 4095
```

During testing, the soil moisture sensor produced the following approximate readings:

| Condition                | ADC Reading |
| ------------------------ | ----------: |
| Dry Probe                |       ~4095 |
| Moist Soil               |  ~1500–2500 |
| Wet Soil                 |   ~900–1200 |
| Probe Submerged in Water |        ~890 |

These values were obtained experimentally and may vary depending on the soil type, probe condition, and supply voltage.

---

# Example Output

```text
========================================
Smart Environmental Monitoring System
========================================

----------------------------------------
Temperature: 29.90 °C
Humidity: 60.00 %
Soil Moisture: 929

----------------------------------------
Temperature: 30.10 °C
Humidity: 60.20 %
Soil Moisture: 1105

----------------------------------------
Temperature: 30.00 °C
Humidity: 59.80 %
Soil Moisture: 947
```

---

# Project Structure

```text
soil-irrigation-system/
│
├── README.md
├── SmartSoilMonitor.ino
├── images/
│   ├── hardware.jpg
│   ├── wiring.png
│   └── serial-monitor.png
└── docs/
```

---

# Future Development

## Phase 1 (Completed)

* ESP32 setup
* Sensor integration
* Serial monitoring
* Sensor calibration

## Phase 2

* Wi-Fi communication
* Live web dashboard
* Real-time charts
* Data logging

## Phase 3

* Relay module integration
* Automatic irrigation
* Water pump control
* Soil moisture thresholds

## Phase 4

Machine Learning integration:

* Predict soil drying trends
* Forecast irrigation timing
* Learn environmental patterns
* Reduce water consumption
* Intelligent irrigation recommendations

---

# Technologies Used

Current:

* ESP32
* Arduino IDE
* Embedded C++
* IoT
* Serial Communication

Planned:

* HTML
* CSS
* JavaScript
* Python
* Flask or FastAPI
* Pandas
* NumPy
* Scikit-learn
* Machine Learning

---

# Future Vision

This project is the first stage of building a complete AI-powered Smart Irrigation System.

The final system will:

* Collect environmental data in real time.
* Store historical sensor readings.
* Display live data on a web dashboard.
* Predict future soil moisture using machine learning.
* Automatically irrigate plants only when necessary.
* Optimize water usage while maintaining healthy plant growth.

---

# Author

**Aqib Azaad**

AI | Machine Learning | IoT | Embedded Systems

Building intelligent systems that combine hardware, software, and artificial intelligence.
