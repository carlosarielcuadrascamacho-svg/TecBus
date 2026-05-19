/*
=============================================================================
  SMARTBUS / TECBUS — FIRMWARE UNIFICADO
  GPS Tracker + Lector RFID MFRC522 + Store & Forward Offline
=============================================================================

  CONEXIONES:

    NEO M8N (GPS):
      VCC  -> VIN (5V) del ESP32
      GND  -> GND
      TX   -> GPIO 16 (RX2)
      RX   -> GPIO 17 (TX2)

    MFRC522 (RFID):
      3.3V -> 3.3V del ESP32 (NUNCA 5V)
      GND  -> GND
      SDA  -> GPIO 5
      RST  -> GPIO 22
      SCK  -> GPIO 18
      MISO -> GPIO 19
      MOSI -> GPIO 23

    LEDS:
      LED_VERDE (pago ok)     -> GPIO 25
      LED_ROJO  (offline/err) -> GPIO 26
      LED_AZUL  (sync ok)     -> GPIO 27
      LED_BUILTIN (estado)    -> GPIO 2

  LIBRERIAS REQUERIDAS (PlatformIO / Arduino IDE):
    - TinyGPSPlus  (Mikal Hart)
    - ArduinoJson  (Benoit Blanchon)
    - MFRC522      (Miguel Balboa)
=============================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <TinyGPSPlus.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>

// =========================================================================
//  CONFIGURACION — CAMBIA SEGUN TU RED Y CAMION
// =========================================================================

const char* WIFI_SSID  = "TecBus_Hotspot";
const char* WIFI_PASS  = "conductor123";

const char* SERVER_URL  = "https://tecbus-api.onrender.com";
const char* API_KEY     = "sm4rtbus_p4g0s_2026";
const char* BUS_ID      = "U001";

const unsigned long INTERVALO_GPS_MS = 10000; // 10 segundos entre envios GPS

// =========================================================================
//  PINES
// =========================================================================

static const int RX2_PIN       = 16;
static const int TX2_PIN       = 17;

static const int RFID_SS_PIN   = 5;
static const int RFID_RST_PIN  = 22;

static const int LED_VERDE     = 25;
static const int LED_ROJO      = 26;
static const int LED_AZUL      = 27;
static const int LED_BUILTIN   = 2;

// =========================================================================
//  OBJETOS GLOBALES
// =========================================================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);
MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);

// Estados del LED
enum EstadoLED {
  ESPERANDO_WIFI,
  ESPERANDO_GPS,
  ENVIANDO_DATOS,
  ERROR_CONEXION
};
EstadoLED estadoLED = ESPERANDO_WIFI;

unsigned long ultimoEnvioGPS  = 0;
unsigned long ultimoParpadeo  = 0;
bool ledEstado = false;

// =========================================================================
//  BUFFER STORE & FORWARD
// =========================================================================

struct TransaccionPendiente {
  String uid;
  String rutaId;
  int cantidad;
  String camionId;
  unsigned long timestamp;
};

std::vector<TransaccionPendiente> colaPendientes;
static const size_t MAX_BUFFER = 50;

// =========================================================================
//  SETUP
// =========================================================================

void setup() {
  Serial.begin(115200);
  Serial.println(F("\n=========================================="));
  Serial.println(F("  SMARTBUS - ESP32 GPS + RFID + PAGOS"));
  Serial.println(F("=========================================="));

  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_ROJO, OUTPUT);
  pinMode(LED_AZUL, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);
  digitalWrite(LED_VERDE, LOW);
  digitalWrite(LED_ROJO, LOW);
  digitalWrite(LED_AZUL, LOW);

  // GPS UART2
  gpsSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Serial.println(F("[GPS] UART2 iniciado (RX=GPIO16, TX=GPIO17)"));

  // RFID SPI
  SPI.begin();
  mfrc522.PCD_Init();
  Serial.println(F("[RFID] MFRC522 iniciado (SPI)"));

  conectarWiFi();
}

// =========================================================================
//  LOOP PRINCIPAL
// =========================================================================

void loop() {
  // 1. GPS — no bloqueante
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }

  // 2. RFID — chequeo de tarjeta
  if (mfrc522.PICC_IsNewCardPresent() && mfrc522.PICC_ReadCardSerial()) {
    String uidStr = bytesToHex(mfrc522.uid.uidByte, mfrc522.uid.size);
    Serial.printf("[RFID] Tarjeta detectada: %s\n", uidStr.c_str());

    String rutaActual = obtenerRutaActual();

    if (WiFi.status() == WL_CONNECTED) {
      bool ok = enviarPago(uidStr, rutaActual, 1);
      if (ok) {
        encenderLED(LED_VERDE, 1000);
        Serial.println("[PAGO] Online — OK");
      } else {
        pushBuffer(uidStr, rutaActual, 1);
        encenderLED(LED_ROJO, 500);
        Serial.println("[PAGO] Online — fallo, guardado en buffer");
      }
    } else {
      pushBuffer(uidStr, rutaActual, 1);
      encenderLED(LED_ROJO, 500);
      Serial.println("[PAGO] Offline — guardado en buffer");
    }

    mfrc522.PICC_HaltA();
  }

  // 3. Store & Forward — sincronizar buffer si hay WiFi
  if (WiFi.status() == WL_CONNECTED && !colaPendientes.empty()) {
    Serial.printf("[SYNC] %d pendientes — sincronizando...\n", colaPendientes.size());
    bool ok = enviarBatch();
    if (ok) {
      colaPendientes.clear();
      encenderLED(LED_AZUL, 2000);
      Serial.println("[SYNC] Batch enviado correctamente — buffer limpio");
    } else {
      Serial.println("[SYNC] Fallo en batch — reintentara en proxima iteracion");
    }
  }

  // 4. Enviar ubicacion GPS cada INTERVALO_GPS_MS
  unsigned long ahora = millis();
  if (ahora - ultimoEnvioGPS >= INTERVALO_GPS_MS) {
    ultimoEnvioGPS = ahora;
    if (gps.location.isValid()) {
      enviarUbicacion();
    }
  }

  // 5. LED de estado
  actualizarLED();
}

// =========================================================================
//  WIFI
// =========================================================================

void conectarWiFi() {
  estadoLED = ESPERANDO_WIFI;
  Serial.printf("[WiFi] Conectando a %s...\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int intentos = 0;
  while (WiFi.status() != WL_CONNECTED && intentos < 40) {
    delay(500);
    Serial.print(".");
    intentos++;
    while (gpsSerial.available() > 0) {
      gps.encode(gpsSerial.read());
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("\n[WiFi] Fallo al conectar."));
  }
}

// =========================================================================
//  ENVIO DE UBICACION GPS (mismo codigo existente)
// =========================================================================

void enviarUbicacion() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/camiones/update-location";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<200> doc;
  doc["busId"] = BUS_ID;
  doc["lat"]   = gps.location.lat();
  doc["lng"]   = gps.location.lng();
  doc["speed"] = (int)gps.speed.kmph();

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.PUT(jsonData);

  if (httpCode == 200) {
    estadoLED = ENVIANDO_DATOS;
  } else {
    estadoLED = ERROR_CONEXION;
  }

  http.end();
}

// =========================================================================
//  ENVIO DE PAGO INDIVIDUAL (POST a /api/pagos/procesar)
// =========================================================================

bool enviarPago(const String& uid, const String& rutaId, int cantidad) {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/pagos/procesar";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  StaticJsonDocument<200> doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();
  obj["uid"]       = uid;
  obj["rutaId"]    = rutaId;
  obj["cantidad_boletos"] = cantidad;
  obj["camionId"]  = BUS_ID;
  obj["timestamp"] = millis() / 1000;

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  http.end();

  return (httpCode == 200);
}

// =========================================================================
//  ENVIO BATCH (todo el buffer en un solo POST)
// =========================================================================

bool enviarBatch() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/pagos/procesar";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  size_t capacidad = JSON_ARRAY_SIZE(colaPendientes.size())
                     + colaPendientes.size() * JSON_OBJECT_SIZE(5);
  DynamicJsonDocument doc(capacidad);
  JsonArray arr = doc.to<JsonArray>();

  for (const auto& t : colaPendientes) {
    JsonObject obj = arr.createNestedObject();
    obj["uid"]       = t.uid;
    obj["rutaId"]    = t.rutaId;
    obj["cantidad_boletos"] = t.cantidad;
    obj["camionId"]  = t.camionId;
    obj["timestamp"] = t.timestamp;
  }

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  http.end();

  return (httpCode == 200);
}

// =========================================================================
//  BUFFER — agregar a cola de pendientes
// =========================================================================

void pushBuffer(const String& uid, const String& rutaId, int cantidad) {
  if (colaPendientes.size() >= MAX_BUFFER) {
    Serial.println(F("[BUFFER] LLENO — descartando transaccion mas antigua"));
    colaPendientes.erase(colaPendientes.begin());
  }

  TransaccionPendiente t;
  t.uid       = uid;
  t.rutaId    = rutaId;
  t.cantidad  = cantidad;
  t.camionId  = BUS_ID;
  t.timestamp = millis() / 1000;

  colaPendientes.push_back(t);
  Serial.printf("[BUFFER] %d pendientes\n", colaPendientes.size());
}

// =========================================================================
//  OBTENER RUTA ACTUAL — el conductor programa esto segun la ruta
//  que esta recorriendo en ese momento (desde boton, potenciometro, etc)
// =========================================================================

String obtenerRutaActual() {
  // TODO: Implementar logica para cambiar la ruta segun la ruta
  // que el conductor esta recorriendo. Por ahora devolvemos vacio
  // (se usara la tarifa global del servidor).
  return "";
}

// =========================================================================
//  CONTROL DE LEDS
// =========================================================================

void encenderLED(int pin, unsigned long ms) {
  digitalWrite(pin, HIGH);
  delay(ms);
  digitalWrite(pin, LOW);
}

void actualizarLED() {
  unsigned long ahora = millis();
  unsigned long intervalo = 0;

  switch (estadoLED) {
    case ESPERANDO_WIFI:
      intervalo = 100;
      break;
    case ESPERANDO_GPS:
      intervalo = 500;
      break;
    case ENVIANDO_DATOS:
      digitalWrite(LED_BUILTIN, HIGH);
      return;
    case ERROR_CONEXION:
      intervalo = 200;
      break;
  }

  if (ahora - ultimoParpadeo >= intervalo) {
    ultimoParpadeo = ahora;
    ledEstado = !ledEstado;
    digitalWrite(LED_BUILTIN, ledEstado);
  }
}

// =========================================================================
//  UTILERIAS
// =========================================================================

String bytesToHex(byte* buffer, byte bufferSize) {
  String hexStr;
  for (byte i = 0; i < bufferSize; i++) {
    if (buffer[i] < 0x10) hexStr += "0";
    hexStr += String(buffer[i], HEX);
  }
  hexStr.toUpperCase();
  return hexStr;
}
