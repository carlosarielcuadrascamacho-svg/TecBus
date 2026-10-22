// backend/server.js

require("dotenv").config();
const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

// --- SEGURIDAD: secreto JWT ---
// Sin JWT_SECRET no se puede firmar ni verificar sesiones. Es mejor fallar
// al arrancar que generar un secreto temporal que invalide sesiones en cada reinicio.
if (!process.env.JWT_SECRET) {
  console.error(
    "❌ JWT_SECRET no está definido. Configúralo en el entorno (Render → Environment) antes de arrancar."
  );
  process.exit(1);
}

// Importamos los Modelos
const Camion = require("./models/Camion");
const Horario = require("./models/Horario");
const Notificacion = require("./models/Notificacion");
const User = require("./models/User");

// Importamos las rutas
const authRoutes = require("./routes/auth");
const camionRoutes = require("./routes/camiones");
const rutaRoutes = require("./routes/rutas");
const horarioRoutes = require("./routes/horarios");
const userRoutes = require("./routes/users");
const notificacionRoutes = require("./routes/notificaciones");
const historialRoutes = require("./routes/historial");
const taquillaRoutes = require("./routes/taquilla");
const pagoRoutes = require("./routes/pagos");
const transaccionRoutes = require("./routes/transacciones");
const { startAnalyticsJobs, detenerAnalyticsJobs } = require("./analytics/cronJobs");
const { iniciarWebSocketTelemetria } = require("./realtime/telemetrySocket");
const { buscarCamion, puedeOperarUnidad } = require("./utils/unidad");
const { diasBusquedaHoy } = require("./utils/dias");

// --- SEGURIDAD: orígenes permitidos (CORS) ---
const origenesConfigurados =
  process.env.CORS_ORIGINS ||
  "https://smartbus-mx.onrender.com,https://tecbus-api.onrender.com,http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000,http://127.0.0.1:3000";

if (process.env.NODE_ENV === "production" && !process.env.CORS_ORIGINS) {
  console.warn(
    "⚠️  CORS_ORIGINS no está definido. Se usarán los dominios por defecto de TecBus."
  );
}

const ORIGENES_PERMITIDOS = origenesConfigurados
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const esOrigenPermitido = (origin) =>
  !origin || ORIGENES_PERMITIDOS.includes(origin);

// 2. Inicializar la aplicación
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ORIGENES_PERMITIDOS,
    methods: ["GET", "POST"],
  },
});

// --- SEGURIDAD: autenticación de Socket.io con el mismo JWT de la API ---
io.use(async (socket, next) => {
  try {
    const authToken = socket.handshake.auth?.token;
    const headerToken = String(socket.handshake.headers.authorization || "")
      .replace(/^Bearer\s+/i, "");
    const token = authToken || headerToken;

    if (!token) return next(new Error("No autorizado"));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("nombre tipo");

    if (!user) return next(new Error("Usuario no autorizado"));

    socket.data.user = user;
    next();
  } catch (error) {
    next(new Error("No autorizado"));
  }
});

// Compartir io con las rutas
app.set("io", io);

// Canal WebSocket persistente para la telemetría de los ESP32.
const telemetryWss = iniciarWebSocketTelemetria(server, io);

const PORT = process.env.PORT || 5000;
let cerrando = false;

// 3. Middlewares de seguridad
app.set("trust proxy", 1); // Render está detrás de 1 proxy (necesario para contar IPs en el rate limit)
app.disable("x-powered-by");
app.use(
  helmet({
    // La app carga scripts/CDN y usa scripts inline, por eso sin CSP:
    contentSecurityPolicy: false,
    // El frontend (otro dominio) consume la API por CORS:
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(
  cors({
    origin: (origin, callback) => {
      if (esOrigenPermitido(origin)) return callback(null, true);
      console.warn(`⛔ CORS bloqueado desde origen no permitido: ${origin}`);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
  })
);
app.use(express.json({ limit: "100kb" }));

// Health check para Render: refleja también el estado de MongoDB.
app.get("/health", (req, res) => {
  const mongoConectado = mongoose.connection.readyState === 1;
  res.status(mongoConectado ? 200 : 503).json({
    status: mongoConectado ? "ok" : "degraded",
    mongo: mongoConectado ? "connected" : "disconnected",
    uptime: process.uptime(),
  });
});

// Servir el frontend estático cuando el backend se despliega como un solo servicio.
app.use(express.static(path.join(__dirname, "..", "FrontEnd")));

// Límite de peticiones contra fuerza bruta en login/registro
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Demasiados intentos. Intenta de nuevo en 15 minutos." },
});

// 4. Conectar a la Base de Datos y arrancar solo si la conexión es exitosa
const MONGO_URI = process.env.MONGO_URI;

async function iniciarServidor() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ Conectado a MongoDB Atlas");
    startAnalyticsJobs(io);
    server.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ Error al conectar a MongoDB:", err.message);
    process.exit(1);
  }
}

