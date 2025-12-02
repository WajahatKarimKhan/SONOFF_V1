/*
 * FYP: Smart Gridx - Node A (POLE / GRID SIDE)
 * Role: Reference Energy Monitor
 * Hardware: ESP32 + PZEM-004T v3.0
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>

// ================= CONFIGURATION =================
const char* ssid = "WAJI NIAZI";
const char* password = "idontknow";

// UPDATED: Render URL (Backend)
const char* websocket_server_host = "smartgridxbackend.onrender.com"; 
const uint16_t websocket_server_port = 443; // UPDATED: 443 for SSL
const char* websocket_path = "/ws/hardware/pole"; 

const char* DEVICE_ID = "Grid_node";

#define PZEM_RX_PIN 16 
#define PZEM_TX_PIN 17
#define PZEM_SERIAL Serial2

PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);
WebSocketsClient webSocket;

unsigned long lastSendTime = 0;
const unsigned long sendInterval = 2000;

void setup() {
  Serial.begin(115200);
  
  // Connect to WiFi
  Serial.print("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while(WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(" Connected!");

  // UPDATED: Use SSL for Render
  webSocket.beginSSL(websocket_server_host, websocket_server_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  
  // Optional: Increase timeouts for stability
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop(); 

  if (millis() - lastSendTime > sendInterval) {
    sendSensorData();
    lastSendTime = millis();
  }
}

void sendSensorData() {
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  if (isnan(voltage)) voltage = 0.0; 

  DynamicJsonDocument doc(1024);
  doc["node_id"] = DEVICE_ID;
  doc["type"] = "grid_monitor"; 
  doc["voltage"] = voltage;
  doc["current"] = current;
  doc["power"] = power;
  doc["energy"] = energy;
  doc["frequency"] = frequency;
  doc["pf"] = pf;

  String jsonString;
  serializeJson(doc, jsonString);

  Serial.print("Sending: ");
  Serial.println(jsonString);
  webSocket.sendTXT(jsonString);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.printf("[%s] Disconnected!\n", DEVICE_ID);
      break;
    case WStype_CONNECTED:
      Serial.printf("[%s] Connected to server\n", DEVICE_ID);
      break;
    case WStype_TEXT:
      Serial.printf("[%s] Received: %s\n", DEVICE_ID, payload);
      break;
    case WStype_ERROR:
      Serial.printf("[%s] Error!\n", DEVICE_ID);
      break;
  }
}