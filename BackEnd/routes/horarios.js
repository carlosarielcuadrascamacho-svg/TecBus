// backend/routes/horarios.js
const mongoose = require("mongoose");
const express = require("express");
const router = express.Router();
const Horario = require("../models/Horario");
const Camion = require("../models/Camion");
const { protect, adminOnly } = require("../middleware/authMiddleware");



const MAPA_DIAS_DISPLAY = {
  "lunes": "Lunes",
  "martes": "Martes",
  "miercoles": "Miércoles",
  "jueves": "Jueves",
  "viernes": "Viernes",
  "sabado": "Sábado",
  "domingo": "Domingo",
};

async function obtenerHorariosAgregados({ rutaId = null, incluirConductor = false } = {}) {
  const pipeline = [];

  if (rutaId) {
    pipeline.push({ $match: { ruta: new mongoose.Types.ObjectId(rutaId) } });
  }

  pipeline.push(
    { $unwind: "$salidas" },
    {
      $lookup: {
        from: "rutas",
        localField: "ruta",
        foreignField: "_id",
        as: "infoRuta",
      },
    },
    {
      $lookup: {
        from: "camions",
        localField: "salidas.camionAsignado",
        foreignField: "_id",
        as: "infoCamion",
      },
    },
    {
      $addFields: {
        ordenDia: {
          $switch: {
            branches: [
              { case: { $eq: ["$diaSemana", "lunes"] }, then: 1 },
              { case: { $eq: ["$diaSemana", "martes"] }, then: 2 },
              { case: { $eq: ["$diaSemana", "miercoles"] }, then: 3 },
              { case: { $eq: ["$diaSemana", "jueves"] }, then: 4 },
              { case: { $eq: ["$diaSemana", "viernes"] }, then: 5 },
              { case: { $eq: ["$diaSemana", "sabado"] }, then: 6 },
              { case: { $eq: ["$diaSemana", "domingo"] }, then: 7 },
            ],
            default: 8,
          },
        },
      },
    }
  );

  if (incluirConductor) {
    pipeline.push({
      $lookup: {
        from: "users",
        localField: "salidas.conductorAsignado",
        foreignField: "_id",
        as: "infoConductor",
      },
    });
  }

  const proyecto = {
    _id: "$_id",
    salidaId: "$salidas._id",
    diaSemana: "$diaSemana",
    ordenDia: 1,
    hora: "$salidas.hora",
    rutaNombre: { $arrayElemAt: ["$infoRuta.nombre", 0] },
    rutaId: { $arrayElemAt: ["$infoRuta._id", 0] },
    rutaDuracion: { $arrayElemAt: ["$infoRuta.tiempoEstimadoTotal", 0] },
    camionUnidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
    camionId: { $arrayElemAt: ["$infoCamion._id", 0] },
  };

  if (incluirConductor) {
    proyecto.conductorNombre = { $arrayElemAt: ["$infoConductor.nombre", 0] };
    proyecto.conductorId = { $arrayElemAt: ["$infoConductor._id", 0] };
  }

  pipeline.push({ $project: proyecto }, { $sort: { ordenDia: 1, hora: 1 } });

  const horarios = await Horario.aggregate(pipeline);
  return horarios.map((h) => ({
    ...h,
    diaSemana: MAPA_DIAS_DISPLAY[h.diaSemana] || h.diaSemana,
  }));
}

