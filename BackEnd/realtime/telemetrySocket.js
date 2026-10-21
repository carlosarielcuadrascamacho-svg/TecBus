// backend/realtime/telemetrySocket.js
//
// Canal WebSocket para telemetría de los ESP32.
// Mantiene una sola conexión TLS abierta y recibe lotes de puntos GPS,
// evitando el handshake HTTPS en cada envío.
//
// El ESP32 se autentica con el header x-api-key durante el handshake.

const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { procesarPuntoTelemetria } = require("../services/telemetryService");

const RUTA_WS = "/ws/telemetry";
const MAX_PUNTOS_POR_LOTE = 20;
const INTERVALO_PING_MS = 30000;

function claveValida(recibida) {
  const esperada = process.env.API_KEY_ESP32;
  if (!esperada || typeof recibida !== "string") return false;

  const bufferRecibida = Buffer.from(recibida);
  const bufferEsperada = Buffer.from(esperada);

  return (
    bufferRecibida.length === bufferEsperada.length &&
    crypto.timingSafeEqual(bufferRecibida, bufferEsperada)
  );
}

function iniciarWebSocketTelemetria(server, io) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 16 * 1024,
    perMessageDeflate: false,
  });

  server.on("upgrade", (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch {
      return;
    }

    // Dejamos pasar los upgrades de Socket.io y de cualquier otra ruta.
    if (pathname !== RUTA_WS) return;

    if (!claveValida(req.headers["x-api-key"])) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

    console.log("📡 ESP32 conectado al WebSocket de telemetría");

    ws.on("message", async (data, isBinary) => {
      if (isBinary) return;

      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }

      const puntos = Array.isArray(payload?.points) ? payload.points : [payload];
      const busId = typeof payload?.busId === "string" ? payload.busId.trim() : "";

      if (
        !busId ||
        puntos.length === 0 ||
        puntos.length > MAX_PUNTOS_POR_LOTE ||
        !puntos.every((p) => p && typeof p === "object" && !Array.isArray(p))
      ) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "error", message: "Lote de telemetría inválido" }));
        }
        return;
      }

      let procesados = 0;
      let fallidos = 0;

      for (let i = 0; i < puntos.length; i++) {
        try {
          const resultado = await procesarPuntoTelemetria(
            { ...puntos[i], busId },
            io,
            { prediccion: i === puntos.length - 1 }
          );

          if (resultado.ok) {
            procesados++;
          } else {
            fallidos++;
            console.warn(
              `⚠️ Telemetría WS rechazada (${busId}): ${resultado.code} ${resultado.message}`
            );
          }
        } catch (error) {
          fallidos++;
          console.error(`❌ Error procesando telemetría WS (${busId}):`, error.message);
        }
      }

      // Sin acuse en cada lote para no gastar datos. Solo avisamos si algo falló.
      if (fallidos > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `${fallidos} punto(s) no procesado(s)`,
            procesados,
            fallidos,
          })
        );
      }
    });

    ws.on("close", () => {
      console.log("📡 ESP32 desconectado del WebSocket de telemetría");
    });

    ws.on("error", (error) => {
      console.error("❌ Error WebSocket de telemetría:", error.message);
    });
  });

  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, INTERVALO_PING_MS);

  wss.on("close", () => clearInterval(heartbeat));

  console.log(`📡 WebSocket de telemetría escuchando en ${RUTA_WS}`);
  return wss;
}

module.exports = { iniciarWebSocketTelemetria };
