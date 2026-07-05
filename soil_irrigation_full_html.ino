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