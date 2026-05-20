const express = require("express");
const router = express.Router();
const HistorialBusqueda = require("../models/HistorialBusqueda");
const HistorialUbicacion = require("../models/HistorialUbicacion");
const { protect } = require("../middleware/authMiddleware");

// GUARDAR BÚSQUEDA (Se llama automáticamente desde el mapa)
router.post("/", protect, async (req, res) => {
  try {
    const { rutaId, location } = req.body;
    const fecha = new Date();
    // Formato HH:MM
    const horaActual = fecha.getHours().toString().padStart(2, '0') + ":" + fecha.getMinutes().toString().padStart(2, '0');

    await HistorialBusqueda.create({
      usuario: req.user._id,
      ruta: rutaId,
      ubicacionOrigen: location, // { lat, lng }
      horaBusqueda: horaActual
    });
    res.status(201).json({ message: "Búsqueda registrada para análisis" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error registrando historial" });
  }
});

// OBTENER HISTORIAL (Para el Modal)
router.get("/", protect, async (req, res) => {
  try {
    const historial = await HistorialBusqueda.find({ usuario: req.user._id })
      .populate("ruta", "nombre descripcion")
      .sort({ createdAt: -1 })
      .limit(20); // Traer los últimos 20
    res.json(historial);
  } catch (error) {
    res.status(500).json({ message: "Error obteniendo historial" });
  }
});
// OBTENER MAPA DE CALOR (Rutas Vacías en GeoJSON para MapLibre)
// Endpoint público o protegido según convenga, aquí lo dejamos sin auth por simplicidad del panel
router.get("/mapa-calor-vacio", async (req, res) => {
  try {
    const ubicacionesVacias = await HistorialUbicacion.find({ pasajeros_actuales: 0 })
      .select('ubicacion.coordinates -_id')
      .lean();

    // Construimos un FeatureCollection compatible con MapLibre
    const features = ubicacionesVacias
      .filter(u => u.ubicacion && u.ubicacion.coordinates && u.ubicacion.coordinates.length === 2)
      .map(u => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [u.ubicacion.coordinates[0], u.ubicacion.coordinates[1]] // [Longitud, Latitud]
        },
        properties: {}
      }));

    res.status(200).json({
      type: 'FeatureCollection',
      features: features
    });
  } catch (error) {
    console.error("Error obteniendo mapa de calor:", error);
    res.status(500).json({ message: "Error al consultar historial de rutas vacías" });
  }
});

module.exports = router;