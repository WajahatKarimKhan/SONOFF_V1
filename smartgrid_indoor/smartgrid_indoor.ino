/*
 * FYP: Smart Gridx - Node B (SPAN PANEL / HOUSE SIDE)
 */

#include <WiFi.h>
#include <WebSocketsClient.h>
#include <ArduinoJson.h>
#include <PZEM004Tv30.h>
#include <DHT.h>

// ================= CONFIGURATION =================
const char* ssid = "WAJI NIAZI";
const char* password = "idontknow";

// UPDATED: Render URL (Backend)
const char* websocket_server_host = "smartgridxbackend.onrender.com"; 
const uint16_t websocket_server_port = 443; // UPDATED: 443 for SSL
const char* websocket_path = "/ws/hardware/house"; 

const char* DEVICE_ID = "span_panel";

// Pins
#define PZEM_RX_PIN 16 
#define PZEM_TX_PIN 17
#define PZEM_SERIAL Serial2
const int RELAY_PINS[4] = {18, 19, 21, 22}; 
#define DHTPIN 4
#define DHTTYPE DHT11

PZEM004Tv30 pzem(PZEM_SERIAL, PZEM_RX_PIN, PZEM_TX_PIN);
WebSocketsClient webSocket;
DHT dht(DHTPIN, DHTTYPE);

unsigned long lastSendTime = 0;
const unsigned long sendInterval = 2000;
bool relayStates[4] = {false, false, false, false}; 

void setup() {
  Serial.begin(115200);

  // Relays
  for(int i=0; i<4; i++) {
    pinMode(RELAY_PINS[i], OUTPUT);
    digitalWrite(RELAY_PINS[i], HIGH); // Active LOW -> HIGH is OFF
    relayStates[i] = false;
  }
  
  dht.begin();

  // WiFi
  Serial.print("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while(WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.println(" Connected!");

  // UPDATED: SSL
  webSocket.beginSSL(websocket_server_host, websocket_server_port, websocket_path);
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000);
}

void loop() {
  webSocket.loop();

  if (millis() - lastSendTime > sendInterval) {
    sendDataAndState();
    lastSendTime = millis();
  }
}

void sendDataAndState() {
  float v = pzem.voltage();
  float i = pzem.current();
  float p = pzem.power();
  float e = pzem.energy();
  float pf = pzem.pf();
  float temp = dht.readTemperature(); 

  if(isnan(v)) v = 0.0;
  if(isnan(temp)) temp = 25.0; 

  DynamicJsonDocument doc(2048);
  doc["node_id"] = DEVICE_ID;
  doc["type"] = "span_panel";
  
  JsonObject sensors = doc.createNestedObject("sensors");
  sensors["voltage"] = v;
  sensors["current"] = i;
  sensors["power"] = p;
  sensors["energy"] = e;
  sensors["pf"] = pf;
  sensors["temperature"] = temp;

  JsonArray relays = doc.createNestedArray("relays");
  for(int k=0; k<4; k++) relays.add(relayStates[k]);

  String output;
  serializeJson(doc, output);
  
  webSocket.sendTXT(output);
}

void webSocketEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch(type) {
    case WStype_DISCONNECTED:
      Serial.println("Disconnected!");
      break;
    case WStype_CONNECTED:
      Serial.println("Connected to Server");
      break;
    case WStype_TEXT:
      handleCommand((char*)payload);
      break;
  }
}

void handleCommand(char* jsonMsg) {
  DynamicJsonDocument doc(1024);
  DeserializationError error = deserializeJson(doc, jsonMsg);

  if (!error) {
    const char* action = doc["action"];
    if (strcmp(action, "set_relay") == 0) {
      int idx = doc["relay_index"];
      bool state = doc["state"];

      if(idx >= 0 && idx < 4) {
        digitalWrite(RELAY_PINS[idx], state ? LOW : HIGH); // Active LOW
        relayStates[idx] = state;
        sendDataAndState(); 
      }
    }
  }
}