# IoT Soil Monitor (Hardware Setup)

A physical IoT prototype built using an ESP32 microcontroller to monitor soil moisture, ambient temperature, and humidity. This repository documents the complete circuit design, hardware connections, and sensor calibration process. It serves as the data collection foundation for a future AI/ML prediction model.



## Hardware Components
* Microcontroller: ESP32 NodeMCU
* Sensors: 
  * DHT11 (Temperature & Humidity Sensor)
  * Capacitive Soil Moisture Sensor v1.2
* Connection Tools: Jumper wires & Breadboard
* Calibration Tool: A bowl of water

---

## Circuit & Wiring Guide

### 1. DHT11 Sensor Connections
* VCC -> ESP32 3.3V
* GND -> ESP32 GND
* DATA -> ESP32 GPIO 4

### 2. Capacitive Soil Moisture Sensor Connections
* VCC -> ESP32 3.3V
* GND -> ESP32 GND
* AOUT (Analog Out) -> ESP32 GPIO 34 (ADC1 Channel 6)

---

## Troubleshooting & Calibration Breakthrough
During the initial build, the soil moisture sensor consistently read a static value of 4095. 

### The Problem:
The ESP32 uses a 12-bit Analog-to-Digital Converter (ADC), meaning its raw reading range scales from 0 (0V) to 4095 (3.3V). In dry air, the sensor outputs maximum voltage, resulting in a constant 4095.

### The Solution:
To verify the sensor was working and find its operational range, I submerged the probe into a bowl of water. The reading successfully dropped and stabilized between 890 and 900. 

This established our calibration thresholds:
* Completely Dry: 4095
* Completely Wet: ~890

---

## Microcontroller Firmware
The system is programmed in C++ using the Arduino IDE. The script reads the raw data and maps the inverted 4095-890 ADC spectrum into a user-friendly 0-100% moisture scale.

```cpp
#include "DHT.h"

#define DHTPIN 4          // GPIO pin for DHT11
#define DHTTYPE DHT11
#define SOIL_PIN 34       // ADC pin for Soil Sensor

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);   // Start Serial communication
  dht.begin();            // Initialize DHT sensor
}

void loop() {
  float humidity = dht.readHumidity();
  float temperature = dht.readTemperature();
  int soilRaw = analogRead(SOIL_PIN);

  // Check if any sensor reads failed
  if (isnan(humidity) || isnan(temperature)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }

  // Map the inverted 4095 (dry) to 890 (wet) range into 0-100%
  int moisturePercent = map(soilRaw, 4095, 890, 0, 100);
  moisturePercent = constrain(moisturePercent, 0, 100);

  // Print results to the Serial Monitor
  Serial.print("Temp: "); Serial.print(temperature); Serial.print("C | ");
  Serial.print("Humidity: "); Serial.print(humidity); Serial.print("% | ");
  Serial.print("Soil Moisture: "); Serial.print(moisturePercent); Serial.println("%");

  delay(2000);            // Wait 2 seconds before next reading
}
```

---
## Next Steps
This hardware foundation will serve as the data collection node for a future repository, where I plan to implement Machine Learning models to predict soil dryness trends.