// --- RUTA 1: Obtener TODOS los horarios (admin) ---
router.get("/", protect, async (req, res) => {
  try {
    res.json(await obtenerHorariosAgregados({ incluirConductor: true }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- HELPER: Rellena datos del camión SOLO si están vacíos ---
// El horario es un dato informativo: NUNCA desasigna una ruta ya definida
// en la ficha del camión. Solo rellena huecos para no perder la información
// que se capturó antes de que existiera la asignación directa.
async function rellenarCamionDesdeHorario(camionId) {
  if (!camionId) return;

  const camion = await Camion.findById(camionId).select("rutaAsignada conductorActual");
  if (!camion) return;
  if (camion.rutaAsignada && camion.conductorActual) return;

  const horario = await Horario.findOne({ "salidas.camionAsignado": camionId });
  if (!horario) return;

  const salida = horario.salidas.find(s => s.camionAsignado?.toString() === camionId.toString());
  if (!salida) return;

  const update = {};
  if (!camion.rutaAsignada) update.rutaAsignada = horario.ruta;
  if (!camion.conductorActual && salida.conductorAsignado) {
    update.conductorActual = salida.conductorAsignado;
  }

  if (Object.keys(update).length > 0) {
    await Camion.findByIdAndUpdate(camionId, { $set: update });
  }
}

// --- RUTA 2: Crear/Agregar Horarios (CORREGIDA Y BLINDADA) ---
router.post("/", protect, adminOnly, async (req, res) => {
  const { ruta, diaSemana, hora, camionAsignado, conductorAsignado } = req.body;
  const diaSemanaTexto = String(diaSemana || "").trim();
  const horaTexto = String(hora || "").trim();

  if (!ruta || !diaSemanaTexto || !horaTexto) {
    return res.status(400).json({ message: "ruta, diaSemana y hora son requeridos" });
  }
  if (!mongoose.Types.ObjectId.isValid(ruta)) {
    return res.status(400).json({ message: "ID de ruta inválido" });
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaTexto)) {
    return res.status(400).json({ message: "La hora debe tener formato HH:MM (24 h)" });
  }

  const diasPermitidos = [
    "lunes", "martes", "miércoles", "miercoles", "jueves", "viernes",
    "sábado", "sabado", "domingo", "diario", "lunes-viernes",
  ];
  if (!diasPermitidos.includes(diaSemanaTexto.toLowerCase())) {
    return res.status(400).json({ message: "diaSemana no válido" });
  }
  if (!camionAsignado || !conductorAsignado) {
    return res.status(400).json({ message: "camionAsignado y conductorAsignado son requeridos" });
  }
  if (camionAsignado && !mongoose.Types.ObjectId.isValid(camionAsignado)) {
    return res.status(400).json({ message: "ID de camión inválido" });
  }
  if (conductorAsignado && !mongoose.Types.ObjectId.isValid(conductorAsignado)) {
    return res.status(400).json({ message: "ID de conductor inválido" });
  }

  try {
    let diasAGuardar = [];

    // 1. TRADUCCIÓN EXACTA: Convertimos opciones de usuario a valores del Modelo
    // El modelo pide: "lunes", "martes", "miercoles" (sin tilde), etc.
    
    if (diaSemanaTexto.toLowerCase() === "lunes-viernes") {
      diasAGuardar = ["lunes", "martes", "miercoles", "jueves", "viernes"];
    } else if (diaSemanaTexto.toLowerCase() === "diario") {
      diasAGuardar = [
        "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"
      ];
    } else {
      // Si viene un día individual (Ej: "Miércoles" o "Sabado")
      // Usamos un mapa para asegurar que coincida con el enum del modelo
      const mapaDias = {
        "Lunes": "lunes", "lunes": "lunes",
        "Martes": "martes", "martes": "martes",
        "Miércoles": "miercoles", "Miercoles": "miercoles", "miércoles": "miercoles", "miercoles": "miercoles",
        "Jueves": "jueves", "jueves": "jueves",
        "Viernes": "viernes", "viernes": "viernes",
        "Sábado": "sabado", "Sabado": "sabado", "sábado": "sabado", "sabado": "sabado",
        "Domingo": "domingo", "domingo": "domingo"
      };
      
      // Si está en el mapa lo usamos, si no, pasamos a minúscula por seguridad
      const diaLimpio = mapaDias[diaSemanaTexto] || diaSemanaTexto.toLowerCase();
      diasAGuardar = [diaLimpio];
    }

    // 2. Procesamos cada día
    const promesas = diasAGuardar.map(async (diaIndividual) => {
      // Buscamos si ya existe el documento base (Ruta + Día)
      let horarioBase = await Horario.findOne({
        ruta: ruta,
        diaSemana: diaIndividual,
      });

      // Si no existe, lo creamos primero
      if (!horarioBase) {
        horarioBase = new Horario({
          ruta: ruta,
          diaSemana: diaIndividual,
          salidas: [],
        });
      }

      // Verificamos si esa HORA exacta ya existe para no duplicarla
      const salidaExiste = horarioBase.salidas.some(
        (s) => s.hora === horaTexto
      );

      if (!salidaExiste) {
        // Agregamos la nueva salida al array
        horarioBase.salidas.push({
          hora: horaTexto,
          camionAsignado: camionAsignado || null,
          conductorAsignado: conductorAsignado || null,
        });
        return horarioBase.save();
      }
      return null;
    });

    await Promise.all(promesas);

    if (camionAsignado) {
      await rellenarCamionDesdeHorario(camionAsignado);
    }

    res.status(201).json({ message: "Horarios procesados correctamente" });

  } catch (error) {
    console.error("Error al guardar horario:", error);
    // Devolvemos el error exacto para debug
    res.status(400).json({ message: "Error de validación: " + error.message });
  }
});

// --- RUTA 3: Borrar una SALIDA específica ---
router.delete("/:id/salidas/:salidaId", protect, adminOnly, async (req, res) => {
  try {
    const { id, salidaId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(salidaId)) {
      return res.status(400).json({ message: "ID de horario o salida inválido" });
    }
    const horario = await Horario.findById(id);
    if (!horario) return res.status(404).json({ message: "Horario no encontrado" });

    const salida = horario.salidas.id(salidaId);
    const camionId = salida?.camionAsignado;

    await Horario.updateOne(
      { _id: id },
      { $pull: { salidas: { _id: salidaId } } }
    );

    if (camionId) {
      await rellenarCamionDesdeHorario(camionId);
    }

    res.json({ message: "Salida eliminada" });
  } catch (error) {
    res.status(500).json({ message: "Error eliminando salida" });
  }
});

// --- RUTA 4: Obtener un Horario por ID (Para editar) ---
router.get("/:id", protect, async (req, res) => {
  try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: "ID de horario inválido" });
      }
      const horario = await Horario.findById(req.params.id).populate("ruta");
      if (!horario) return res.status(404).json({ message: "Horario no encontrado" });
      res.json(horario);
  } catch (error) {
      res.status(500).json({ message: "Error obteniendo horario" });
  }
});

