/*
=============================================================================
  SMARTBUS / TECBUS — FIRMWARE MAESTRO ESP32 (30 PINES)
  GPS + RFID + INA219 + DHT22 + RELE (Torniquete)
  Envia telemetria cada 10s y procesa pagos RFID contra el backend desplegado
=============================================================================

  CONEXIONES DE HARDWARE:

    NEO M8N (GPS)  — UART2:
      VCC  -> VIN (5V)
      GND  -> GND
      TX   -> GPIO 16 (RX2 del ESP32)
      RX   -> GPIO 17 (TX2 del ESP32)

    MFRC522 (RFID) — SPI:
      3.3V -> 3.3V del ESP32 (NUNCA 5V)
      GND  -> GND
      SDA  -> GPIO 5   (SS)
      RST  -> GPIO 4   (RST)  <-- IMPORTANTE: Se usa 4 y no 22 para no
                                 chocar con el SCL=22 del INA219 (I2C)
      SCK  -> GPIO 18
      MISO -> GPIO 19
      MOSI -> GPIO 23

    INA219 (Voltaje/Corriente) — I2C:
      SDA -> GPIO 21
      SCL -> GPIO 22
      VIN+ / VIN- en serie con la linea del bus (medir voltaje del autobus)

    DHT22 (Temperatura / Humedad):
      DAT -> GPIO 14
      VCC -> 3.3V
      GND -> GND

    MODULO RELE:
      RELAY_1 (torniquete) -> GPIO 26
      RELAY_2 (auxiliar)   -> GPIO 27

    LED de estado -> GPIO 2 (LED integrado del ESP32)

  LIBRERIAS REQUERIDAS (Gestor de Librerias de Arduino):
    - TinyGPSPlus        (Mikal Hart)
    - ArduinoJson v6     (Benoit Blanchon)  <-- OBLIGATORIO VERSION 6
    - MFRC522            (Miguel Balboa)
    - Adafruit INA219    (Adafruit)
    - DHT sensor library for ESPx / DHTesp (beegee)
    - WiFiClientSecure y HTTPClient vienen incluidas en el nucleo ESP32

  PLACA EN ARDUINO IDE: "ESP32 Dev Module" / "DOIT ESP32 DEVKIT V1"

  CONFIGURACION DE PLACA:
    - Upload Speed : 115200
    - Flash Size   : 4MB
    - Partition    : Default 4MB with spiffs

  NOTAS SOBRE EL BACKEND (YA DESPLEGADO EN INTERNET):
    1) Telemetria  -> PUT /api/camiones/update-location  (sin autenticacion)
       El backend recibe busId, lat, lng, speed, pasajeros_actuales,
       luces_perifericos_encendidos y minutos_ralenti. Se envian ADEMAS
       temperatura, humedad y voltaje como campos adicionales (el servidor
       actual los ignora, pero el firmware queda listo para cuando el
       backend los persista).
    2) Pagos       -> POST /api/pagos/procesar  (requiere header "x-api-key")
       El body es un ARRAY de eventos. El servidor responde HTTP 200 incluso
       cuando el cobro FALLA (saldo insuficiente, tarjeta no registrada).
       Por eso el firmware PARSEA la respuesta y solo abre el torniquete
       si detalle[0].estado == "ok".
    3) El UID de la tarjeta RFID debe coincidir EXACTAMENTE con el campo
       rfid_uid del usuario en MongoDB (se envia en HEXADECIMAL MAYUSCULAS).

  LOGICA NO BLOQUEANTE:
    - Todo el control de tiempos usa millis() (sin delay() en el loop).
    - Reconexion WiFi automatica y no bloqueante.
    - Pulso del torniquete con temporizador (no bloquea el loop).
    - Debounce RFID: ignora el mismo UID por 3 segundos (evita cobro doble
      si la tarjeta se queda pegada al lector).
    - Store & Forward: si no hay internet, la transaccion se guarda en un
      buffer y se sincroniza en lote cuando vuelve la conexion.
=============================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Adafruit_INA219.h>
#include <DHTesp.h>
#include <vector>

// =========================================================================
//  CONFIGURACION — CAMBIA ESTOS VALORES SEGUN TU CAMION Y TU RED
// =========================================================================

// --- WiFi (hotspot del conductor o router del camion) ---
const char* WIFI_SSID = "Carlos04";
const char* WIFI_PASS = "1234567895";

// --- Servidor TecBus ya desplegado en internet ---
// Para pruebas locales descomenta la segunda linea (IP de tu PC).
const char* SERVER_URL = "https://tecbus-api.onrender.com";
// const char* SERVER_URL = "http://192.168.1.100:5000";

// --- API Key del backend (debe coincidir con API_KEY_ESP32 del .env) ---
const char* API_KEY = "sm4rtbus_p4g0s_2026";

// --- Identificador del camion: DEBE ser el "numeroUnidad" en MongoDB ---
const char* BUS_ID = "U001";

// =========================================================================
//  INTERVALOS DE TIEMPO (milisegundos)
// =========================================================================

const unsigned long INTERVALO_TELEMETRIA_MS    = 10000;  // Enviar telemetria cada 10 s
const unsigned long INTERVALO_RECONEXION_WIFI  = 15000;  // Reintentar WiFi cada 15 s
const unsigned long TIEMPO_PULSO_TORNIQUETE_MS = 2000;   // Torniquete abierto 2 s
const unsigned long DEBOUNCE_RFID_MS           = 3000;   // Ignorar mismo UID por 3 s
const unsigned long INTERVALO_SYNC_MS          = 5000;   // Reintentar lote pendiente cada 5 s
const unsigned long TIEMPO_MAX_WIFI_INICIAL_MS = 10000;  // Timeout de conexion inicial

// =========================================================================
//  PINES DEL ESP32 (30 pines)
// =========================================================================

static const int RX2_PIN          = 16;  // UART2 RX  -> GPS TX
static const int TX2_PIN          = 17;  // UART2 TX  -> GPS RX

static const int RFID_SS_PIN      = 5;   // SPI SS del MFRC522
static const int RFID_RST_PIN     = 4;   // RST del MFRC522 (libre de conflicto con I2C)

static const int DHT_PIN          = 14;  // DHT22

static const int RELE_TORNIQUETE  = 26;  // Relé 1 -> torniquete
static const int RELE_AUX         = 27;  // Relé 2 -> auxiliar (luces, bocina, etc.)

static const int LED_BUILTIN_PIN  = 2;   // LED integrado de estado

// Nivel logico que activa los reles. La mayoria de modulos usan HIGH,
// algunos usan LOW (revisa tu modulo; hay una pequena tarjeta con jumper).
const int RELE_ON  = HIGH;
const int RELE_OFF = LOW;

// =========================================================================
//  OBJETOS GLOBALES DE LAS LIBRERIAS
// =========================================================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);          // UART2 para el GPS
MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);
Adafruit_INA219 ina219;               // Sensor de voltaje/corriente (I2C)
DHTesp dht;                           // Sensor de temperatura/humedad
WiFiClientSecure clienteTLS;          // Cliente TLS para HTTPS

// =========================================================================
//  ESTADOS DEL SISTEMA (para el LED de estado)
// =========================================================================

enum EstadoLED {
  ESPERANDO_WIFI,     // Parpadeo rapido (150 ms)
  ESPERANDO_GPS,      // Parpadeo lento (500 ms)
  ENVIANDO_DATOS,     // Encendido fijo (todo OK)
  ERROR_CONEXION      // Parpadeo medio (250 ms)
};

EstadoLED estadoLED = ESPERANDO_WIFI;

// =========================================================================
//  VARIABLES DE CONTROL DE TIEMPO (millis)
// =========================================================================

unsigned long ultimoEnvioTelemetria = 0;
unsigned long ultimoIntentoWifi     = 0;
unsigned long ultimoSync            = 0;
unsigned long ultimoParpadeo        = 0;
bool ledEstado                      = false;

// Pulso del torniquete (no bloqueante)
bool pulsoActivo                    = false;
unsigned long pulsoInicio           = 0;

// Debounce del RFID
String ultimoUID                     = "";
unsigned long tiempoUltimoUID        = 0;

// =========================================================================
//  LECTURAS DE SENSORES (se refrescan en cada ciclo de telemetria)
// =========================================================================

float ultimaTemperatura = 0.0f;   // DHT22 (grados C)
float ultimaHumedad     = 0.0f;   // DHT22 (%)
float ultimoVoltaje     = 0.0f;   // INA219 (Volts)

// Telemetria de eficiencia (MOCK temporal hasta conectar sensores reales)
int  pasajeros_actuales           = 0;
bool luces_perifericos_encendidos = false;
int  minutos_ralenti              = 0;

// =========================================================================
//  BUFFER STORE & FORWARD (pagos hechos sin conexion)
// =========================================================================

struct TransaccionPendiente {
  String uid;
  String rutaId;
  int    cantidad;
  unsigned long timestamp;   // epoch Unix (0 si el GPS no tenia fecha valida)
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
void leerSensoresTelemetria();
void enviarTelemetria();
void gestionarTelemetria();
void gestionarRFID();
void procesarUID(const String& uid);
bool enviarPago(const String& uid, const String& rutaId, int cantidad);
void pushBuffer(const String& uid, const String& rutaId, int cantidad);
bool sincronizarBuffer();
void gestionarSync();
void activarTorniquete();
void gestionarRelevadores();
void actualizarLED();
String obtenerRutaActual();
String bytesToHex(byte* buffer, byte bufferSize);
unsigned long epochDesdeGps();

// =========================================================================
//  SETUP — Se ejecuta una sola vez al encender
// =========================================================================

void setup() {
  Serial.begin(115200);
  Serial.println(F("\n=============================================="));
  Serial.println(F("  SMARTBUS / TECBUS — FIRMWARE MAESTRO ESP32"));
  Serial.println(F("=============================================="));

  // --- Pines de salida ---
  pinMode(RELE_TORNIQUETE, OUTPUT);
  pinMode(RELE_AUX, OUTPUT);
  pinMode(LED_BUILTIN_PIN, OUTPUT);
  digitalWrite(RELE_TORNIQUETE, RELE_OFF);
  digitalWrite(RELE_AUX, RELE_OFF);
  digitalWrite(LED_BUILTIN_PIN, LOW);

  // --- GPS en UART2 (9600 baudios es el estandar del NEO M8N) ---
  gpsSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Serial.println(F("[GPS] UART2 iniciado (RX=GPIO16, TX=GPIO17) @9600"));

  // --- RFID por SPI ---
  SPI.begin();
  mfrc522.PCD_Init();
  delay(100);  // Pequena espera de estabilizacion del modulo RFID
  Serial.println(F("[RFID] MFRC522 iniciado (SPI, SS=5, RST=4)"));

  // --- INA219 por I2C (pines por defecto SDA=21, SCL=22) ---
  if (ina219.begin()) {
    Serial.println(F("[SENSOR] INA219 detectado (I2C: SDA=21, SCL=22)"));
  } else {
    Serial.println(F("[SENSOR] ATENCION: INA219 no detectado, revisa I2C"));
  }

  // --- DHT22 en GPIO 14 ---
  dht.setup(DHT_PIN, DHTesp::DHT22);
  Serial.println(F("[SENSOR] DHT22 iniciado (GPIO 14)"));

  // --- Cliente TLS sin verificacion de certificado (compatibilidad maxima) ---
  clienteTLS.setInsecure();

  // --- Conexion WiFi inicial ---
  conectarWiFi();

  Serial.println(F("\n[SYSTEM] Listo. Entrando al loop principal."));
}

// =========================================================================
//  LOOP PRINCIPAL — Todo no bloqueante, usando millis()
// =========================================================================

void loop() {
  leerGPS();                 // 1. Leer GPS sin bloquear
  gestionarWiFi();           // 2. Reconexion WiFi automatica
  gestionarRFID();           // 3. Escuchar tarjetas RFID
  gestionarSync();           // 4. Sincronizar pagos pendientes (Store & Forward)
  gestionarTelemetria();     // 5. Enviar telemetria cada 10 s
  gestionarRelevadores();    // 6. Cerrar torniquete cuando termine el pulso
  actualizarLED();           // 7. LED de estado
}

// =========================================================================
//  MODULO GPS — Lectura no bloqueante de la UART2
// =========================================================================

void leerGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

// =========================================================================
//  MODULO WIFI — Conexion inicial y reconexion automatica
// =========================================================================

// Conexion inicial (solo se ejecuta una vez en setup()). Es bloqueante
// pero con timeout, y mientras espera sigue alimentando al GPS.
void conectarWiFi() {
  estadoLED = ESPERANDO_WIFI;
  Serial.printf("[WiFi] Conectando a '%s'...\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);   // El nucleo ESP32 intenta reconectar solo
  WiFi.setSleep(false);          // Evita que el modem WiFi entre en sleep
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED &&
         (millis() - inicio) < TIEMPO_MAX_WIFI_INICIAL_MS) {
    delay(500);
    Serial.print(F("."));
    leerGPS();   // Seguir procesando GPS mientras conectamos
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("[WiFi] No se pudo conectar. Se reintentara en el loop."));
  }
}

// Reconexion no bloqueante: se llama en cada vuelta del loop.
void gestionarWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long ahora = millis();
  if (ahora - ultimoIntentoWifi >= INTERVALO_RECONEXION_WIFI) {
    ultimoIntentoWifi = ahora;
    estadoLED = ESPERANDO_WIFI;
    Serial.println(F("[WiFi] Conexion perdida. Reintentando..."));
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
}

// Aplica la URL al HTTPClient manejando HTTPS. Con setInsecure() el ESP32
// no valida el certificado del servidor, lo que da maxima compatibilidad
// con Render y evita fallos por certificados vencidos.
void prepararHTTP(HTTPClient& http, const String& url) {
  if (url.startsWith("https")) {
    clienteTLS.setInsecure();
    http.begin(clienteTLS, url);
  } else {
    http.begin(url);
  }
}

// =========================================================================
//  MODULO SENSORES — DHT22, INA219 y eficiencia (mock)
// =========================================================================

void leerSensoresTelemetria() {
  // --- DHT22: temperatura y humedad (lectura ~250 ms, aceptable cada 10 s) ---
  float temp = dht.getTemperature();
  float hum  = dht.getHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println(F("[SENSOR] DHT22 fallo en lectura, se mantiene ultimo valor"));
  } else {
    ultimaTemperatura = temp;
    ultimaHumedad     = hum;
  }

  // --- INA219: voltaje del bus ---
  ultimoVoltaje = ina219.getBusVoltage_V();

  // --- Eficiencia (MOCK TEMPORAL, igual que el firmware previo) ---
  // TODO: Reemplazar por sensores reales cuando existan:
  //   1. pasajeros_actuales: sensores infrarrojos (TCRT5000) en la puerta.
  //   2. luces_perifericos: optoacoplador leyendo el rele de luces.
  //   3. minutos_ralenti: contador cuando speed < 5 km/h y motor encendido.
  pasajeros_actuales = random(0, 45);
  luces_perifericos_encendidos = (random(0, 100) > 50);
  if (gps.speed.isValid() && gps.speed.kmph() < 5.0) {
    minutos_ralenti = random(1, 15);
  } else {
    minutos_ralenti = 0;
  }

  Serial.printf("[SENSOR] Temp=%.2f C | Hum=%.2f %% | Volt=%.2f V | "
                "Pasajeros=%d | Luces=%d | Ralenti=%d min\n",
                ultimaTemperatura, ultimaHumedad, ultimoVoltaje,
                pasajeros_actuales, (int)luces_perifericos_encendidos,
                minutos_ralenti);
}

// =========================================================================
//  MODULO TELEMETRIA — PUT a /api/camiones/update-location cada 10 s
// =========================================================================

void gestionarTelemetria() {
  unsigned long ahora = millis();
  if (ahora - ultimoEnvioTelemetria < INTERVALO_TELEMETRIA_MS) return;
  ultimoEnvioTelemetria = ahora;

  // Solo enviamos con fix GPS valido: enviar (0,0) moveria el camion al
  // medio del oceano en el mapa del backend.
  if (!gps.location.isValid()) {
    estadoLED = ESPERANDO_GPS;
    if (millis() % 30000 < 100) {   // Aviso cada ~30 s sin saturar el Serial
      Serial.printf("[GPS] Esperando fix... Satelites: %d\n", gps.satellites.value());
    }
    return;
  }

  leerSensoresTelemetria();
  enviarTelemetria();
}

void enviarTelemetria() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/camiones/update-location";

  prepararHTTP(http, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);

  // JSON con la telemetria. Los campos temperatura, humedad y voltaje son
  // adicionales: el backend actual los ignora pero el firmware ya los manda.
  StaticJsonDocument<384> doc;
  doc["busId"]                        = BUS_ID;
  doc["lat"]                          = gps.location.lat();
  doc["lng"]                          = gps.location.lng();
  doc["speed"]                        = (int)gps.speed.kmph();
  doc["temperatura"]                  = ultimaTemperatura;
  doc["humedad"]                      = ultimaHumedad;
  doc["voltaje"]                      = ultimoVoltaje;
  doc["pasajeros_actuales"]           = pasajeros_actuales;
  doc["luces_perifericos_encendidos"] = luces_perifericos_encendidos;
  doc["minutos_ralenti"]              = minutos_ralenti;

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.PUT(jsonData);
  String respuesta = http.getString();
  http.end();

  if (httpCode == 200) {
    estadoLED = ENVIANDO_DATOS;
    Serial.printf("[TELEMETRIA] OK | Lat=%.6f Lng=%.6f Speed=%d km/h | HTTP %d\n",
                  gps.location.lat(), gps.location.lng(),
                  (int)gps.speed.kmph(), httpCode);
  } else {
    estadoLED = ERROR_CONEXION;
    Serial.printf("[TELEMETRIA] Error HTTP %d: %s\n", httpCode,
                  respuesta.isEmpty() ? "sin respuesta" : respuesta.c_str());
  }
}

// =========================================================================
//  MODULO RFID — Deteccion de tarjetas y disparo del pago
// =========================================================================

void gestionarRFID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial()) return;

  // Capturar el UID en hexadecimal (el backend lo compara exacto)
  String uidStr = bytesToHex(mfrc522.uid.uidByte, mfrc522.uid.size);
  Serial.printf("[RFID] Tarjeta detectada: %s\n", uidStr.c_str());

  // Liberar el PICC para que no vuelva a leer la misma tarjeta
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  delay(50);  // Pequena espera de estabilidad recomendada por la libreria MFRC522

  procesarUID(uidStr);
}

void procesarUID(const String& uid) {
  // --- Debounce: ignorar el mismo UID por un tiempo (evita cobro doble) ---
  unsigned long ahora = millis();
  if (uid == ultimoUID && (ahora - tiempoUltimoUID) < DEBOUNCE_RFID_MS) {
    Serial.println(F("[RFID] UID repetido, ignorado por debounce"));
    return;
  }
  ultimoUID = uid;
  tiempoUltimoUID = ahora;

  String rutaActual = obtenerRutaActual();

  if (WiFi.status() == WL_CONNECTED) {
    if (enviarPago(uid, rutaActual, 1)) {
      activarTorniquete();
      Serial.println(F("[PAGO] Online — cobro exitoso, abriendo torniquete"));
    } else {
      pushBuffer(uid, rutaActual, 1);
      Serial.println(F("[PAGO] Online pero el servidor rechazo el cobro. Guardado en buffer."));
    }
  } else {
    pushBuffer(uid, rutaActual, 1);
    Serial.println(F("[PAGO] Offline — transaccion guardada en buffer"));
  }
}

// =========================================================================
//  MODULO DE PAGO — POST a /api/pagos/procesar (array con 1 evento)
// =========================================================================

bool enviarPago(const String& uid, const String& rutaId, int cantidad) {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/pagos/procesar";

  prepararHTTP(http, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(10000);

  // El backend espera un ARRAY de eventos
  StaticJsonDocument<200> doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();
  obj["uid"]              = uid;
  obj["rutaId"]           = rutaId;          // Vacio -> el backend usa tarifa global
  obj["cantidad_boletos"] = cantidad;
  obj["camionId"]         = BUS_ID;

  unsigned long ts = epochDesdeGps();
  if (ts > 0) obj["timestamp"] = ts;         // Si no hay fecha GPS, el backend usa Date.now()

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  String respuesta = http.getString();
  http.end();

  // El servidor devuelve 200 aunque el cobro falle. El exito real esta en el body.
  if (httpCode != 200 && httpCode != 201) {
    Serial.printf("[PAGO] HTTP %d: %s\n", httpCode,
                  respuesta.isEmpty() ? "sin respuesta" : respuesta.c_str());
    return false;
  }

  // Parsear detalle[0].estado == "ok"
  DynamicJsonDocument resp(512);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (err) {
    Serial.printf("[PAGO] Error parseando respuesta JSON: %s\n", err.c_str());
    return false;
  }

  const char* estado = resp["detalle"][0]["estado"];
  if (estado && strcmp(estado, "ok") == 0) {
    float saldo = resp["detalle"][0]["saldo_restante"] | -1.0f;
    Serial.printf("[PAGO] OK para UID %s. Saldo restante: %.2f\n",
                  uid.c_str(), saldo);
    return true;
  }

  const char* motivo = resp["detalle"][0]["motivo"];
  Serial.printf("[PAGO] Rechazado para UID %s: %s\n",
                uid.c_str(), motivo ? motivo : "motivo desconocido");
  return false;
}

// =========================================================================
//  STORE & FORWARD — Buffer de pagos offline y sincronizacion en lote
// =========================================================================

void pushBuffer(const String& uid, const String& rutaId, int cantidad) {
  if (colaPendientes.size() >= MAX_BUFFER) {
    Serial.println(F("[BUFFER] LLENO — descartando la transaccion mas antigua"));
    colaPendientes.erase(colaPendientes.begin());
  }

  TransaccionPendiente t;
  t.uid       = uid;
  t.rutaId    = rutaId;
  t.cantidad  = cantidad;
  t.timestamp = epochDesdeGps();
  colaPendientes.push_back(t);

  Serial.printf("[BUFFER] Transaccion guardada. Pendientes: %d\n",
                colaPendientes.size());
}

void gestionarSync() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (colaPendientes.empty()) return;

  unsigned long ahora = millis();
  if (ahora - ultimoSync >= INTERVALO_SYNC_MS) {
    ultimoSync = ahora;
    Serial.printf("[SYNC] Enviando lote de %d transacciones pendientes...\n",
                  colaPendientes.size());
    if (sincronizarBuffer()) {
      Serial.printf("[SYNC] Lote procesado. Quedan pendientes: %d\n",
                    colaPendientes.size());
    } else {
      Serial.println(F("[SYNC] Fallo al sincronizar, se reintentara despues"));
    }
  }
}

bool sincronizarBuffer() {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/pagos/procesar";

  prepararHTTP(http, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(15000);

  // Tamano dinamico para el array completo del buffer
  size_t capacidad = JSON_ARRAY_SIZE(colaPendientes.size())
                   + colaPendientes.size() * JSON_OBJECT_SIZE(5);
  DynamicJsonDocument doc(capacidad);
  JsonArray arr = doc.to<JsonArray>();

  for (const auto& t : colaPendientes) {
    JsonObject obj = arr.createNestedObject();
    obj["uid"]              = t.uid;
    obj["rutaId"]           = t.rutaId;
    obj["cantidad_boletos"] = t.cantidad;
    obj["camionId"]         = BUS_ID;
    if (t.timestamp > 0) obj["timestamp"] = t.timestamp;
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

  // El servidor responde un detalle por cada evento, en el mismo orden.
  // Solo eliminamos del buffer los que el servidor confirmo con "ok".
  DynamicJsonDocument resp(8192);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (err) {
    Serial.printf("[SYNC] Error parseando respuesta: %s\n", err.c_str());
    return false;
  }

  std::vector<TransaccionPendiente> pendientes;
  int i = 0;
  for (const auto& t : colaPendientes) {
    const char* estado = resp["detalle"][i]["estado"];
    if (!estado || strcmp(estado, "ok") != 0) {
      // Se queda en el buffer (sera reintentada o descartada por el admin)
      pendientes.push_back(t);
    }
    i++;
  }
  colaPendientes = pendientes;
  return true;
}

// =========================================================================
//  MODULO RELE — Torniquete con pulso no bloqueante (millis)
// =========================================================================

void activarTorniquete() {
  digitalWrite(RELE_TORNIQUETE, RELE_ON);
  pulsoInicio = millis();
  pulsoActivo = true;
  Serial.printf("[RELAY] Torniquete ABIERTO por %lu ms\n",
                TIEMPO_PULSO_TORNIQUETE_MS);
}

void gestionarRelevadores() {
  if (!pulsoActivo) return;
  if ((millis() - pulsoInicio) >= TIEMPO_PULSO_TORNIQUETE_MS) {
    digitalWrite(RELE_TORNIQUETE, RELE_OFF);
    pulsoActivo = false;
    Serial.println(F("[RELAY] Torniquete CERRADO"));
  }
}

// =========================================================================
//  MODULO LED DE ESTADO — No bloqueante
// =========================================================================

void actualizarLED() {
  unsigned long ahora = millis();
  unsigned long intervalo;

  switch (estadoLED) {
    case ESPERANDO_WIFI: intervalo = 150; break;   // Rapido
    case ESPERANDO_GPS:  intervalo = 500; break;   // Lento
    case ENVIANDO_DATOS:                          // Encendido fijo
      digitalWrite(LED_BUILTIN_PIN, HIGH);
      return;
    case ERROR_CONEXION: intervalo = 250; break;   // Medio
    default:             intervalo = 500; break;
  }

  if (ahora - ultimoParpadeo >= intervalo) {
    ultimoParpadeo = ahora;
    ledEstado = !ledEstado;
    digitalWrite(LED_BUILTIN_PIN, ledEstado);
  }
}

// =========================================================================
//  RUTA ACTUAL — El conductor selecciona la ruta en marcha
// =========================================================================

String obtenerRutaActual() {
  // TODO: Implementar la seleccion de ruta del conductor (boton, selector,
  // o configuracion). Por ahora devolvemos vacio para que el backend use
  // la tarifa global del servidor.
  return "";
}

// =========================================================================
//  UTILERIAS
// =========================================================================

// Convierte el UID de la tarjeta a HEXADECIMAL EN MAYUSCULAS, el mismo
// formato con el que el backend compara contra el campo rfid_uid.
String bytesToHex(byte* buffer, byte bufferSize) {
  String hexStr;
  for (byte i = 0; i < bufferSize; i++) {
    if (buffer[i] < 0x10) hexStr += "0";
    hexStr += String(buffer[i], HEX);
  }
  hexStr.toUpperCase();
  return hexStr;
}

// Convierte la fecha/hora del GPS a epoch Unix (segundos desde 1970).
// Devuelve 0 si el GPS no tiene fecha/hora valida (el backend usara Date.now()).
// Implementa el algoritmo estandar "days from civil" (Howard Hinnant).
unsigned long epochDesdeGps() {
  if (!gps.date.isValid() || !gps.time.isValid()) return 0;

  int y = gps.date.year();
  int m = gps.date.month();
  int d = gps.date.day();

  y -= (m <= 2) ? 1 : 0;
  const int era = (y >= 0 ? y : y - 399) / 400;
  const unsigned yoe = (unsigned)(y - era * 400);
  const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  const long dias = (long)era * 146097 + (long)doe - 719468;

  return (unsigned long)dias * 86400UL
       + (unsigned long)gps.time.hour() * 3600UL
       + (unsigned long)gps.time.minute() * 60UL
       + (unsigned long)gps.time.second();
}
