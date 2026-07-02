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
#include <DHT.h>

#define DHTPIN 4
#define DHTTYPE DHT11
#define SOIL_PIN 34

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();

  delay(2000);

  Serial.println("========================================");
  Serial.println(" Smart Environmental Monitoring System");
  Serial.println("========================================");
}

void loop() {

  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  int soilMoisture = analogRead(SOIL_PIN);

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Error: Failed to read from DHT11!");
    delay(2000);
    return;
  }

  Serial.println("----------------------------------------");

  Serial.print("Temperature: ");
  Serial.print(temperature);
  Serial.println(" °C");

  Serial.print("Humidity: ");
  Serial.print(humidity);
  Serial.println(" %");

  Serial.print("Soil Moisture: ");
  Serial.println(soilMoisture);

  delay(2000);
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
