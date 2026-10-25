#!/usr/bin/env python3
import os, sys, select, termios, time

PORT = '/dev/ttyUSB0'
BAUD = termios.B115200

if not os.path.exists(PORT):
    print(f"❌ Error: No se encontró el puerto {PORT}. ¿Está conectada la ESP32?")
    sys.exit(1)

fd = os.open(PORT, os.O_RDWR | os.O_NOCTTY)
attr = termios.tcgetattr(fd)
attr[4] = BAUD
attr[5] = BAUD
attr[0] = 0
attr[1] = 0
attr[2] = termios.CS8 | termios.CREAD | termios.CLOCAL
attr[3] = 0
termios.tcsetattr(fd, termios.TCSANOW, attr)

print(f"📡 Conectado a {PORT} a 115200 baudios.")
print("💡 Escribe 'e' y presiona Enter para ver el reporte de estado completo.")
print("💡 Escribe 'r' y presiona Enter para resetear el contador de pasajeros.")
print("Presiona Ctrl+C para salir.\n" + "="*60)

try:
    while True:
        r, _, _ = select.select([fd, sys.stdin], [], [])
        if fd in r:
            data = os.read(fd, 1024)
            if data:
                sys.stdout.write(data.decode('utf-8', errors='replace'))
                sys.stdout.flush()
        if sys.stdin in r:
            line = sys.stdin.readline()
            os.write(fd, line.encode('utf-8'))
except KeyboardInterrupt:
    print("\nDesconectado del puerto serial.")
finally:
    os.close(fd)
