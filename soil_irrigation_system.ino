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

  // Read temperature and humidity
  float temperature = dht.readTemperature();
  float humidity = dht.readHumidity();

  // Read soil moisture
  int soilMoisture = analogRead(SOIL_PIN);

  // Check if DHT11 reading failed
  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("Error: Failed to read from DHT11!");
    delay(2000);
    return;
  }

  // Display sensor values
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