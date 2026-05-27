// backend/server.js

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");

// Importamos los Modelos
const Camion = require("./models/Camion");
const Notificacion = require("./models/Notificacion");

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
const { startAnalyticsJobs } = require("./analytics/cronJobs");

// 2. Inicializar la aplicación
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Permite conexiones desde cualquier IP (importante para el celular)
    methods: ["GET", "POST"],
  },
});

// Compartir io con las rutas
app.set("io", io);

const PORT = process.env.PORT || 5000;

// 3. Middlewares
app.use(cors());
app.use(express.json());

// 4. Conectar a la Base de Datos
const MONGO_URI = process.env.MONGO_URI;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("✅ Conectado a MongoDB Atlas");
    startAnalyticsJobs();
  })
  .catch((err) => {
    console.error("❌ Error al conectar a MongoDB:", err.message);
  });

// 5. Rutas
app.get("/", (req, res) => res.send("¡Servidor TecBus Activo!"));
app.use("/api/auth", authRoutes);
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
io.on("connection", (socket) => {
  console.log(`🔌 Nuevo cliente conectado: ${socket.id}`);

  // --- A. Actualización de Ubicación (Conductor -> Mapa) ---
  socket.on("driverLocationUpdate", async (data) => {
    try {
      let idParaActualizar = null;

      if (mongoose.Types.ObjectId.isValid(data.camionId)) {
        idParaActualizar = data.camionId;
      } else {
        const camionEncontrado = await Camion.findOne({ numeroUnidad: data.camionId });
        if (camionEncontrado) idParaActualizar = camionEncontrado._id;
      }

      if (idParaActualizar) {
        // 1. GUARDAR EN BD
        const camion = await Camion.findByIdAndUpdate(
          idParaActualizar,
          {
            ubicacionActual: {
              type: "Point",
              coordinates: [data.location.lng, data.location.lat],
            },
            ultimaActualizacion: Date.now(),
            estado: "activo"
          },
          { new: true } // Importante: devuelve el documento actualizado
        );

        // 2. ENVIAR AL MAPA (Solo si se guardó)
        if (camion && camion.ubicacionActual && camion.ubicacionActual.coordinates) {
          
          // Extraemos coordenadas EXCLUSIVAMENTE de la base de datos
          const [lngBD, latBD] = camion.ubicacionActual.coordinates;

          io.emit("locationUpdate", {
            camionId: camion._id,
            numeroUnidad: camion.numeroUnidad,
            location: { 
                lat: latBD, 
                lng: lngBD 
            },
            heading: data.heading || 0
          });
          
          console.log(`📡 Ubicación actualizada desde BD para ${camion.numeroUnidad}: [${latBD}, ${lngBD}]`);
        }
      }
    } catch (error) {
      console.error("❌ Error actualizando ubicación:", error.message);
    }
  });

  // --- B. Reporte de Incidente (Conductor -> Admin) ---
  // ESTA ES LA PARTE CRÍTICA QUE CORREGIMOS
  socket.on("incidentReport", async (data) => {
    console.log("🔍 [DEBUG] Procesando incidente:", data);

    try {
      let camionEncontrado = null;
      let idParaGuardar = null;
      let nombreParaMostrar = data.camionId; // Por defecto usamos lo que manden

      // PASO 1: Intentar identificar el camión
      if (mongoose.Types.ObjectId.isValid(data.camionId)) {
        // Si nos mandaron un ID de Mongo, buscamos por ID
        camionEncontrado = await Camion.findById(data.camionId);
      } else {
        // Si nos mandaron texto (ej: "TEC-01"), buscamos por número o placa
        camionEncontrado = await Camion.findOne({ 
            $or: [{ numeroUnidad: data.camionId }, { placa: data.camionId }] 
        });
      }

      // PASO 2: Preparar datos según lo encontrado
      if (camionEncontrado) {
          console.log("✅ [DEBUG] Camión identificado:", camionEncontrado.numeroUnidad);
          idParaGuardar = camionEncontrado._id; // El ID hexadecimal para la BD
          nombreParaMostrar = camionEncontrado.numeroUnidad; // El nombre corto para la Alerta
      } else {
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

      // PASO 4: Emitir Alerta al Admin (Inmediata)
      io.emit("newIncidentAlert", {
        tipo: data.tipo,
        detalles: data.detalles,
        camionId: nombreParaMostrar, // Aquí mandamos el texto legible (ej: "TEC-01")
        hora: new Date()
      });
      console.log("📡 [DEBUG] Alerta emitida a los administradores");

    } catch (error) {
      console.error("❌ [ERROR CRÍTICO] Fallo al procesar incidente:", error);
    }
  });

  socket.on("studentAtStop", (data) => {
    console.log("📍 Estudiante esperando:", data);
    
    // IMPORTANTE: Usar io.emit para que le llegue a TODOS (Conductores, Admins y el mismo estudiante)
    // O socket.broadcast.emit para que le llegue a todos MENOS al que lo envió.
      io.emit("studentWaiting", {
          userId: data.userId,
          rutaId: data.rutaId,
          location: data.location,
          timestamp: new Date()
      });
  });

  // --- C. Cobro Manual (Conductor) — precio calculado del lado servidor ---
  socket.on("cobroManual", async (data, callback) => {
    try {
      const Transaccion = require("./models/Transaccion");
      const Tarifa = require("./models/Tarifa");
      const Ruta = require("./models/Ruta");

      const PRECIO_GENERAL_DEFAULT = 12.00;
      const PRECIO_ESTUDIANTE_DEFAULT = 8.00;

      // Resolver rutaId si se envió nombre
      let rutaId = data.rutaId || null;
      if (!rutaId && data.rutaNombre) {
        const ruta = await Ruta.findOne({ nombre: data.rutaNombre }).select("_id");
        if (ruta) rutaId = ruta._id;
      }

      // Calcular precio (lógica idéntica a pagos.js)
      const esEstudiante = data.tipo_tarifa === "Estudiante";
      let tarifa = await Tarifa.findOne({ rutaId, activa: true });
      if (!tarifa) tarifa = await Tarifa.findOne({ rutaId: null, activa: true });
      const precio = tarifa
        ? (esEstudiante ? tarifa.precioEstudiante : tarifa.precioGeneral)
        : (esEstudiante ? PRECIO_ESTUDIANTE_DEFAULT : PRECIO_GENERAL_DEFAULT);

      const transaccion = await Transaccion.create({
        usuarioId: data.conductorId,
        camionId: data.camionId,
        monto: precio,
        tipo_tarifa: data.tipo_tarifa,
        cantidad_boletos: 1,
        rutaId: rutaId || undefined,
        timestamp: new Date(data.timestamp)
      });

      const transaccionCompleta = await Transaccion.findById(transaccion._id)
        .populate("usuarioId", "nombre email")
        .populate("rutaId", "nombre");

      io.emit("nuevaTransaccion", {
        _id: transaccionCompleta._id,
        camionId: data.camionId,
        monto: precio,
        tipo_tarifa: data.tipo_tarifa,
        cantidad_boletos: 1,
        timestamp: transaccionCompleta.timestamp,
        usuarioId: { nombre: transaccionCompleta.usuarioId?.nombre || "Manual" },
        rutaId: transaccionCompleta.rutaId ? { nombre: transaccionCompleta.rutaId.nombre } : null
      });

      // Confirmar al conductor que el cobro fue exitoso
      if (typeof callback === "function") {
        callback({ ok: true, monto: precio, tipo_tarifa: data.tipo_tarifa });
      }

      console.log(`💰 Cobro manual registrado: $${precio.toFixed(2)} en camión ${data.camionId}`);
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



// 7. Arrancar servidor
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});