async function cerrarServidor(signal, codigoSalida = 0) {
  if (cerrando) return;
  cerrando = true;
  console.log(`🛑 Recibida señal ${signal}. Cerrando servidor...`);

  const timeout = setTimeout(() => {
    console.error("❌ El cierre no terminó a tiempo.");
    process.exit(1);
  }, 15000);
  timeout.unref();

  try {
    detenerAnalyticsJobs();

    if (telemetryWss) {
      for (const cliente of telemetryWss.clients) {
        cliente.close(1001, "Servidor cerrando");
      }
      await new Promise((resolve) => telemetryWss.close(() => resolve()));
    }

    io.disconnectSockets(true);

    const cierreHttp = new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (typeof server.closeAllConnections === "function") {
      server.closeAllConnections();
    }
    await cierreHttp;

    await mongoose.disconnect();
    clearTimeout(timeout);
    console.log("✅ Conexiones cerradas correctamente.");
    process.exit(codigoSalida);
  } catch (error) {
    clearTimeout(timeout);
    console.error("❌ Error cerrando el servidor:", error.message);
    process.exit(1);
  }
}

process.on("SIGTERM", () => cerrarServidor("SIGTERM", 0));
process.on("SIGINT", () => cerrarServidor("SIGINT", 0));
process.on("unhandledRejection", (reason) => {
  console.error("❌ Promesa rechazada sin manejar:", reason);
  cerrarServidor("unhandledRejection", 1);
});
process.on("uncaughtException", (error) => {
  console.error("❌ Excepción no controlada:", error);
  process.exit(1);
});

// 5. Rutas
app.use("/api/auth", authLimiter, authRoutes);
app.use("/api/camiones", camionRoutes);
app.use("/api/rutas", rutaRoutes);
app.use("/api/horarios", horarioRoutes);
app.use("/api/users", userRoutes);
app.use("/api/notificaciones", notificacionRoutes);
app.use('/api/historial', historialRoutes);
app.use("/api/taquilla", taquillaRoutes);
app.use("/api/pagos", pagoRoutes);
app.use("/api/transacciones", transaccionRoutes);

// 6. LÓGICA DE SOCKET.IO (TIEMPO REAL)
function esAdministrador(user) {
  return user?.tipo === "administrador";
}

async function obtenerConductoresDeRuta(rutaId) {
  const ids = new Set();

  const [camiones, horarios] = await Promise.all([
    Camion.find({ rutaAsignada: rutaId }).select("conductorActual"),
    Horario.find({ ruta: rutaId, diaSemana: { $in: diasBusquedaHoy() } }).select(
      "salidas.conductorAsignado"
    ),
  ]);

  camiones.forEach((camion) => {
    if (camion.conductorActual) ids.add(camion.conductorActual.toString());
  });

  horarios.forEach((horario) => {
    (horario.salidas || []).forEach((salida) => {
      if (salida.conductorAsignado) ids.add(salida.conductorAsignado.toString());
    });
  });

  return [...ids];
}

