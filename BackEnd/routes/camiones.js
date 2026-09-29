// backend/routes/camiones.js

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Camion = require("../models/Camion");
const Horario = require('../models/Horario');
const User = require('../models/User');
const { protect, adminOnly } = require("../middleware/authMiddleware");
const HistorialBusqueda = require("../models/HistorialBusqueda");
const Notificacion = require("../models/Notificacion");
const UbicacionEnVivo = require("../models/UbicacionEnVivo");
const HistorialUbicacion = require("../models/HistorialUbicacion");
const EstadisticaDiaria = require("../models/EstadisticaDiaria");

// ==================================================================
//  RUTA ESPECIAL ESP32 — DEBE IR PRIMERO
// ==================================================================
router.put("/update-location", async (req, res) => {
  try {
    const { busId, lat, lng, speed, pasajeros_actuales, luces_perifericos_encendidos, minutos_ralenti } = req.body;
    const ahora = new Date();

    // 1. Validación básica
    if (!busId || lat === undefined || lng === undefined) {
      return res.status(400).json({ message: "Datos GPS incompletos" });
    }

    // 2. Obtener y actualizar los datos en tiempo real del camión en la colección principal
    const camion = await Camion.findOneAndUpdate(
      { numeroUnidad: busId },
      {
        $set: {
          ubicacionActual: {
            type: "Point",
            coordinates: [lng, lat],
          },
          velocidad: speed,
          ultimaActualizacion: ahora,
          estado: "activo"
        }
      },
      { new: true }
    ).populate("rutaAsignada");

    if (!camion) {
      return res.status(404).json({ message: "Camión no registrado en la flotilla" });
    }

    // 3. OBTENER UBICACIÓN ANTERIOR (Para calcular distancia recorrida)
    const ubicacionAnterior = await UbicacionEnVivo.findOne({ numeroUnidad: busId });
    
    let distanciaRecorrida = 0;
    
    if (ubicacionAnterior && ubicacionAnterior.ubicacion) {
        const coordsAnt = ubicacionAnterior.ubicacion.coordinates; // [lng, lat]
        distanciaRecorrida = getDistanceFromLatLonInM(
            coordsAnt[1], coordsAnt[0], // Lat, Lng anteriores
            lat, lng                    // Lat, Lng actuales
        );

        // Filtro anti-ruido GPS: Si se movió más de 500m en segundos (teletransportación), ignorar distancia
        // O si se movió menos de 3 metros (ruido estático), ignorar.
        if (distanciaRecorrida > 1000 || distanciaRecorrida < 3) {
            distanciaRecorrida = 0;
        }
    }

    // 4. ACTUALIZAR "DATOS CALIENTES" (Live)
    // Esto es lo que ve el mapa en tiempo real
    const liveUpdate = await UbicacionEnVivo.findOneAndUpdate(
      { numeroUnidad: busId },
      {
        $set: {
            camionId: camion._id,
            ubicacion: { type: "Point", coordinates: [lng, lat] },
            velocidad: speed,
            pasajeros_actuales: pasajeros_actuales !== undefined ? pasajeros_actuales : 0,
            luces_perifericos_encendidos: luces_perifericos_encendidos !== undefined ? luces_perifericos_encendidos : false,
            minutos_ralenti: minutos_ralenti !== undefined ? minutos_ralenti : 0,
            ultimaActualizacion: ahora,
            numeroUnidad: busId
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // 5. GUARDAR HISTORIAL (Datos Fríos)
    // Esto se guarda para siempre (o hasta que el TTL lo borre)
    HistorialUbicacion.create({
        camionId: camion._id,
        numeroUnidad: busId,
        ubicacion: { type: "Point", coordinates: [lng, lat] },
        velocidad: speed,
        pasajeros_actuales: pasajeros_actuales !== undefined ? pasajeros_actuales : 0,
        luces_perifericos_encendidos: luces_perifericos_encendidos !== undefined ? luces_perifericos_encendidos : false,
        minutos_ralenti: minutos_ralenti !== undefined ? minutos_ralenti : 0,
        timestamp: ahora
    }).catch(err => console.error("⚠️ Error guardando historial:", err.message));

    // 6. ACTUALIZAR ESTADÍSTICAS DIARIAS (Optimizado)
    const fechaLocal = new Date(ahora.getTime() - (7 * 60 * 60 * 1000)); 
    const fechaString = fechaLocal.toISOString().split('T')[0]; // "YYYY-MM-DD"
    const claveStats = `${busId}_${fechaString}`;

    await EstadisticaDiaria.updateOne(
        { claveDiaria: claveStats },
        {
            $setOnInsert: { 
                numeroUnidad: busId,
                fecha: new Date(fechaString) 
            },
            $inc: { 
                distanciaTotal: distanciaRecorrida, 
                totalPuntosReportados: 1 
            },
            $max: { 
                velocidadMaxima: speed 
            },
            $set: { ultimaActualizacion: ahora }
        },
        { upsert: true }
    ).catch(err => console.error("⚠️ Error guardando stats:", err.message));

    // 7. ENVIAR SOCKET (Para el Frontend)
    const io = req.app.get("io");
    if (io) {
      io.emit("locationUpdate", {
        camionId: camion._id,
        numeroUnidad: busId,
        location: { lat, lng },
        velocidad: speed,
        pasajeros_actuales: pasajeros_actuales !== undefined ? pasajeros_actuales : 0,
        luces_perifericos_encendidos: luces_perifericos_encendidos !== undefined ? luces_perifericos_encendidos : false,
        minutos_ralenti: minutos_ralenti !== undefined ? minutos_ralenti : 0
      });
    }

    // 8. ANÁLISIS PREDICTIVO
    if (camion.rutaAsignada) {
      const fecha = new Date();
      const horaActual = fecha.getHours();

      const historialRelevante = await HistorialBusqueda.aggregate([
        { $match: { ruta: camion.rutaAsignada._id } },
        {
          $addFields: {
            horaNum: { $toInt: { $substr: ["$horaBusqueda", 0, 2] } },
          },
        },
        { $match: { horaNum: horaActual } },
        {
          $group: {
            _id: "$usuario",
            totalBusquedas: { $sum: 1 },
            ultimoOrigen: { $last: "$ubicacionOrigen" },
          },
        },
        { $match: { totalBusquedas: { $gte: 4 } } },
      ]);

      for (const patron of historialRelevante) {
        const userOrigen = patron.ultimoOrigen;

        if (userOrigen && userOrigen.lat && userOrigen.lng) {
          const distancia = getDistanceFromLatLonInM(
            lat,
            lng,
            userOrigen.lat,
            userOrigen.lng
          );

          if (distancia <= 200) {
            console.log(
              `✨ PREDICCIÓN: Camión cerca de usuario ${
                patron._id
              } (${Math.round(distancia)}m)`
            );

            await Notificacion.create({
              usuario: patron._id,
              mensaje: `El camión de la ruta ${
                camion.rutaAsignada.nombre
              } está a ${Math.round(distancia)}m.`,
              leida: false,
            });

            if (io)
              io.to(patron._id.toString()).emit("smartAlert", {
                mensaje: `🚍 Tu ruta habitual (${camion.rutaAsignada.nombre}) está llegando.`,
              });
          }
        }
      }
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
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function diaActualSegura() {
    return DIAS_SEMANA[new Date().getDay()];
}

// Próximo horario del conductor para HOY. Es solo informativo:
// aunque no exista ninguno, el conductor sigue viendo su unidad y su ruta.
async function obtenerProximoViaje(conductorId, diaActual) {
    try {
        const ahora = new Date();
        const minutosActuales = ahora.getHours() * 60 + ahora.getMinutes();

        const horarios = await Horario.find({
            $or: [{ diaSemana: diaActual }, { diaSemana: diaActual.toLowerCase() }],
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
            const diaActual = diaActualSegura();
            const horarios = await Horario.find({
                $or: [{ diaSemana: diaActual }, { diaSemana: diaActual.toLowerCase() }],
                "salidas.conductorAsignado": idConductor
            }).populate("salidas.camionAsignado");

            for (const h of horarios) {
                const salida = h.salidas.find(
                    s => s.conductorAsignado?.toString() === idConductor.toString()
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
        const viaje = await obtenerProximoViaje(idConductor, diaActualSegura());

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

// --- Obtener todos los camiones ---
router.get("/", protect, async (req, res) => {
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
router.get("/por-ruta/:rutaId", protect, async (req, res) => {
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

// ==================================================================
//  Funciones auxiliares
// ==================================================================
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  var R = 6371;
  var dLat = deg2rad(lat2 - lat1);
  var dLon = deg2rad(lon2 - lon1);
  var a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// --- RUTA NUEVA: Obtener un camión por su ID ---
// GET /api/camiones/:id
router.get("/:id", protect, async (req, res) => {
  try {
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
