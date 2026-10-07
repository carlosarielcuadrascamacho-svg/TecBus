/*
=============================================================================
  SMARTBUS / TECBUS — FIRMWARE LIGERO ESP32 (30 PINES)
  Version MINIMA: GPS + RFID (pagos) + Store & Forward
  Optimizado para: subida rapida, pocas librerias y bajo consumo de datos
=============================================================================

  QUE HACE ESTA VERSION:
    - Envia la ubicacion GPS al servidor SOLO cuando el camion se mueve
      (ahorro de datos moviles / internet).
    - Lee tarjetas RFID y envia el pago a /api/pagos/procesar.
    - Si no hay internet al pasar la tarjeta, la guarda en un buffer y la
      sincroniza en lote cuando se recupera la conexion.
    - Sin rele, sin sensores de temperatura/humedad, sin INA219.

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
      RST  -> GPIO 4
      SCK  -> GPIO 18
      MISO -> GPIO 19
      MOSI -> GPIO 23

    LED de estado -> GPIO 2 (LED integrado del ESP32)

  LIBRERIAS REQUERIDAS (Gestor de Librerias de Arduino):
    - TinyGPSPlus        (Mikal Hart)
    - ArduinoJson v6     (Benoit Blanchon)  <-- OBLIGATORIO VERSION 6
    - MFRC522            (Miguel Balboa)
    (WiFi, HTTPClient, WiFiClientSecure y SPI vienen incluidas)

  PLACA EN ARDUINO IDE: "ESP32 Dev Module"
    - Upload Speed : 115200
    - Flash Size   : 4MB

  ENDPOINTS USADOS (backend ya desplegado en internet):
    - Ubicacion: PUT /api/camiones/update-location  {busId, lat, lng}
    - Pago:      POST /api/pagos/procesar  (header x-api-key, body = array)

  AHORRO DE DATOS (logica "smart"):
    - Evalua cada 60 segundos si conviene enviar la posicion:
        * Se movio >= 20 m desde el ultimo punto enviado  -> envia
        * Va en movimiento (>1 km/h)                      -> envia
        * Detenido: solo un "latido" cada 5 minutos       -> envia
    - Esto reduce de ~360 envios/hora a ~30-60 envios/hora.
=============================================================================
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <TinyGPSPlus.h>
#include <SPI.h>
#include <MFRC522.h>
#include <vector>

// =========================================================================
//  CONFIGURACION — CAMBIA SEGUN TU CAMION Y TU RED
// =========================================================================

const char* WIFI_SSID = "Carlos04";
const char* WIFI_PASS = "1234567895";

// Servidor TecBus ya desplegado en internet
const char* SERVER_URL = "https://tecbus-api.onrender.com";
// Para pruebas locales descomenta la siguiente linea (IP de tu PC):
// const char* SERVER_URL = "http://192.168.1.100:5000";

// API Key del backend (debe coincidir con API_KEY_ESP32 del .env)
const char* API_KEY = "sm4rtbus_p4g0s_2026";

// Identificador del camion: DEBE ser el "numeroUnidad" en MongoDB
const char* BUS_ID = "U001";

// =========================================================================
//  INTERVALOS Y UMBRALES
// =========================================================================

const unsigned long INTERVALO_SMART_MS     = 60000;  // Evaluar posicion cada 60 s
const double        DISTANCIA_MINIMA_M     = 20.0;   // Enviar si se movio >= 20 m
const unsigned long INTERVALO_LATIDO_MS    = 300000; // Latido estando detenido (5 min)
const unsigned long INTERVALO_RECONEXION_WIFI = 15000; // Reintentar WiFi cada 15 s
const unsigned long DEBOUNCE_RFID_MS       = 3000;   // Ignorar mismo UID por 3 s
const unsigned long INTERVALO_SYNC_MS      = 5000;   // Reintentar lote cada 5 s
const unsigned long TIEMPO_MAX_WIFI_INICIAL_MS = 10000; // Timeout conexion inicial

// =========================================================================
//  PINES
// =========================================================================

static const int RX2_PIN         = 16;  // UART2 RX  -> GPS TX
static const int TX2_PIN         = 17;  // UART2 TX  -> GPS RX
static const int RFID_SS_PIN     = 5;   // SPI SS del MFRC522
static const int RFID_RST_PIN    = 4;   // RST del MFRC522
static const int LED_BUILTIN_PIN = 2;   // LED integrado de estado

// =========================================================================
//  OBJETOS GLOBALES
// =========================================================================

TinyGPSPlus gps;
HardwareSerial gpsSerial(2);              // UART2 para el GPS
MFRC522 mfrc522(RFID_SS_PIN, RFID_RST_PIN);
WiFiClientSecure clienteTLS;              // Cliente TLS para HTTPS

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
//  CONTROL DE TIEMPO (millis)
// =========================================================================

unsigned long ultimoIntentoWifi = 0;
unsigned long ultimoParpadeo    = 0;
bool ledEstado                  = false;

// Ultimo punto de ubicacion enviado (para la logica "smart")
bool   hayPrimerEnvio    = false;
double ultimoLatEnviado  = 0.0;
double ultimoLngEnviado  = 0.0;
unsigned long ultimoEnvioOK = 0;

// Diagnostico por Monitor Serie (cada 30 s y ante movimientos)
unsigned long ultimoLogEstado = 0;
bool tuvoFixPrevio            = false;

// Debounce del RFID
String ultimoUID            = "";
unsigned long tiempoUltimoUID = 0;

// =========================================================================
//  BUFFER STORE & FORWARD (pagos hechos sin internet)
// =========================================================================

struct TransaccionPendiente {
  String uid;
  String rutaId;
  int    cantidad;
  unsigned long timestamp;   // epoch Unix (0 si el GPS no tenia fecha valida)
};

std::vector<TransaccionPendiente> colaPendientes;
static const size_t MAX_BUFFER = 50;
unsigned long ultimoSync = 0;

// =========================================================================
//  FEEDBACK POR LED (retroalimentacion de los pagos, no bloqueante)
// =========================================================================

struct FeedbackLED {
  bool activo;
  unsigned long inicio;
  int    parpadeos;
  unsigned long onMs;
  unsigned long offMs;
};

FeedbackLED feedback = { false, 0, 0, 0, 0 };

// =========================================================================
//  RESULTADO DEL PAGO (para distinguir rechazo vs fallo de red)
// =========================================================================

enum ResultadoPago {
  PAGO_OK,          // El servidor aprobo el cobro
  PAGO_RECHAZADO,   // El servidor nego (saldo insuficiente, UID no registrado)
  PAGO_ERROR_RED    // No se pudo comunicar (se guarda en el buffer)
};

// =========================================================================
//  PROTOTIPOS
// =========================================================================

void leerGPS();
void conectarWiFi();
void gestionarWiFi();
void prepararHTTP(HTTPClient& http, const String& url);
void gestionarUbicacion();
bool enviarUbicacion(double lat, double lng);
void gestionarLogEstado();
void imprimirEstadoGPS();
void gestionarRFID();
void procesarUID(const String& uid);
ResultadoPago enviarPago(const String& uid, const String& rutaId, int cantidad);
void pushBuffer(const String& uid, const String& rutaId, int cantidad);
bool sincronizarBuffer();
void gestionarSync();
void mostrarFeedback(int parpadeos, unsigned long onMs, unsigned long offMs);
void gestionarFeedback();
void actualizarLED();
String bytesToHex(byte* buffer, byte bufferSize);
unsigned long epochDesdeGps();

// =========================================================================
//  SETUP
// =========================================================================

void setup() {
  Serial.begin(115200);
  Serial.println(F("\n=============================================="));
  Serial.println(F("  SMARTBUS / TECBUS — FIRMWARE LIGERO (GPS+RFID)"));
  Serial.println(F("=============================================="));

  pinMode(LED_BUILTIN_PIN, OUTPUT);
  digitalWrite(LED_BUILTIN_PIN, LOW);

  // GPS en UART2 (9600 baudios es el estandar del NEO M8N)
  gpsSerial.begin(9600, SERIAL_8N1, RX2_PIN, TX2_PIN);
  Serial.println(F("[GPS] UART2 iniciado (RX=GPIO16, TX=GPIO17) @9600"));

  // RFID por SPI
  SPI.begin();
  mfrc522.PCD_Init();
  delay(100);  // Estabilizacion del modulo RFID
  Serial.println(F("[RFID] MFRC522 iniciado (SPI, SS=5, RST=4)"));

  // Cliente TLS sin verificacion de certificado (compatibilidad maxima)
  clienteTLS.setInsecure();

  // Conexion WiFi inicial
  conectarWiFi();

  Serial.println(F("\n[SYSTEM] Listo. Entrando al loop principal."));
}

// =========================================================================
//  LOOP PRINCIPAL — Todo no bloqueante, usando millis()
// =========================================================================

void loop() {
  leerGPS();                 // 1. Leer GPS sin bloquear
  gestionarWiFi();           // 2. Reconexion WiFi automatica
  gestionarFeedback();       // 3. Feedback LED de los pagos (prioridad alta)
  gestionarRFID();           // 4. Escuchar tarjetas RFID
  gestionarSync();           // 5. Sincronizar pagos pendientes
  gestionarLogEstado();      // 6. Diagnostico GPS por Serial (cada 30 s)
  gestionarUbicacion();      // 7. Enviar ubicacion SOLO cuando conviene
  actualizarLED();           // 8. LED de estado
}

// =========================================================================
//  MODULO GPS — Lectura no bloqueante de la UART2
// =========================================================================

void leerGPS() {
  while (gpsSerial.available() > 0) {
    gps.encode(gpsSerial.read());
  }
}

// Diagnostico GPS: imprime el estado general cada 30 s para saber que el
// modulo sigue vivo (y avisa cuando se adquiere el fix).
void gestionarLogEstado() {
  unsigned long ahora = millis();
  if (ahora - ultimoLogEstado < 30000) return;
  ultimoLogEstado = ahora;

  // Avisar cuando se consigue el fix por primera vez o se recupera
  if (gps.location.isValid()) {
    if (!tuvoFixPrevio) {
      Serial.println(F("[GPS] Fix GPS adquirido"));
      tuvoFixPrevio = true;
    }
  } else {
    if (tuvoFixPrevio) Serial.println(F("[GPS] Se perdio el fix, buscando senal..."));
    tuvoFixPrevio = false;
  }

  imprimirEstadoGPS();
}

// Imprime el estado actual del GPS en una sola linea.
void imprimirEstadoGPS() {
  Serial.printf("[GPS] Fix: %s | Satelites: %d | ",
                gps.location.isValid() ? "SI" : "NO",
                gps.satellites.value());

  if (gps.location.isValid()) {
    double lat = gps.location.lat();
    double lng = gps.location.lng();
    double d = hayPrimerEnvio
               ? gps.distanceBetween(ultimoLatEnviado, ultimoLngEnviado, lat, lng)
               : 0.0;

    Serial.printf("Lat=%.6f Lng=%.6f | Vel=%.1f km/h | Movido=%.1f m",
                  lat, lng,
                  gps.speed.isValid() ? gps.speed.kmph() : 0.0, d);
  } else {
    Serial.print(F("Esperando senal GPS..."));
  }

  if (gps.date.isValid() && gps.time.isValid()) {
    Serial.printf(" | %02d/%02d/%04d %02d:%02d:%02d",
                  gps.date.day(), gps.date.month(), gps.date.year(),
                  gps.time.hour(), gps.time.minute(), gps.time.second());
  }
  Serial.println();
}

// =========================================================================
//  MODULO WIFI — Conexion inicial y reconexion automatica
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
    leerGPS();   // Seguir procesando GPS mientras conectamos
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[WiFi] Conectado. IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println(F("[WiFi] No se pudo conectar. Se reintentara en el loop."));
  }
}

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

// Aplica la URL al HTTPClient manejando HTTPS (sin validar certificado).
void prepararHTTP(HTTPClient& http, const String& url) {
  if (url.startsWith("https")) {
    clienteTLS.setInsecure();
    http.begin(clienteTLS, url);
  } else {
    http.begin(url);
  }
}

// =========================================================================
//  MODULO UBICACION — Logica "smart" para ahorrar datos
// =========================================================================

void gestionarUbicacion() {
  unsigned long ahora = millis();
  if (ahora - ultimoEnvioOK < INTERVALO_SMART_MS && hayPrimerEnvio) return;
  if (!gps.location.isValid()) return;   // El estado se reporta en gestionarLogEstado

  double lat = gps.location.lat();
  double lng = gps.location.lng();

  bool enMovimiento = gps.speed.isValid() && gps.speed.kmph() > 1.0;

  // Distancia recorrida desde el ultimo punto enviado
  double d = 0.0;
  if (hayPrimerEnvio) {
    d = gps.distanceBetween(ultimoLatEnviado, ultimoLngEnviado, lat, lng);
  }

  // Decidir si conviene enviar
  bool enviar = false;

  if (!hayPrimerEnvio) {
    enviar = true;
    Serial.println(F("[GPS] Primer punto valido: se envia ubicacion inicial"));
  } else if (d >= DISTANCIA_MINIMA_M) {
    enviar = true;
    Serial.printf("[GPS] MOVIMIENTO detectado: %.1f m desde el ultimo envio\n", d);
  } else if (enMovimiento) {
    enviar = true;
    Serial.println(F("[GPS] En movimiento: se actualiza la ubicacion"));
  } else if (ahora - ultimoEnvioOK >= INTERVALO_LATIDO_MS) {
    enviar = true;
    Serial.println(F("[GPS] Detenido: latido de mantenimiento"));
  } else {
    Serial.printf("[GPS] Detenido, sin movimiento (%.1f m). No se envia.\n", d);
  }

  if (!enviar) return;

  if (enviarUbicacion(lat, lng)) {
    ultimoLatEnviado = lat;
    ultimoLngEnviado = lng;
    ultimoEnvioOK    = millis();
    hayPrimerEnvio   = true;
  } else {
    // Si fallo, NO se actualiza el ultimo punto: se reintentara el proximo ciclo
    Serial.println(F("[GPS] Fallo al enviar; se reintentara en el proximo ciclo"));
  }
}

// Envia la posicion minimizada (solo busId, lat, lng) al backend.
bool enviarUbicacion(double lat, double lng) {
  if (WiFi.status() != WL_CONNECTED) {
    estadoLED = ESPERANDO_WIFI;
    return false;
  }

  HTTPClient http;
  String url = String(SERVER_URL) + "/api/camiones/update-location";
  prepararHTTP(http, url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(8000);

  StaticJsonDocument<128> doc;
  doc["busId"] = BUS_ID;
  doc["lat"]   = lat;
  doc["lng"]   = lng;

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.PUT(jsonData);
  http.end();

  if (httpCode == 200) {
    estadoLED = ENVIANDO_DATOS;
    Serial.printf("[GPS] OK | Lat=%.6f Lng=%.6f | HTTP %d\n", lat, lng, httpCode);
    return true;
  }

  estadoLED = ERROR_CONEXION;
  Serial.printf("[GPS] Error HTTP %d\n", httpCode);
  return false;
}

// =========================================================================
//  MODULO RFID — Deteccion de tarjetas y disparo del pago
// =========================================================================

void gestionarRFID() {
  if (!mfrc522.PICC_IsNewCardPresent()) return;
  if (!mfrc522.PICC_ReadCardSerial()) return;

  String uidStr = bytesToHex(mfrc522.uid.uidByte, mfrc522.uid.size);
  Serial.printf("[RFID] Tarjeta detectada: %s\n", uidStr.c_str());

  mfrc522.PICC_HaltA();
  mfrc522.PICC_StopCrypto1();
  delay(50);  // Pequena espera de estabilidad recomendada por la libreria

  procesarUID(uidStr);
}

void procesarUID(const String& uid) {
  // Debounce: ignorar el mismo UID por un tiempo (evita cobro doble)
  unsigned long ahora = millis();
  if (uid == ultimoUID && (ahora - tiempoUltimoUID) < DEBOUNCE_RFID_MS) {
    Serial.println(F("[RFID] UID repetido, ignorado por debounce"));
    return;
  }
  ultimoUID = uid;
  tiempoUltimoUID = ahora;

  if (WiFi.status() == WL_CONNECTED) {
    ResultadoPago r = enviarPago(uid, "", 1);
    switch (r) {
      case PAGO_OK:
        mostrarFeedback(2, 150, 150);   // 2 parpadeos rapidos = aprobado
        Serial.println(F("[PAGO] Online — cobro aprobado"));
        break;
      case PAGO_RECHAZADO:
        mostrarFeedback(3, 150, 150);   // 3 parpadeos rapidos = rechazado
        Serial.println(F("[PAGO] Online — el servidor rechazo el cobro"));
        break;
      case PAGO_ERROR_RED:
        pushBuffer(uid, "", 1);
        mostrarFeedback(1, 800, 200);   // 1 parpadeo largo = error de red
        Serial.println(F("[PAGO] Fallo de red — guardado en buffer"));
        break;
    }
  } else {
    pushBuffer(uid, "", 1);
    mostrarFeedback(1, 800, 200);
    Serial.println(F("[PAGO] Offline — transaccion guardada en buffer"));
  }
}

// =========================================================================
//  MODULO DE PAGO — POST a /api/pagos/procesar (array con 1 evento)
// =========================================================================

ResultadoPago enviarPago(const String& uid, const String& rutaId, int cantidad) {
  HTTPClient http;
  String url = String(SERVER_URL) + "/api/pagos/procesar";

  prepararHTTP(http, url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  http.setTimeout(8000);

  // El backend espera un ARRAY de eventos
  StaticJsonDocument<200> doc;
  JsonArray arr = doc.to<JsonArray>();
  JsonObject obj = arr.createNestedObject();
  obj["uid"]              = uid;
  obj["rutaId"]           = rutaId;          // Vacio -> tarifa global
  obj["cantidad_boletos"] = cantidad;
  obj["camionId"]         = BUS_ID;

  unsigned long ts = epochDesdeGps();
  if (ts > 0) obj["timestamp"] = ts;         // Si no hay fecha GPS, el backend usa Date.now()

  String jsonData;
  serializeJson(doc, jsonData);

  int httpCode = http.POST(jsonData);
  String respuesta = http.getString();
  http.end();

  // El servidor devuelve 200 aun si el cobro falla: el exito va en el body
  if (httpCode != 200 && httpCode != 201) {
    return PAGO_ERROR_RED;
  }

  DynamicJsonDocument resp(512);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (err) return PAGO_ERROR_RED;

  const char* estado = resp["detalle"][0]["estado"];
  if (estado && strcmp(estado, "ok") == 0) {
    return PAGO_OK;
  }

  const char* motivo = resp["detalle"][0]["motivo"];
  Serial.printf("[PAGO] Rechazado para UID %s: %s\n",
                uid.c_str(), motivo ? motivo : "motivo desconocido");
  return PAGO_RECHAZADO;
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
    Serial.printf("[SYNC] Enviando lote de %d transacciones...\n",
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

  // Si el servidor respondio, ya proceso todo. Vaciamos el buffer y
  // reportamos (no reintentamos lo que el servidor ya rechazo).
  if (httpCode != 200 && httpCode != 201) {
    return false;
  }

  int aprobadas = 0, rechazadas = 0;
  DynamicJsonDocument resp(8192);
  DeserializationError err = deserializeJson(resp, respuesta);
  if (!err) {
    aprobadas = resp["procesadas"] | 0;
    rechazadas = resp["fallidas"] | 0;
  }

  colaPendientes.clear();
  Serial.printf("[SYNC] Aprobadas: %d | Rechazadas: %d\n", aprobadas, rechazadas);
  return true;
}

// =========================================================================
//  FEEDBACK LED — Patrones no bloqueantes para los pagos
// =========================================================================

void mostrarFeedback(int parpadeos, unsigned long onMs, unsigned long offMs) {
  feedback.activo     = true;
  feedback.inicio     = millis();
  feedback.parpadeos  = parpadeos;
  feedback.onMs       = onMs;
  feedback.offMs      = offMs;
}

void gestionarFeedback() {
  if (!feedback.activo) return;

  unsigned long ahora = millis();
  unsigned long ciclo = feedback.parpadeos * (feedback.onMs + feedback.offMs);

  if (ahora - feedback.inicio >= ciclo) {
    feedback.activo = false;
    digitalWrite(LED_BUILTIN_PIN, LOW);
    return;
  }

  unsigned long t = (ahora - feedback.inicio) % (feedback.onMs + feedback.offMs);
  digitalWrite(LED_BUILTIN_PIN, t < feedback.onMs ? HIGH : LOW);
}

// =========================================================================
//  MODULO LED DE ESTADO — No bloqueante
// =========================================================================

void actualizarLED() {
  if (feedback.activo) return;   // El feedback del pago tiene prioridad

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
//  UTILERIAS
// =========================================================================

// Convierte el UID de la tarjeta a HEXADECIMAL EN MAYUSCULAS (formato del
// backend: campo rfid_uid del usuario).
String bytesToHex(byte* buffer, byte bufferSize) {
  String hexStr;
  for (byte i = 0; i < bufferSize; i++) {
    if (buffer[i] < 0x10) hexStr += "0";
    hexStr += String(buffer[i], HEX);
  }
  hexStr.toUpperCase();
  return hexStr;
}

// Convierte la fecha/hora del GPS a epoch Unix. Devuelve 0 si no hay
// fecha/hora valida (el backend usara Date.now()).
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