io.on("connection", (socket) => {
  console.log(`🔌 Nuevo cliente conectado: ${socket.id}`);

  // Salas para enviar eventos solo a sus destinatarios.
  socket.join(`user:${socket.data.user._id}`);
  if (esAdministrador(socket.data.user)) socket.join("admins");

  // --- A. Actualización de Ubicación (Conductor -> Mapa) ---
  socket.on("driverLocationUpdate", async (data = {}) => {
    try {
      const usuario = socket.data.user;
      if (!esAdministrador(usuario) && usuario?.tipo !== "conductor") return;

      const camion = await buscarCamion(data.camionId);
      if (!camion) return;

      if (!(await puedeOperarUnidad(usuario, camion))) {
        socket.emit("operationError", { message: "No puedes actualizar una unidad que no tienes asignada." });
        return;
      }

      const lat = Number(data.location?.lat);
      const lng = Number(data.location?.lng);
      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return;
      }

      camion.ubicacionActual = {
        type: "Point",
        coordinates: [lng, lat],
      };
      camion.ultimaActualizacion = new Date();
      camion.estado = "activo";
      await camion.save();

      const [lngBD, latBD] = camion.ubicacionActual.coordinates;
      io.emit("locationUpdate", {
        camionId: camion._id,
        numeroUnidad: camion.numeroUnidad,
        location: { lat: latBD, lng: lngBD },
        heading: Number(data.heading) || 0
      });

      console.log(`📡 Ubicación actualizada desde BD para ${camion.numeroUnidad}: [${latBD}, ${lngBD}]`);
    } catch (error) {
      console.error("❌ Error actualizando ubicación:", error.message);
    }
  });

  // --- B. Reporte de Incidente (Conductor -> Admin) ---
  // ESTA ES LA PARTE CRÍTICA QUE CORREGIMOS
  socket.on("incidentReport", async (data = {}) => {
    console.log("🔍 [DEBUG] Procesando incidente:", data);

    try {
      const usuario = socket.data.user;
      if (!esAdministrador(usuario) && usuario?.tipo !== "conductor") return;
      if (!data.tipo || String(data.tipo).length > 100) return;
      let camionEncontrado = null;
      let idParaGuardar = null;
      let nombreParaMostrar = data.camionId; // Por defecto usamos lo que manden

      // PASO 1: Intentar identificar el camión
      // (poblamos rutaAsignada para poder mandar el rutaId en la alerta)
      if (mongoose.Types.ObjectId.isValid(data.camionId)) {
        // Si nos mandaron un ID de Mongo, buscamos por ID
        camionEncontrado = await Camion.findById(data.camionId).populate(
          "rutaAsignada",
          "nombre"
        );
      } else {
        // Si nos mandaron texto (ej: "TEC-01"), buscamos por número o placa
        camionEncontrado = await Camion.findOne({
            $or: [{ numeroUnidad: data.camionId }, { placa: data.camionId }]
        }).populate("rutaAsignada", "nombre");
      }

      // PASO 2: Preparar datos según lo encontrado
      if (camionEncontrado) {
          if (!(await puedeOperarUnidad(usuario, camionEncontrado))) {
            socket.emit("operationError", { message: "No puedes reportar incidentes de una unidad que no tienes asignada." });
            return;
          }
          console.log("✅ [DEBUG] Camión identificado:", camionEncontrado.numeroUnidad);
          idParaGuardar = camionEncontrado._id; // El ID hexadecimal para la BD
          nombreParaMostrar = camionEncontrado.numeroUnidad; // El nombre corto para la Alerta
      } else {
          if (!esAdministrador(usuario)) return;
          console.warn("⚠️ [DEBUG] Camión no encontrado en BD. Se guardará sin vínculo.");
          // No asignamos idParaGuardar para evitar el CastError
      }

      // PASO 3: Guardar en Base de Datos
      await Notificacion.create({
        tipo: "incidente",
        titulo: `Incidente: ${data.tipo}`,
        mensaje: data.detalles || "Sin detalles adicionales",
        prioridad: "alta",
        camionId: idParaGuardar, // Puede ser el ID o null (nunca un string inválido)
        fecha: new Date()
      });
      console.log("💾 [DEBUG] Notificación guardada en MongoDB");

      // PASO 4: Emitir Alerta al Admin y a los Pasajeros (Inmediata)
      // Campos extra (rutaId/numeroUnidad) los usa el panel del pasajero para
      // filtrar por la ruta que está viendo; el admin solo lee tipo/detalles/camionId.
      io.emit("newIncidentAlert", {
        tipo: data.tipo,
        detalles: data.detalles,
        camionId: nombreParaMostrar, // Aquí mandamos el texto legible (ej: "TEC-01")
        numeroUnidad: nombreParaMostrar,
        rutaId: camionEncontrado?.rutaAsignada?._id
          ? camionEncontrado.rutaAsignada._id.toString()
          : null,
        rutaNombre: camionEncontrado?.rutaAsignada?.nombre || null,
        hora: new Date()
      });
      console.log("📡 [DEBUG] Alerta emitida a administradores y pasajeros");

    } catch (error) {
      console.error("❌ [ERROR CRÍTICO] Fallo al procesar incidente:", error);
    }
  });

  socket.on("studentAtStop", async (data = {}) => {
    try {
      const usuario = socket.data.user;
      if (!usuario) return;

      const lat = Number(data.location?.lat);
      const lng = Number(data.location?.lng);
      const rutaId = data.rutaId && mongoose.Types.ObjectId.isValid(data.rutaId)
        ? data.rutaId
        : null;

      if (
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180
      ) {
        return;
      }

      // Solo el propio pasajero, los administradores y los conductores
      // autorizados para esa ruta deben recibir la ubicación del estudiante.
      const destinatarios = new Set([`user:${usuario._id}`, "admins"]);
      if (rutaId) {
        const conductores = await obtenerConductoresDeRuta(rutaId);
        conductores.forEach((id) => destinatarios.add(`user:${id}`));
      }

      let emisor = io;
      destinatarios.forEach((sala) => {
        emisor = emisor.to(sala);
      });

      console.log("📍 Estudiante esperando:", usuario._id.toString());
      emisor.emit("studentWaiting", {
        userId: usuario._id,
        rutaId,
        location: { lat, lng },
        timestamp: new Date()
      });
    } catch (error) {
      console.error("Error procesando studentAtStop:", error.message);
    }
  });

  // --- C. Cobro Manual (Conductor) — precio calculado del lado servidor ---
  socket.on("cobroManual", async (data = {}, callback) => {
    try {
      const Transaccion = require("./models/Transaccion");
      const Tarifa = require("./models/Tarifa");
      const Ruta = require("./models/Ruta");

      const usuario = socket.data.user;
      if (!esAdministrador(usuario) && usuario?.tipo !== "conductor") {
        if (typeof callback === "function") callback({ ok: false, error: "No autorizado" });
        return;
      }

      const camion = await buscarCamion(data.camionId);
      if (!camion || !(await puedeOperarUnidad(usuario, camion))) {
        if (typeof callback === "function") callback({ ok: false, error: "Unidad no asignada" });
        return;
      }

      const tipoTarifa = data.tipo_tarifa === "Estudiante" ? "Estudiante" : "General";
      const cantidad = data.cantidad_boletos === undefined ? 1 : Number(data.cantidad_boletos);
      if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
        if (typeof callback === "function") callback({ ok: false, error: "Cantidad de boletos inválida" });
        return;
      }

      const PRECIO_GENERAL_DEFAULT = 18.00;
      const PRECIO_ESTUDIANTE_DEFAULT = 10.00;

      // Resolver rutaId si se envió nombre
      let rutaId = data.rutaId && mongoose.Types.ObjectId.isValid(data.rutaId) ? data.rutaId : null;
      if (!rutaId && data.rutaNombre) {
        const ruta = await Ruta.findOne({ nombre: data.rutaNombre }).select("_id");
        if (ruta) rutaId = ruta._id;
      }

      // Calcular precio (lógica idéntica a pagos.js)
      const esEstudiante = tipoTarifa === "Estudiante";
      let tarifa = await Tarifa.findOne({ rutaId, activa: true });
      if (!tarifa) tarifa = await Tarifa.findOne({ rutaId: null, activa: true });
      const precioUnitario = Number(
        tarifa
          ? (esEstudiante ? tarifa.precioEstudiante : tarifa.precioGeneral)
          : (esEstudiante ? PRECIO_ESTUDIANTE_DEFAULT : PRECIO_GENERAL_DEFAULT)
      );

      if (!Number.isFinite(precioUnitario) || precioUnitario <= 0) {
        if (typeof callback === "function") callback({ ok: false, error: "Tarifa inválida" });
        return;
      }

      const total = Number((precioUnitario * cantidad).toFixed(2));

      const transaccion = await Transaccion.create({
        usuarioId: usuario._id,
        camionId: camion._id.toString(),
        monto: total,
        tipo_tarifa: tipoTarifa,
        cantidad_boletos: cantidad,
        rutaId: rutaId || undefined,
        timestamp: new Date()
      });

      const transaccionCompleta = await Transaccion.findById(transaccion._id)
        .populate("usuarioId", "nombre email")
        .populate("rutaId", "nombre");

      io.emit("nuevaTransaccion", {
        _id: transaccionCompleta._id,
        camionId: camion._id.toString(),
        monto: total,
        tipo_tarifa: tipoTarifa,
        cantidad_boletos: cantidad,
        timestamp: transaccionCompleta.timestamp,
        usuarioId: { nombre: transaccionCompleta.usuarioId?.nombre || "Manual" },
        rutaId: transaccionCompleta.rutaId ? { nombre: transaccionCompleta.rutaId.nombre } : null
      });

      // Confirmar al conductor que el cobro fue exitoso
      if (typeof callback === "function") {
        callback({ ok: true, monto: total, tipo_tarifa: tipoTarifa, cantidad_boletos: cantidad });
      }

      console.log(`💰 Cobro manual registrado: $${total.toFixed(2)} en camión ${camion.numeroUnidad}`);
    } catch (error) {
      console.error("Error en cobro manual:", error.message);
      // Notificar al conductor que falló el cobro
      if (typeof callback === "function") {
        callback({ ok: false, error: error.message });
      }
    }
  });

  socket.on("disconnect", () => {
    // console.log(`🔌 Desconectado: ${socket.id}`);
  });
});



// 7. Arrancar servidor (después de conectar a MongoDB)
iniciarServidor();