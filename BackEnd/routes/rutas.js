// backend/routes/rutas.js

const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();
const Ruta = require("../models/Ruta"); // Importamos el modelo de Ruta
const { protect, adminOnly } = require("../middleware/authMiddleware"); // Reusamos el guardaespaldas
const Horario = require("../models/Horario");

const idValido = (id) => mongoose.Types.ObjectId.isValid(id);
const coordenadasValidas = (p) =>
  Array.isArray(p) &&
  p.length === 2 &&
  Number.isFinite(Number(p[0])) &&
  Number.isFinite(Number(p[1])) &&
  Number(p[0]) >= -180 && Number(p[0]) <= 180 &&
  Number(p[1]) >= -90 && Number(p[1]) <= 90;

// --- RUTA 1: Obtener TODAS las rutas ---
// GET /api/rutas
router.get("/", protect, async (req, res) => {
  try {
    const rutas = await Ruta.find(); // Busca todas las rutas
    res.json(rutas);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Crear una NUEVA ruta ---
// POST /api/rutas
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    // Por ahora, solo creamos la ruta con nombre y descripción.
    // Las paradas se añadirán después con una UI más compleja.
    const { nombre, descripcion, tiempoEstimadoTotal } = req.body;

    if (!String(nombre || "").trim()) {
      return res.status(400).json({ message: "El nombre de la ruta es requerido" });
    }
    if (tiempoEstimadoTotal !== undefined && (!Number.isFinite(Number(tiempoEstimadoTotal)) || Number(tiempoEstimadoTotal) < 0)) {
      return res.status(400).json({ message: "tiempoEstimadoTotal inválido" });
    }

    const rutaExists = await Ruta.findOne({ nombre });
    if (rutaExists) {
      return res
        .status(400)
        .json({ message: "El nombre de esta ruta ya existe" });
    }

    const ruta = new Ruta({
      nombre,
      descripcion,
      tiempoEstimadoTotal,
      paradas: [], // Dejamos las paradas vacías por ahora
      activa: true,
    });

    const nuevaRuta = await ruta.save();
    res.status(201).json(nuevaRuta);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 3: Actualizar una ruta ---
// PUT /api/rutas/:id
router.put("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    const ruta = await Ruta.findById(req.params.id);

    if (ruta) {
      ruta.nombre = req.body.nombre || ruta.nombre;
      ruta.descripcion = req.body.descripcion || ruta.descripcion;
      ruta.tiempoEstimadoTotal = req.body.tiempoEstimadoTotal || ruta.tiempoEstimadoTotal;
      ruta.activa =
        req.body.activa !== undefined ? req.body.activa : ruta.activa;

      const rutaActualizada = await ruta.save();
      res.json(rutaActualizada);
    } else {
      res.status(404).json({ message: "Ruta no encontrada" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 4: Borrar una ruta ---
// DELETE /api/rutas/:id
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    const ruta = await Ruta.findById(req.params.id);

    if (ruta) {
      await ruta.deleteOne();
      res.json({ message: "Ruta eliminada" });
    } else {
      res.status(404).json({ message: "Ruta no encontrada" });
    }
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});
// --- RUTA 5: OBTENER las paradas de UNA ruta (para el estudiante) ---
// GET /api/rutas/:id
router.get("/:id", protect, async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    // Busca la ruta por su ID y solo selecciona el campo 'paradas'
    const ruta = await Ruta.findById(req.params.id).select("paradas nombre");

    if (!ruta) {
      return res.status(404).json({ message: "Ruta no encontrada" });
    }
    res.json(ruta);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 6: ACTUALIZAR las paradas de UNA ruta (para el admin) ---
// PUT /api/rutas/:id/paradas
router.put("/:id/paradas", protect, adminOnly, async (req, res) => {
  try {
    if (!idValido(req.params.id)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }

    const { paradas } = req.body; // Recibimos el array de paradas

    if (!Array.isArray(paradas)) {
      return res.status(400).json({ message: "paradas debe ser un arreglo" });
    }
    for (const parada of paradas) {
      if (!parada || typeof parada !== "object") {
        return res.status(400).json({ message: "Parada inválida" });
      }
      if (parada.nombre !== undefined && String(parada.nombre).length > 120) {
        return res.status(400).json({ message: "Nombre de parada demasiado largo" });
      }
      if (parada.ubicacion) {
        const coords = parada.ubicacion.coordinates;
        if (!coordenadasValidas(coords)) {
          return res.status(400).json({ message: "Coordenadas de parada inválidas" });
        }
      }
    }

    const ruta = await Ruta.findById(req.params.id);
    if (!ruta) {
      return res.status(404).json({ message: "Ruta no encontrada" });
    }

    // Actualizamos el campo 'paradas' como lo diseñaste en tu PDF
    ruta.paradas = paradas;

    const rutaActualizada = await ruta.save();
    res.json(rutaActualizada);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

router.get("/:id/proximo-camion", async (req, res) => {
  try {
    const rutaId = req.params.id;

    if (!idValido(rutaId)) {
      return res.status(400).json({ message: "ID de ruta inválido" });
    }
    
    // 1. Obtener día y hora actual
    const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const fechaActual = new Date();
    const diaActual = dias[fechaActual.getDay()];
    
    // Convertimos hora actual a formato comparable (ej: 14 * 60 + 30 = 870 minutos)
    const minutosActuales = fechaActual.getHours() * 60 + fechaActual.getMinutes();

    // 2. Buscar horarios de HOY para esa ruta
    const horarios = await Horario.find({ 
        ruta: rutaId, 
        diaSemana: diaActual 
    }).populate("camionAsignado");

    if (!horarios.length) {
        return res.status(404).json({ message: "No hay horarios para esta ruta hoy." });
    }

    // 3. Encontrar el horario más cercano (el que tenga la menor diferencia de tiempo positiva)
    // Si ya pasó la hora, buscamos el siguiente.
    let horarioCercano = null;
    let menorDiferencia = Infinity;

    horarios.forEach(h => {
        const [horas, mins] = h.hora.split(":").map(Number);
        const minutosHorario = horas * 60 + mins;
        
        // Calculamos diferencia. Si es negativo, el camión ya salió hace mucho, 
        // pero podemos dar un margen de 20 mins (el camión sigue en ruta)
        let diferencia = minutosHorario - minutosActuales;

        // Si la diferencia es negativa (ej: -10 mins), significa que acaba de salir.
        // Lo consideramos válido si salió hace menos de 1 hora (sigue dando vueltas).
        if (diferencia < 0 && diferencia > -60) { 
             diferencia = Math.abs(diferencia); // Prioridad alta
        } 

        if (diferencia >= -60 && diferencia < menorDiferencia) {
            menorDiferencia = diferencia;
            horarioCercano = h;
        }
    });

    if (!horarioCercano || !horarioCercano.camionAsignado) {
         // Si no encontramos uno cercano, mandamos el primero del día o error
         return res.status(404).json({ message: "No hay camiones circulando o asignados pronto." });
    }

    // 4. Devolvemos solo los datos del camión
    res.json({
        camion: horarioCercano.camionAsignado,
        horaSalida: horarioCercano.hora
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error buscando camión de la ruta" });
  }
});

module.exports = router;
