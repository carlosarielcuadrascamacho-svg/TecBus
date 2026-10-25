/*
  =============================================================================
  DIAGNÓSTICO DEDICADO MFRC522 (RFID) PARA ESP32 (30 PINES)
  =============================================================================
  Pines VSPI cable Cat 5e:
    SCK  -> GPIO 18
    MISO -> GPIO 19
    MOSI -> GPIO 23
    SDA  -> GPIO 5  (SS / CS)
    RST  -> GPIO 4
    3.3V -> 3.3V
    GND  -> GND
  =============================================================================
*/

#include <SPI.h>
#define MFRC522_SPICLOCK 500000u
#include <MFRC522.h>

#define SS_PIN  5
#define RST_PIN 4

MFRC522 rfid(SS_PIN, RST_PIN);
unsigned long ultimoChequeo = 0;
bool moduloDetectado = false;

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println(F("\n========================================================"));
  Serial.println(F("  TEST DEDICADO DE HARDWARE MFRC522 (RFID RC522)"));
  Serial.println(F("  Frecuencia SPI reducida a 500 kHz (Cable Cat 5e 1m)"));
  Serial.println(F("========================================================"));

  pinMode(RST_PIN, OUTPUT);
  digitalWrite(RST_PIN, LOW);
  delay(20);
  digitalWrite(RST_PIN, HIGH);
  delay(50);

  SPI.begin(18, 19, 23, 5); // SCK, MISO, MOSI, SS
  delay(50);

  probarModulo();
}

void probarModulo() {
  rfid.PCD_Init();
  delay(50);
  rfid.PCD_SetAntennaGain(rfid.RxGain_max);

  byte version = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("\n[DIAGNOSTICO] Registro VersionReg (0x37): 0x%02X\n", version);
  Serial.print(F("[DIAGNOSTICO] "));
  rfid.PCD_DumpVersionToSerial();

  if (version == 0x00 || version == 0xFF) {
    moduloDetectado = false;
    Serial.println(F("⚠️ ESTADO: SIN COMUNICACIÓN. Revisa VCC (3.3V), GND, RST y SDA"));
  } else {
    moduloDetectado = true;
    Serial.println(F("✅ ESTADO: MODULO DETECTADO Y LISTO. Acerca una tarjeta RFID..."));
  }
}

void loop() {
  // Si no está detectado, reintentar cada 2 segundos para dar tiempo a ajustar cables
  if (!moduloDetectado) {
    if (millis() - ultimoChequeo >= 2000) {
      ultimoChequeo = millis();
      Serial.println(F("\n[REINTENTO] Probando comunicación SPI con RC522..."));
      probarModulo();
    }
    return;
  }

  // Si está detectado, escuchar tarjetas continuamente
  if (!rfid.PICC_IsNewCardPresent()) return;
  if (!rfid.PICC_ReadCardSerial()) return;

  Serial.println(F("\n🎉 ¡TARJETA DETECTADA!"));
  Serial.print(F("   UID: "));
  for (byte i = 0; i < rfid.uid.size; i++) {
    Serial.printf("%02X ", rfid.uid.uidByte[i]);
  }
  Serial.println();

  MFRC522::PICC_Type piccType = rfid.PICC_GetType(rfid.uid.sak);
  Serial.printf("   Tipo: %s\n", rfid.PICC_GetTypeName(piccType));
  Serial.println(F("--------------------------------------------------------"));

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  delay(1000); // Pausa para evitar lecturas consecutivas del mismo pase
}
