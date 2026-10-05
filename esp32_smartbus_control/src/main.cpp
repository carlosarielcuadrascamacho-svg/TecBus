/*
 =============================================================================
   SMARTBUS / TECBUS — FIRMWARE UNIFICADO ESP32 (PLATFORMIO / ARDUINO IDE)
   GPS (localizador) + RFID (pagos) + DHT22 (clima) + INA219 (telemetría)
   + 2 RELES AUTOMÁTICOS (AC y LUZ/LEDS) POR TEMPERATURA Y OCUPACIÓN
 =============================================================================

   OBJETIVO PRINCIPAL (PRIORITARIO):
     - Sistema de PAGOS con RFID 100% funcional (sin excepciones)
     - Sistema de GPS (localizador) 100% funcional (sin excepciones)
     - Mantener INTACTA la lógica base probada en camión (no bloqueante)

   QUE HACE ESTA VERSIÓN UNIFICADA:
     - Envía la ubicación GPS al servidor cada 10 segundos (localizador).
     - Lee tarjetas RFID y procesa el pago contra /api/pagos/procesar.
     - Incrementa contador de pasajeros ÚNICAMENTE cuando el servidor responde
       detalle[0].estado == "ok". Nunca incrementa si rechaza o va a buffer.
     - Control automático de relés por Temperatura + Pasajeros:
       * RELE_AC  (GPIO26) -> Aire Acondicionado
       * RELE_LUZ (GPIO27) -> Leds/Iluminación
       Reglas con Histéresis (1.0 °C):
         Calor (>=26.0 °C) + Gente (>0)     -> AC ON, LUZ ON
         Calor (>=26.0 °C) + Sin Gente (==0) -> AC ON, LUZ OFF
         Frío  (<25.0 °C)                    -> AC OFF, LUZ OFF
         Banda muerta [25.0 °C, 26.0 °C)    -> Conserva estado anterior de AC
     - DHT22: lectura cada 3 segundos (millis()), log ligero por Serial.
     - INA219 (0x40): solo lectura y telemetría por Serial (millis()). NO condiciona relés.
     - Store & Forward: si no hay internet o falla red, guarda transacciones en buffer
       y sincroniza en lote al recuperar conexión. Al confirmarse OK en el servidor,
       se incrementan los pasajeros correspondientes.
     - Lógica 100% NO BLOQUEANTE con millis() (sin delay() en loop crítico).
     - Debounce RFID: ignora mismo UID por 3 segundos (evita doble cobro).

   CONEXIONES DE HARDWARE:

     NEO M8N (GPS) — UART2:
       VCC -> +5V (VIN)
       GND -> GND
       TX  -> GPIO 16 (RX2 del ESP32)
       RX  -> GPIO 17 (TX2 del ESP32)

     MFRC522 (RFID) — SPI:
       3.3V -> 3.3V (NUNCA 5V)
       GND  -> GND
       SDA  -> GPIO 5   (SS/CS)
       RST  -> GPIO 4
       SCK  -> GPIO 18
       MISO -> GPIO 19
       MOSI -> GPIO 23

     MÓDULO DE RELÉS (2 CANALES) — Active-LOW (según instrucción):
       VCC  -> +5V
       GND  -> GND
       IN1  -> GPIO 26  (RELE_AC  — Aire Acondicionado, control automático)
       IN2  -> GPIO 27  (RELE_LUZ — Leds, control automático)

     DHT22 (Sensor de clima):
       VCC  -> +3.3V
       GND  -> GND
       DATA -> GPIO 13  (CLIMA_DAT) — Pull-up integrado en la mayoría de módulos

     INA219 (Sensor de corriente) — I2C:
       VCC  -> +3.3V
       GND  -> GND
       SDA  -> GPIO 21
       SCL  -> GPIO 22
       Dirección I2C: 0x40 (sin puentes)

     LED de estado -> GPIO 2 (LED integrado ESP32)

   LIBRERÍAS (PlatformIO - platformio.ini):
     - adafruit/DHT sensor library @ ^1.4.6
     - adafruit/Adafruit INA219 @ ^1.2.3
     - miguelbalboa/MFRC522 @ ^1.4.12
     - mikalhart/TinyGPSPlus @ ^1.1.0
     - bblanchon/ArduinoJson @ ^6.21.5

   ENDPOINTS:
     - Ubicación: PUT  /api/camiones/update-location  {busId, lat, lng, speed, pasajeros_actuales, luces_perifericos_encendidos}
     - Pagos:     POST /api/pagos/procesar            (header x-api-key, body = array)

   COMANDOS POR MONITOR SERIAL (115200 baudios):
     r  -> Resetea contador de pasajeros a 0 (reinicio de cuenta por vuelta/jornada)
     e  -> Muestra estado completo (WiFi, GPS, Clima, Pasajeros, Relés, Buffer)
 =============================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <DHT.h>
#include <Adafruit_INA219.h>
#include <vector>
#include <string.h>
#include <math.h>

// =========================================================================
//  CONFIGURACIÓN — CAMBIAR SOLO SI ES NECESARIO
// =========================================================================

// --- WiFi ---
const char* WIFI_SSID = "SmartBus2";
const char* WIFI_PASS = "SmartBus1";

// --- Servidor Backend ---
const char* SERVER_URL = "https://tecbus-api.onrender.com";
// const char* SERVER_URL = "http://192.168.1.100:5000";

// --- API Key ---
const char* API_KEY = "sm4rtbus_p4g0s_2026";

// --- Identificador de Camión (debe coincidir con numeroUnidad en MongoDB) ---
const char* BUS_ID = "U002";

// =========================================================================
//  INTERVALOS DE TIEMPO (milisegundos)
// =========================================================================

const unsigned long INTERVALO_TELEMETRIA_MS    = 10000;  // Ubicación cada 10 s
const unsigned long INTERVALO_RECONEXION_WIFI  = 15000;  // Reintento WiFi cada 15 s
const unsigned long DEBOUNCE_RFID_MS           = 3000;   // Ignorar mismo UID por 3 s
const unsigned long INTERVALO_SYNC_MS          = 5000;   // Sincronizar buffer cada 5 s
const unsigned long TIEMPO_MAX_WIFI_INICIAL_MS = 10000;  // Timeout conexión inicial

// Sensores
const unsigned long INTERVALO_LECTURA_DHT_MS   = 3000;   // Leer DHT22 cada 3 s
const unsigned long INTERVALO_LECTURA_INA_MS   = 2000;   // Leer INA219 cada 2 s (solo telemetría)

// =========================================================================
//  PINES DEL ESP32
// =========================================================================

// GPS UART2
static const int RX2_PIN = 16;  // UART2 RX -> GPS TX
static const int TX2_PIN = 17;  // UART2 TX -> GPS RX

// RFID SPI
static const int RFID_SS_PIN  = 5;   // SPI SS (CS)
static const int RFID_RST_PIN = 4;   // RST MFRC522

// Relés (Control Automático por Temp + Pasajeros)
static const int RELE_AC  = 26;  // Aire Acondicionado
static const int RELE_LUZ = 27;  // Leds/Iluminación

// Clima
static const int DHT_PIN  = 13;  // DHT22 DATA (CLIMA_DAT)

// LED Estado
static const int LED_BUILTIN_PIN = 2;  // LED integrado ESP32

// LÓGICA DE RELÉS — ACTIVE-LOW (módulos optoacoplados)
#define RELE_ON  LOW   // Activa relé (cierra contacto NO)
#define RELE_OFF HIGH  // Desactiva relé (abre contacto NO)

// =========================================================================
//  OBJETOS GLOBALES
// =========================================================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);        // UART2 para GPS

MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);

WiFiClientSecure clienteTLS;        // TLS para HTTPS

DHT dht(DHT_PIN, DHT22);            // DHT22
Adafruit_INA219 ina219(0x40);       // INA219 dirección I2C 0x40 (solo telemetría)

// =========================================================================
//  ESTADOS DEL SISTEMA (LED DE ESTADO)
// =========================================================================

enum EstadoLED {
  ESPERANDO_WIFI,     // Parpadeo rápido (150 ms)
  ESPERANDO_GPS,      // Parpadeo lento  (500 ms)
  ENVIANDO_DATOS,     // Fijo encendido (Todo OK)
  ERROR_CONEXION      // Parpadeo medio  (250 ms)
};

EstadoLED estadoLED = ESPERANDO_WIFI;

// =========================================================================
//  VARIABLES DE TIEMPO (millis())
// =========================================================================

// WiFi/GPS/Sync/RFID/LED
unsigned long ultimoEnvioTelemetria = 0;
unsigned long ultimoIntentoWifi     = 0;
unsigned long ultimoSync            = 0;
unsigned long ultimoParpadeo        = 0;
bool ledEstado                      = false;

// DHT22
unsigned long ultimoLecturaDHT      = 0;
float tempDHT                       = NAN;
float humDHT                        = NAN;
bool dhtValido                      = false;

// INA219 (solo telemetría)
unsigned long ultimoLecturaINA      = 0;
float inaVoltaje_V                  = 0.0f;
float inaCorriente_mA               = 0.0f;
float inaPotencia_mW                = 0.0f;
bool inaValido                      = false;

// Relés Automáticos (Temp + Pasajeros)
bool releAC_Activo                  = false;
bool releLUZ_Activo                 = false;

// Contador de pasajeros (solo ++ tras confirmación de cobro OK)
int pasajeros                       = 0;

// Debounce RFID
String ultimoUID                    = "";
unsigned long tiempoUltimoUID       = 0;

// =========================================================================
//  BUFFER STORE & FORWARD (PAGOS SIN CONEXIÓN)
// =========================================================================

struct TransaccionPendiente {
  String uid;
  String rutaId;
  int    cantidad;
  unsigned long timestamp;   // epoch Unix (0 si GPS sin fecha válida)
};

std::vector<TransaccionPendiente> colaPendientes;
static const size_t MAX_BUFFER = 50;

// =========================================================================
//  PROTOTIPOS DE FUNCIONES
// =========================================================================

void leerGPS();
void conectarWiFi();
void gestionarWiFi();
void prepararHTTP(HTTPClient& http, const String& url);
void gestionarTelemetria();
void enviarTelemetria();
void gestionarRFID();
void procesarUID(const String& uid);
int  enviarPago(const String& uid, const String& rutaId, int cantidad);
void pushBuffer(const String& uid, const String& rutaId, int cantidad);
bool sincronizarBuffer();
void gestionarSync();
void leerDHT22();
void leerINA219();
void evaluarReles();
void aplicarEstadosReles();
void gestionarComandosSerial();
void imprimirEstado();
String obtenerRutaActual();
String bytesToHex(byte* buffer, byte bufferSize);
unsigned long epochDesdeGps();
void actualizarLED();

// =========================================================================
//  SETUP
// =========================================================================

void setup() {
  Serial.begin(115200);
  delay(100);

  Serial.println(F("\n============================================================"));
  Serial.println(F("  SMARTBUS / TECBUS — FIRMWARE UNIFICADO (PlatformIO)"));
  Serial.println(F("  GPS + PAGOS RFID + DHT22 + INA219 + RELÉS AUTOMÁTICOS"));
  Serial.println(F("  Prioritario: PAGOS + GPS — 100% NO BLOQUEANTE"));
  Serial.println(F("============================================================"));

  // --- Pines de salida (Relés + LED) ---
  pinMode(RELE_AC, OUTPUT);
  pinMode(RELE_LUZ, OUTPUT);
  pinMode(LED_BUILTIN_PIN, OUTPUT);

  // Estado inicial relés: OFF (Active-LOW -> HIGH)
  digitalWrite(RELE_AC, RELE_OFF);
  digitalWrite(RELE_LUZ, RELE_OFF);
  releAC_Activo  = false;
  releLUZ_Activo = false;
  digitalWrite(LED_BUILTIN_PIN, LOW);

  // --- GPS UART2 (9600 baudios — NEO M8N estándar) ---
  gpsSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Serial.println(F("[GPS] UART2 iniciado (RX=GPIO16, TX=GPIO17) @9600 bps"));

  // --- RFID SPI ---
  SPI.begin();
  mfrc522.PCD_Init();
  delay(80);  // Estabilización módulo RFID
  Serial.println(F("[RFID] MFRC522 iniciado (SPI, SS=GPIO5, RST=GPIO4)"));

  // --- DHT22 ---
  dht.begin();
  tempDHT          = NAN;
  humDHT           = NAN;
  dhtValido        = false;
  ultimoLecturaDHT = 0;
  Serial.println(F("[CLIMA] DHT22 iniciado (GPIO13) — Lectura cada 3s"));

  // --- INA219 I2C (Solo lectura/Telemetría) ---
  Wire.begin(21, 22);
  if (ina219.begin()) {
    ina219.setCalibration_32V_2A();  // Rango para monitoreo de bus
    inaValido = true;
    Serial.println(F("[INA219] Inicializado correctamente (I2C 0x40) — Solo telemetría"));
  } else {
    inaValido = false;
    Serial.println(F("[INA219] ADVERTENCIA: No detectado en 0x40 — Lectura deshabilitada"));
  }
  inaVoltaje_V     = 0.0f;
  inaCorriente_mA  = 0.0f;
  inaPotencia_mW   = 0.0f;
  ultimoLecturaINA = 0;

  // --- Relés Automáticos ---
  Serial.println(F("[RELES] Control AUTOMÁTICO por Temp + Pasajeros"));
  Serial.printf("        RELE_AC  (GPIO26) = AC | RELE_LUZ (GPIO27) = LEDS\n");
  Serial.println(F("        Reglas: >=26.0°C + Gente>0 -> AC ON, LUZ ON | >=26.0°C + Gente==0 -> AC ON, LUZ OFF"));
  Serial.println(F("                <25.0°C -> AC OFF, LUZ OFF | Histéresis: [25.0°C, 26.0°C) conserva estado"));
  Serial.println(F("        Active-LOW: RELE_ON=LOW, RELE_OFF=HIGH"));

  // --- Serial Comandos ---
  Serial.println(F("[SERIAL] Comandos: 'r' = Reset pasajeros | 'e' = Estado general"));

  // --- Cliente TLS ---
  clienteTLS.setInsecure();

  // --- Contador de pasajeros ---
  pasajeros = 0;
  Serial.println(F("[PASAJEROS] Contador inicializado a 0 (Inicio de jornada)"));

  // --- WiFi Inicial ---
  conectarWiFi();

  Serial.println(F("\n[SYSTEM] Sistema unificado listo. Entrando al bucle principal...\n"));
}

// =========================================================================
//  LOOP PRINCIPAL — 100% NO BLOQUEANTE
// =========================================================================

void loop() {
  leerGPS();                 // 1. GPS (UART2)
  gestionarWiFi();           // 2. WiFi + Reconexión automática
  gestionarRFID();           // 3. RFID + Pagos
  gestionarSync();           // 4. Store & Forward (Sincronización buffer)
  gestionarTelemetria();     // 5. Telemetría GPS PUT cada 10s
  leerDHT22();               // 6. Clima DHT22 cada 3s
  leerINA219();              // 7. INA219 solo telemetría cada 2s
  evaluarReles();            // 8. Evaluar reglas Temp + Pasajeros
  aplicarEstadosReles();     // 9. Aplicar estados a relés
  gestionarComandosSerial(); // 10. Comandos Monitor Serial
  actualizarLED();           // 11. LED de Estado
}

// =========================================================================
//  GPS
// =========================================================================

void leerGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

// =========================================================================
//  WIFI
// =========================================================================

void conectarWiFi() {
  estadoLED = ESPERANDO_WIFI;
  Serial.printf("[WiFi] Conectando a '%s'...\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED &&
         (millis() - inicio) < TIEMPO_MAX_WIFI_INICIAL_MS) {
    delay(500);
    Serial.print(F("."));
    leerGPS(); // Procesar GPS durante la espera inicial
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Conectado. IP asignada: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("[WiFi] No conectado inicialmente. Se reintentará en segundo plano."));
  }
}

void gestionarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long ahora = millis();
  if (ahora - ultimoIntentoWifi >= INTERVALO_RECONEXION_WIFI) {
    ultimoIntentoWifi = ahora;
    estadoLED = ESPERANDO_WIFI;
    Serial.println(F("[WiFi] Conexión perdida. Reintentando..."));
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

void prepararHTTP(HTTPClient& http, const String& url) {
  if (url.startsWith(F("https"))) {
    clienteTLS.setInsecure();
    http.begin(clienteTLS, url);
  } else {
    http.begin(url);
  }
}

// =========================================================================
//  TELEMETRÍA GPS (PUT /api/camiones/update-location)
// =========================================================================

void gestionarTelemetria() {
  unsigned long ahora = millis();
  if (ahora - ultimoEnvioTelemetria < INTERVALO_TELEMETRIA_MS) return;
  ultimoEnvioTelemetria = ahora;

  if (!gps.location.isValid()) {
    estadoLED = ESPERANDO_GPS;
    static unsigned long ultimoAvisoFix = 0;
    if (ahora - ultimoAvisoFix > 30000) {
      ultimoAvisoFix = ahora;
      Serial.printf("[GPS] Esperando FIX... Satélites: %d\n", gps.satellites.value());
    }
    return;
  }

  enviarTelemetria();
}

void enviarTelemetria() {
  HTTPClient http;
  String url = String(SERVER_URL) + F("/api/camiones/update-location");

  prepararHTTP(http, url);
  http.addHeader(F("Content-Type"), F("application/json"));
  http.setTimeout(10000);

  StaticJsonDocument<256> doc;
  doc[F("busId")]                        = BUS_ID;
  doc[F("lat")]                          = gps.location.lat();
  doc[F("lng")]                          = gps.location.lng();
  doc[F("speed")]                        = (int)gps.speed.kmph();
  doc[F("pasajeros_actuales")]           = pasajeros;
  doc[F("luces_perifericos_encendidos")] = releLUZ_Activo;

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.PUT(jsonData);
  String respuesta = http.getString();
  http.end();

  if (httpCode == 200) {
    estadoLED = ENVIANDO_DATOS;
    Serial.printf("[GPS] OK | Lat=%.6f Lng=%.6f Speed=%d km/h | Sat=%d | Pasajeros=%d | HTTP %d\n",
                  gps.location.lat(), gps.location.lng(),
                  (int)gps.speed.kmph(), gps.satellites.value(), pasajeros, httpCode);
  } else {
    estadoLED = ERROR_CONEXION;
    Serial.printf("[GPS] Error HTTP %d: %s\n", httpCode,
                  respuesta.isEmpty() ? "sin respuesta" : respuesta.c_str());
  }
}

// =========================================================================
//  RFID + PAGOS (PRIORITARIO - SIN EXCEPCIONES)
// =========================================================================

void gestionarRFID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial()) return;

  // UID en formato hexadecimal mayúsculas
  String uidStr = bytesToHex(mfrc522.uid.uidByte, mfrc522.uid.size);
  Serial.printf("[RFID] Tarjeta detectada: %s\n", uidStr.c_str());

  // Liberar tarjeta PICC
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();

  procesarUID(uidStr);
}

void procesarUID(const String& uid) {
  unsigned long ahora = millis();
  // Debounce 3s para evitar cobros dobles con la misma tarjeta
  if (uid == ultimoUID && (ahora - tiempoUltimoUID) < DEBOUNCE_RFID_MS) {
    Serial.println(F("[RFID] UID repetido — ignorado por debounce (3s)"));
    return;
  }
  ultimoUID       = uid;
  tiempoUltimoUID = ahora;

  String rutaActual = obtenerRutaActual();

  if (WiFi.status() == WL_CONNECTED) {
    int res = enviarPago(uid, rutaActual, 1);
    if (res == 1) {
      // Cobro exitoso confirmado por backend -> Incrementar pasajeros
      pasajeros++;
      Serial.printf("[PASAJEROS] +1 | Total: %d (Cobro OK)\n", pasajeros);
      evaluarReles();
      aplicarEstadosReles();
      Serial.println(F("[PAGO] ONLINE — Cobro EXITOSO"));
    } else if (res == 0) {
      // Rechazado explícitamente por el servidor (saldo insuficiente o usuario no registrado)
      // No incrementa pasajeros ni se almacena en el buffer de reconexión
      Serial.println(F("[PAGO] ONLINE — Rechazado por el backend (sin incremento, no va a buffer)"));
    } else {
      // Error de red / HTTP 500 / timeout -> Guardar en buffer Store & Forward
      pushBuffer(uid, rutaActual, 1);
      Serial.println(F("[PAGO] FALLO DE RED — Guardado en BUFFER para reintento"));
    }
  } else {
    // Sin conexión WiFi -> Guardar en buffer
    pushBuffer(uid, rutaActual, 1);
    Serial.println(F("[PAGO] OFFLINE — Transacción guardada en BUFFER"));
  }
}

// =========================================================================
//  PAGO API — POST /api/pagos/procesar (ARRAY)
//  Retorna:
//    1  = Éxito ("ok")
//    0  = Rechazado por el servidor ("error", saldo insuficiente, etc.)
//   -1  = Fallo de conexión o red
// =========================================================================

int enviarPago(const String& uid, const String& rutaId, int cantidad) {
  HTTPClient http;
  String url = String(SERVER_URL) + F("/api/pagos/procesar");

  prepararHTTP(http, url);
  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("x-api-key"), API_KEY);
  http.setTimeout(10000);

  // El backend espera un array de transacciones
  StaticJsonDocument<256> doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();
  obj[F("uid")]              = uid;
  if (rutaId.length() > 0) {
    obj[F("rutaId")]         = rutaId;
  }
  obj[F("cantidad_boletos")] = cantidad;
  obj[F("camionId")]         = BUS_ID;

  unsigned long tsGps = epochDesdeGps();
  if (tsGps > 0) {
    obj[F("timestamp")] = tsGps;
  }

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  String respuesta = http.getString();
  http.end();

  // Validar respuesta HTTP
  if (httpCode != 200 && httpCode != 201) {
    Serial.printf("[PAGO] Error HTTP %d: %s\n", httpCode,
                  respuesta.isEmpty() ? "sin respuesta" : respuesta.c_str());
    return -1; // Error de conexión o servidor caído
  }

  // Parsear respuesta JSON
  DynamicJsonDocument resp(512);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (err) {
    Serial.printf("[PAGO] Error parseando JSON respuesta: %s\n", err.c_str());
    return -1;
  }

  JsonVariant detalleArr = resp[F("detalle")];
  if (!detalleArr.is<JsonArray>() || detalleArr.size() == 0) {
    Serial.println(F("[PAGO] Respuesta sin 'detalle' válido"));
    return 0;
  }

  const char* estadoDetalle = detalleArr[0][F("estado")];
  if (estadoDetalle && (strcmp(estadoDetalle, "ok") == 0)) {
    float saldoRest = detalleArr[0][F("saldo_restante")].as<float>();
    Serial.printf("[PAGO] OK | UID=%s | Saldo restante: $%.2f\n", uid.c_str(), saldoRest);
    return 1;
  }

  const char* motivoDetalle = detalleArr[0][F("motivo")];
  Serial.printf("[PAGO] RECHAZADO | UID=%s | Motivo: %s\n",
                uid.c_str(),
                motivoDetalle ? motivoDetalle : "desconocido");
  return 0;
}

// =========================================================================
//  STORE & FORWARD
// =========================================================================

void pushBuffer(const String& uid, const String& rutaId, int cantidad) {
  if (colaPendientes.size() >= MAX_BUFFER) {
    Serial.println(F("[BUFFER] LLENO — Descartando transacción más antigua"));
    if (!colaPendientes.empty()) {
      colaPendientes.erase(colaPendientes.begin());
    }
  }

  TransaccionPendiente t;
  t.uid       = uid;
  t.rutaId    = rutaId;
  t.cantidad  = cantidad;
  t.timestamp = epochDesdeGps();

  colaPendientes.push_back(t);
  Serial.printf("[BUFFER] Guardado. Pendientes: %d/%d\n", (int)colaPendientes.size(), (int)MAX_BUFFER);
}

void gestionarSync() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (colaPendientes.empty()) return;

  unsigned long ahora = millis();
  if (ahora - ultimoSync >= INTERVALO_SYNC_MS) {
    ultimoSync = ahora;
    Serial.printf("[SYNC] Enviando lote: %d transacciones...\n", (int)colaPendientes.size());
    if (sincronizarBuffer()) {
      Serial.printf("[SYNC] Lote procesado. Quedan: %d\n", (int)colaPendientes.size());
    } else {
      Serial.println(F("[SYNC] Fallo al sincronizar lote. Se reintentará en el siguiente ciclo."));
    }
  }
}

bool sincronizarBuffer() {
  HTTPClient http;
  String url = String(SERVER_URL) + F("/api/pagos/procesar");

  prepararHTTP(http, url);
  http.addHeader(F("Content-Type"), F("application/json"));
  http.addHeader(F("x-api-key"), API_KEY);
  http.setTimeout(15000);

  size_t n = colaPendientes.size();
  size_t capacidad = JSON_ARRAY_SIZE(n) + n * (JSON_OBJECT_SIZE(5) + 64);
  if (capacidad < 512) capacidad = 512;
  DynamicJsonDocument doc(capacidad);
  JsonArray arr = doc.to<JsonArray>();

  for (const auto& t : colaPendientes) {
    JsonObject obj = arr.createNestedObject();
    obj[F("uid")]              = t.uid;
    if (t.rutaId.length() > 0) {
      obj[F("rutaId")]         = t.rutaId;
    }
    obj[F("cantidad_boletos")] = t.cantidad;
    obj[F("camionId")]         = BUS_ID;
    if (t.timestamp > 0) {
      obj[F("timestamp")] = t.timestamp;
    }
  }

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  String respuesta = http.getString();
  http.end();

  if (httpCode != 200 && httpCode != 201) {
    Serial.printf("[SYNC] HTTP %d: %s\n", httpCode,
                  respuesta.isEmpty() ? "sin respuesta" : respuesta.c_str());
    return false;
  }

  DynamicJsonDocument resp(8192);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (err) {
    Serial.printf("[SYNC] Error parseando respuesta lote: %s\n", err.c_str());
    return false;
  }

  JsonVariant detSync = resp[F("detalle")];
  std::vector<TransaccionPendiente> pendientesRestantes;
  int nuevosPasajeros = 0;
  size_t i = 0;

  for (const auto& t : colaPendientes) {
    bool esOK = false;
    bool descarteDefinitivo = false;

    if (detSync.is<JsonArray>() && i < detSync.size()) {
      const char* estD = detSync[i][F("estado")];
      if (estD && (strcmp(estD, "ok") == 0)) {
        esOK = true;
        nuevosPasajeros++;
      } else {
        // Rechazo definitivo en backend (tarjeta no existe o sin saldo)
        descarteDefinitivo = true;
      }
    }

    if (!esOK && !descarteDefinitivo) {
      // Reintentar si no fue confirmado ni descartado
      pendientesRestantes.push_back(t);
    }
    i++;
  }

  colaPendientes = std::move(pendientesRestantes);

  // Si hubo cobros exitosos confirmados por el backend en lote, sumarlos
  if (nuevosPasajeros > 0) {
    pasajeros += nuevosPasajeros;
    Serial.printf("[PASAJEROS] +%d confirmados en lote | Total: %d\n", nuevosPasajeros, pasajeros);
    evaluarReles();
    aplicarEstadosReles();
  }

  return true;
}

// =========================================================================
//  SENSORES CLIMA + TELEMETRÍA ELÉCTRICA
// =========================================================================

void leerDHT22() {
  unsigned long ahora = millis();
  if (ahora - ultimoLecturaDHT < INTERVALO_LECTURA_DHT_MS) return;
  ultimoLecturaDHT = ahora;

  float t = dht.readTemperature();
  float h = dht.readHumidity();

  if (!isnan(t) && !isnan(h)) {
    if (t >= -40.0f && t <= 80.0f && h >= 0.0f && h <= 100.0f) {
      tempDHT   = t;
      humDHT    = h;
      dhtValido = true;
      Serial.printf("[CLIMA] T=%.1f °C  H=%.1f %%\n", tempDHT, humDHT);
      evaluarReles();
      aplicarEstadosReles();
      return;
    }
  }
  dhtValido = (!isnan(tempDHT));
}

void leerINA219() {
  if (!inaValido) return;

  unsigned long ahora = millis();
  if (ahora - ultimoLecturaINA < INTERVALO_LECTURA_INA_MS) return;
  ultimoLecturaINA = ahora;

  float v = ina219.getBusVoltage_V();
  float i_mA = ina219.getCurrent_mA();
  float p_mW = ina219.getPower_mW();

  if (!isnan(v) && !isnan(i_mA) && !isnan(p_mW)) {
    inaVoltaje_V    = v;
    inaCorriente_mA = i_mA;
    inaPotencia_mW  = p_mW;
    Serial.printf("[INA219] V=%.2f V  I=%.2f mA  P=%.2f mW\n",
                  inaVoltaje_V, inaCorriente_mA, inaPotencia_mW);
  }
}

// =========================================================================
//  LÓGICA AUTOMÁTICA DE RELÉS — Temp + Pasajeros (CON HISTÉRESIS DE 1.0 °C)
// =========================================================================

void evaluarReles() {
  // Sin temperatura válida -> mantener relés apagados por seguridad
  if (!dhtValido || isnan(tempDHT)) {
    releAC_Activo  = false;
    releLUZ_Activo = false;
    return;
  }

  // --- Histéresis térmica para Aire Acondicionado ---
  // Si T >= 26.0 °C -> AC ON
  // Si T < 25.0 °C  -> AC OFF
  // Entre 25.0 °C y 25.99 °C (zona muerta) -> Mantiene el estado anterior de AC
  if (tempDHT >= 26.0f) {
    releAC_Activo = true;
  } else if (tempDHT < 25.0f) {
    releAC_Activo = false;
  }
  // En [25.0, 26.0) releAC_Activo no cambia

  // --- Lógica de Iluminación / LEDS ---
  // Calor (AC activo) + Hay pasajeros (> 0)  -> LUZ ON
  // Calor (AC activo) + Sin pasajeros (== 0) -> LUZ OFF
  // Frío (AC inactivo)                       -> LUZ OFF
  if (releAC_Activo && (pasajeros > 0)) {
    releLUZ_Activo = true;
  } else {
    releLUZ_Activo = false;
  }
}

void aplicarEstadosReles() {
  // Lógica Active-LOW: LOW = ON, HIGH = OFF
  digitalWrite(RELE_AC,  releAC_Activo  ? RELE_ON : RELE_OFF);
  digitalWrite(RELE_LUZ, releLUZ_Activo ? RELE_ON : RELE_OFF);
}

// =========================================================================
//  COMANDOS MONITOR SERIAL (115200 baudios)
// =========================================================================

void gestionarComandosSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r' || c == '\n') continue;

    switch (c) {
      case 'r':
      case 'R': {
        pasajeros = 0;
        Serial.println(F("[PASAJEROS] Contador RESET a 0 (Comando 'r')"));
        evaluarReles();
        aplicarEstadosReles();
        Serial.println(F("[RELES] Re-evaluados por reinicio de pasajeros"));
        break;
      }
      case 'e':
      case 'E': {
        imprimirEstado();
        break;
      }
      default:
        break;
    }
  }
}

void imprimirEstado() {
  Serial.println(F("\n--------------------- ESTADO DEL SISTEMA ---------------------"));
  // WiFi
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("  WiFi      : CONECTADO (%s)\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("  WiFi      : DESCONECTADO"));
  }

  // GPS
  if (gps.location.isValid()) {
    Serial.printf("  GPS       : FIX OK | Lat=%.6f  Lng=%.6f  Sat=%d  Speed=%.1f km/h\n",
                  gps.location.lat(), gps.location.lng(),
                  gps.satellites.value(), gps.speed.kmph());
  } else {
    Serial.printf("  GPS       : SIN FIX | Satélites=%d\n", gps.satellites.value());
  }

  // Clima DHT22
  if (dhtValido && !isnan(tempDHT) && !isnan(humDHT)) {
    Serial.printf("  Clima     : T=%.1f °C  H=%.1f %%  (válido)\n", tempDHT, humDHT);
  } else {
    Serial.println(F("  Clima     : Sin lectura válida aún"));
  }

  // INA219
  if (inaValido) {
    Serial.printf("  INA219    : V=%.2f V  I=%.2f mA  P=%.2f mW  (Solo telemetría)\n",
                  inaVoltaje_V, inaCorriente_mA, inaPotencia_mW);
  } else {
    Serial.println(F("  INA219    : NO DETECTADO (0x40)"));
  }

  // Pasajeros
  Serial.printf("  Pasajeros : %d  (Solo ++ tras cobro OK | Reset: arranque + 'r')\n", pasajeros);

  // Relés Automáticos
  Serial.printf("  RELE_AC   : GPIO26 -> %s (%s)\n",
                releAC_Activo  ? "ON" : "OFF",
                releAC_Activo  ? "AC ACTIVO" : "AC INACTIVO");
  Serial.printf("  RELE_LUZ  : GPIO27 -> %s (%s)\n",
                releLUZ_Activo ? "ON" : "OFF",
                releLUZ_Activo ? "LEDS ACTIVOS" : "LEDS INACTIVOS");

  // Buffer Store & Forward
  Serial.printf("  Buffer    : %d transacciones pendientes (MAX %d)\n",
                (int)colaPendientes.size(), (int)MAX_BUFFER);

  // RFID
  Serial.println(F("  RFID      : Listo (Debounce 3s activo)"));
  Serial.println(F("------------------------------------------------------------\n"));
}

// =========================================================================
//  LED DE ESTADO
// =========================================================================

void actualizarLED() {
  unsigned long ahora = millis();
  unsigned long intervaloMs = 500;

  switch (estadoLED) {
    case ESPERANDO_WIFI:
      intervaloMs = 150;  // Rápido
      break;
    case ESPERANDO_GPS:
      intervaloMs = 500;  // Lento
      break;
    case ENVIANDO_DATOS:
      // Fijo encendido
      digitalWrite(LED_BUILTIN_PIN, HIGH);
      return;
    case ERROR_CONEXION:
      intervaloMs = 250;  // Medio
      break;
    default:
      intervaloMs = 500;
      break;
  }

  if (ahora - ultimoParpadeo >= intervaloMs) {
    ultimoParpadeo = ahora;
    ledEstado = !ledEstado;
    digitalWrite(LED_BUILTIN_PIN, ledEstado ? HIGH : LOW);
  }
}

// =========================================================================
//  UTILIDADES
// =========================================================================

String obtenerRutaActual() {
  // Reservado para selector de ruta en el camión.
  // Cadena vacía indica al backend usar la ruta asignada o tarifa estándar.
  return String("");
}

// Convierte bytes UID a HEX en MAYÚSCULAS
String bytesToHex(byte* buffer, byte bufferSize) {
  String hexStr;
  hexStr.reserve(bufferSize * 2);
  for (byte i = 0; i < bufferSize; i++) {
    if (buffer[i] < 0x10) hexStr += '0';
    hexStr += String(buffer[i], HEX);
  }
  hexStr.toUpperCase();
  return hexStr;
}

// Calcula timestamp Epoch Unix desde el GPS (segundos desde 1970). Devuelve 0 si no es válido
unsigned long epochDesdeGps() {
  if (!gps.date.isValid() || !gps.time.isValid()) return 0UL;

  int y = gps.date.year();
  int m = gps.date.month();
  int d = gps.date.day();
  if (y < 2020) return 0UL; // Validar fecha coherente

  // Algoritmo civil to days (Howard Hinnant)
  if (m <= 2) {
    y -= 1;
  }
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153u * (unsigned)(m + (m > 2 ? -3 : 9)) + 2u) / 5u + (unsigned)d - 1u;
  const unsigned doe = yoe * 365u + yoe / 4u - yoe / 100u + doy;
  const long diasDesdeEra = (long)era * 146097L + (long)doe - 719468L;

  // Segundos
  unsigned long segundosDia = (unsigned long)gps.time.hour() * 3600UL +
                              (unsigned long)gps.time.minute() * 60UL +
                              (unsigned long)gps.time.second();
  unsigned long epochSec = (unsigned long)diasDesdeEra * 86400UL + segundosDia;
  return epochSec;
}
