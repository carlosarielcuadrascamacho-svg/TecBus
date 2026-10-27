// backend/routes/camiones.js

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Camion = require("../models/Camion");
const Horario = require('../models/Horario');
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { apiKeyAuth } = require("../middleware/apiKeyMiddleware");
const { rateLimit } = require("express-rate-limit");
const EstadisticaDiaria = require("../models/EstadisticaDiaria");
const { procesarPuntoTelemetria } = require("../services/telemetryService");
const { diasBusquedaHoy, minutosActualesGuasave } = require("../utils/dias");

const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Demasiados reportes de telemetría. Intenta de nuevo en un minuto." },
});

// ==================================================================
//  RUTA ESPECIAL ESP32 — DEBE IR PRIMERO
// ==================================================================
router.put("/update-location", apiKeyAuth, telemetryLimiter, async (req, res) => {
  try {
    const resultado = await procesarPuntoTelemetria(req.body, req.app.get("io"));
    if (!resultado.ok) {
      return res.status(resultado.code).json({ message: resultado.message });
    }
    res.status(200).send("Ubicacion actualizada y analisis completado");
  } catch (error) {
    console.error("❌ Error actualizando ubicación:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// ==================================================================
//  UNIDAD DEL CONDUCTOR
//  La asignación es DIRECTA: camion.conductorActual + camion.rutaAsignada.
//  El horario ya NO decide si el conductor ve su unidad ni su ruta.
//  Solo se devuelve como dato informativo del próximo recorrido.
// ==================================================================
// Próximo horario del conductor para HOY. Es solo informativo:
// aunque no exista ninguno, el conductor sigue viendo su unidad y su ruta.
async function obtenerProximoViaje(conductorId) {
    try {
        const minutosActuales = minutosActualesGuasave();

        const horarios = await Horario.find({
            diaSemana: { $in: diasBusquedaHoy() },
            "salidas.conductorAsignado": conductorId
        }).select("salidas");

        const viajes = [];
        horarios.forEach(h => {
            h.salidas.forEach(s => {
                if (s.conductorAsignado?.toString() === conductorId.toString()) {
                    viajes.push({ hora: s.hora, rutaId: h.ruta });
                }
            });
        });

        const aMinutos = (hora) => {
            const [h, m] = String(hora).split(':');
            return parseInt(h) * 60 + parseInt(m);
        };

        viajes.sort((a, b) => aMinutos(a.hora) - aMinutos(b.hora));

        return viajes.find(v => aMinutos(v.hora) >= minutosActuales) || viajes[0] || null;
    } catch (error) {
        console.error("⚠️ Error calculando próximo viaje:", error.message);
        return null;
    }
}

router.get('/mi-unidad', protect, async (req, res) => {
    try {
        const idConductor = req.user._id;

        // 1. Vía principal: camión con asignación directa al conductor
        let camion = await Camion.findOne({ conductorActual: idConductor })
            .populate("rutaAsignada")
            .populate("conductorActual", "nombre");

        let origen = "conductorActual";

        // 2. Respaldo: si aún no hay asignación directa, se toma el camión de
        //    un horario suyo para que el conductor no quede sin unidad.
        if (!camion) {
            const horarios = await Horario.find({
                diaSemana: { $in: diasBusquedaHoy() },
                "salidas.conductorAsignado": idConductor
            }).populate("salidas.camionAsignado");

            for (const h of horarios) {
                const salida = h.salidas.find(
                    s => s.conductorAsignado?.toString() === idConductor.toString()
                        && s.camionAsignado
                );
                if (salida?.camionAsignado) {
                    camion = await Camion.findById(salida.camionAsignado._id)
                        .populate("rutaAsignada")
                        .populate("conductorActual", "nombre");
                    origen = "horario";
                    break;
                }
            }
        }

        if (!camion) {
            return res.status(404).json({
                mensaje: "No tienes una unidad asignada. Pide al administrador que te asigne un camión."
            });
        }

        // 3. Próximo horario (informativo, nunca condiciona la respuesta)
        const viaje = await obtenerProximoViaje(idConductor);

        // 4. La unidad y su ruta se devuelven siempre juntas
        return res.json({
            camionId: camion._id,
            numeroUnidad: camion.numeroUnidad,
            placa: camion.placa,
            estado: camion.estado,
            ubicacionActual: camion.ubicacionActual,
            velocidad: camion.velocidad,
            conductorNombre: camion.conductorActual?.nombre || null,
            ruta: camion.rutaAsignada || null,
            rutaId: camion.rutaAsignada?._id || null,
            rutaNombre: camion.rutaAsignada?.nombre || null,
            origen,
            viaje
        });

    } catch (error) {
        console.error("❌ Error buscando unidad del conductor:", error);
        res.status(500).json({ mensaje: "Error al buscar la unidad del conductor" });
    }
});


// ==================================================================
//  RUTAS GENERALES (CRUD)
// ==================================================================

// --- Obtener todos los camiones (Público: mapa general de unidades) ---
router.get("/", async (req, res) => {
  try {
    const camiones = await Camion.find()
      .populate("rutaAsignada", "nombre")
      .populate("conductorActual", "nombre");
    res.json(camiones);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Camiones de una RUTA (fuente: la asignación directa del camión) ---
// El horario NO interviene: si el camión tiene la ruta asignada, aparece siempre.
// Público: mapa en tiempo real de pasajeros y consulta de flota
router.get("/por-ruta/:rutaId", async (req, res) => {
  try {
    const { rutaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(rutaId)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    const camiones = await Camion.find({ rutaAsignada: rutaId })
      .populate("rutaAsignada", "nombre")
      .populate("conductorActual", "nombre")
      .sort({ numeroUnidad: 1 });

    res.json(camiones);
  } catch (error) {
    console.error("Error obteniendo camiones por ruta:", error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Crear nuevo camión ---
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { numeroUnidad, placa, modelo, año, capacidad, rutaAsignada, conductorActual } = req.body;

    if (!String(numeroUnidad || "").trim() || !String(placa || "").trim()) {
      return res.status(400).json({ message: "numeroUnidad y placa son requeridos" });
    }
    if (rutaAsignada && !mongoose.Types.ObjectId.isValid(rutaAsignada)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }
    if (conductorActual && !mongoose.Types.ObjectId.isValid(conductorActual)) {
      return res.status(400).json({ message: "ID de conductor inválido" });
    }

    const camionExists = await Camion.findOne({ placa });
    if (camionExists)
      return res.status(400).json({ message: "La placa ya está registrada" });

    const camion = new Camion({
      numeroUnidad,
      placa,
      modelo,
      año,
      capacidad,
      rutaAsignada: rutaAsignada || null,
      conductorActual: conductorActual || null,
      estado: "activo",
    });

    const nuevoCamion = await camion.save();
    res.status(201).json(nuevoCamion);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Actualizar camión ---
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "ID de camión inválido" });
    }

    const camion = await Camion.findById(req.params.id);

    if (camion) {
      camion.numeroUnidad = req.body.numeroUnidad || camion.numeroUnidad;
      camion.placa = req.body.placa || camion.placa;
      camion.modelo = req.body.modelo || camion.modelo;
      camion.capacidad = req.body.capacidad || camion.capacidad;
      camion.estado = req.body.estado || camion.estado;

      // Ruta y conductor se administran desde la ficha del camión,
      // con independencia de los horarios.
      if ("rutaAsignada" in req.body) {
        camion.rutaAsignada = req.body.rutaAsignada || null;
      }
      if ("conductorActual" in req.body) {
        camion.conductorActual = req.body.conductorActual || null;
      }

      // Solo puede haber un camión por conductor: liberamos el anterior.
      if (camion.conductorActual) {
        await Camion.updateMany(
          { conductorActual: camion.conductorActual, _id: { $ne: camion._id } },
          { $set: { conductorActual: null } }
        );
      }

      const camionActualizado = await camion
        .save()
        .then(c => c.populate("rutaAsignada").then(p => p.populate("conductorActual", "nombre")));

      res.json(camionActualizado);
    } else {
      res.status(404).json({ message: "Camión no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- Eliminar camión ---
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "ID de camión inválido" });
    }

    const camion = await Camion.findById(req.params.id);

    if (camion) {
      await camion.deleteOne();
      res.json({ message: "Camión eliminado" });
    } else {
      res.status(404).json({ message: "Camión no encontrado" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA NUEVA: Obtener un camión por su ID ---
// GET /api/camiones/:id (Público: detalle de unidad al seleccionarla en mapa)
router.get("/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "ID de camión inválido" });
    }

    const camion = await Camion.findById(req.params.id)
      .populate("conductorActual", "nombre")
      .populate("rutaAsignada");

    if (!camion) {
      return res.status(404).json({ message: "Camión no encontrado en la BD" });
    }

    res.json(camion);

  } catch (error) {
    console.error("Error al obtener camión individual:", error);
    res.status(500).json({ message: "Error en el servidor al consultar camión" });
  }
});

router.get("/estadisticas/hoy", protect, adminOnly, async (req, res) => {
    try {
        // 1. Calcular la fecha de hoy (sin hora) para buscar en la BD
        const hoy = new Date();
        // Ajuste manual de zona horaria si es necesario (ej. -7 horas para México)
        const fechaLocal = new Date(hoy.getTime() - (7 * 60 * 60 * 1000));
        const fechaString = fechaLocal.toISOString().split('T')[0]; // "2023-10-27"
        const inicioDia = new Date(fechaString);

        // 2. Buscar las estadísticas de HOY
        const stats = await EstadisticaDiaria.find({ 
            fecha: inicioDia 
        }).sort({ distanciaTotal: -1 }); // Ordenar: el que más recorrió primero

        // 3. Calcular Totales Generales (KPIs)
        let totalKmFlota = 0;
        let maxVelocidadFlota = 0;
        let unidadMasVeloz = "N/A";

        stats.forEach(s => {
            totalKmFlota += s.distanciaTotal;
            if (s.velocidadMaxima > maxVelocidadFlota) {
                maxVelocidadFlota = s.velocidadMaxima;
                unidadMasVeloz = s.numeroUnidad;
            }
        });

        // 4. Enviar respuesta preparada para el Frontend
        res.json({
            resumen: {
                totalKm: (totalKmFlota / 1000).toFixed(2), // Convertir a KM
                topVelocidad: `${maxVelocidadFlota} km/h (Unidad ${unidadMasVeloz})`,
                totalUnidadesActivas: stats.length
            },
            detalles: stats.map(s => ({
                unidad: s.numeroUnidad,
                km: (s.distanciaTotal / 1000).toFixed(2),
                velMax: s.velocidadMaxima,
                actualizado: s.ultimaActualizacion.toLocaleTimeString()
            }))
        });

    } catch (error) {
        console.error("Error obteniendo estadísticas:", error);
        res.status(500).json({ message: "Error al cargar reporte" });
    }
});

module.exports = router;