// --- RUTA 5: Editar una salida (CON MIGRACIÓN INTELIGENTE) ---
router.put("/:id/salidas/:salidaId", protect, adminOnly, async (req, res) => {
    const { id, salidaId } = req.params;
    // AGREGADO: Recibir camion y conductor del body
    const { hora, ruta, diaSemana, camionAsignado, conductorAsignado } = req.body; 

    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(salidaId)) {
      return res.status(400).json({ message: "ID de horario o salida inválido" });
    }
    if (!ruta || !mongoose.Types.ObjectId.isValid(ruta)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(hora || ""))) {
      return res.status(400).json({ message: "La hora debe tener formato HH:MM (24 h)" });
    }
    if (!diaSemana || !["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"].includes(String(diaSemana).toLowerCase())) {
      return res.status(400).json({ message: "diaSemana no válido" });
    }
    if (camionAsignado && !mongoose.Types.ObjectId.isValid(camionAsignado)) {
      return res.status(400).json({ message: "ID de camión inválido" });
    }
    if (conductorAsignado && !mongoose.Types.ObjectId.isValid(conductorAsignado)) {
      return res.status(400).json({ message: "ID de conductor inválido" });
    }

    try {
        const horarioOriginal = await Horario.findById(id);
        if (!horarioOriginal) return res.status(404).json({ message: "Horario original no encontrado" });

        const salidaOriginal = horarioOriginal.salidas.find(s => s._id.toString() === salidaId);
        if (!salidaOriginal) return res.status(404).json({ message: "Salida no encontrada" });

        const rutaCambio = horarioOriginal.ruta.toString() !== ruta;
        const diaCambio = horarioOriginal.diaSemana !== diaSemana;

        if (!rutaCambio && !diaCambio) {
            // CASO A: Solo cambiaron datos de la salida (hora, camión, conductor)
            const oldCamionId = salidaOriginal.camionAsignado;

            await Horario.updateOne(
                { "_id": id, "salidas._id": salidaId },
                { 
                    $set: { 
                        "salidas.$.hora": hora,
                        // AGREGADO: Actualizar también asignaciones
                        "salidas.$.camionAsignado": camionAsignado || null,
                        "salidas.$.conductorAsignado": conductorAsignado || null
                    } 
                }
            );

            if (oldCamionId && oldCamionId.toString() !== camionAsignado) {
                await rellenarCamionDesdeHorario(oldCamionId);
            }
            if (camionAsignado) {
                await rellenarCamionDesdeHorario(camionAsignado);
            }

            return res.json({ message: "Salida actualizada correctamente" });

        } else {
            // CASO B: Cambió ruta o día (Mover salida)
            const oldCamionId = salidaOriginal.camionAsignado;

            await Horario.updateOne(
                { _id: id },
                { $pull: { salidas: { _id: salidaId } } }
            );

            let horarioDestino = await Horario.findOne({ ruta: ruta, diaSemana: diaSemana });

            if (!horarioDestino) {
                horarioDestino = new Horario({
                    ruta: ruta,
                    diaSemana: diaSemana,
                    salidas: []
                });
            }

            // Insertamos en el nuevo destino con los datos nuevos
            horarioDestino.salidas.push({
                hora: hora,
                camionAsignado: camionAsignado || null,     // Usar el nuevo si viene, o null
                conductorAsignado: conductorAsignado || null
            });

            await horarioDestino.save();

            if (oldCamionId && oldCamionId.toString() !== camionAsignado) {
                await rellenarCamionDesdeHorario(oldCamionId);
            }
            if (camionAsignado) {
                await rellenarCamionDesdeHorario(camionAsignado);
            }

            return res.json({ message: "Horario movido y actualizado correctamente" });
        }

    } catch (error) {
        console.error("Error en migración:", error);
        res.status(500).json({ message: "Error crítico al actualizar horario" });
    }
});

// --- RUTA 6: Obtener horarios públicos de UNA RUTA específica ---
router.get("/publico/:rutaId", async (req, res) => {
  try {
    const { rutaId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(rutaId)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    res.json(await obtenerHorariosAgregados({ rutaId, incluirConductor: false }));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error obteniendo horarios públicos" });
  }
});

module.exports = router;
