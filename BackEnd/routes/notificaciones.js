// backend/routes/notificaciones.js

const express = require("express");
const router = express.Router();
const webpush = require("web-push");
const User = require("../models/User");
const Notificacion = require("../models/Notificacion"); // Para guardar historial
const { protect, adminOnly } = require("../middleware/authMiddleware");

// 1. Configurar web-push con las llaves del .env (sin romper el arranque si faltan)
const VAPID_CONFIGURADO = Boolean(
  process.env.PUBLIC_VAPID_KEY && process.env.PRIVATE_VAPID_KEY
);

if (VAPID_CONFIGURADO) {
  webpush.setVapidDetails(
    process.env.MAILTO || "mailto:admin@example.com",
    process.env.PUBLIC_VAPID_KEY,
    process.env.PRIVATE_VAPID_KEY
  );
} else {
  console.warn("⚠️  Web Push deshabilitado: faltan PUBLIC_VAPID_KEY/PRIVATE_VAPID_KEY.");
}

// --- RUTA 1: PRUEBA DE NOTIFICACIÓN (GET /api/notificaciones/mi-prediccion-prueba) ---
router.get("/mi-prediccion-prueba", protect, async (req, res) => {
  if (!VAPID_CONFIGURADO) {
    return res.status(503).json({ message: "Las notificaciones push no están configuradas." });
  }
  const userId = req.user._id;

  try {
    
    const user = await User.findById(userId);
    if (!user || !user.pushSubscription) {
      return res.status(404).json({ message: "No tienes suscripción activa" });
    }
    
    // Creamos el mensaje (Payload)
    const payload = JSON.stringify({
      title: "🚍 Notificaciones SmartBus",
      body: "Hola " + user.nombre.split(" ")[0] + ", las notificaciones han sido activadas correctamente.",
      icon: "assets/img/Tecbus.png" // Icono de bus
    });

    // Enviamos la notificación
    await webpush.sendNotification(user.pushSubscription, payload);
    
    res.json({ message: "Notificación de prueba enviada" });
  } catch (error) {
    console.error("Error enviando push:", error);
    res.status(500).json({ message: "Error al enviar notificación" });
  }
});

// --- RUTA 3: ENVIAR ALERTA GENERAL (POST /api/notificaciones/send-all) ---
// Para que el admin envíe avisos manuales
router.post("/send-all", protect, adminOnly, async (req, res) => {
  const { titulo, mensaje } = req.body;

  if (!titulo || !mensaje) {
    return res.status(400).json({ message: "titulo y mensaje son requeridos" });
  }
  if (!VAPID_CONFIGURADO) {
    return res.status(503).json({ message: "Las notificaciones push no están configuradas." });
  }

  try {
    // 1. Guardar en historial
    await Notificacion.create({ 
        titulo, 
        mensaje, 
        tipo: 'general', 
        prioridad: 'media' 
    });

    // 2. Buscar usuarios con suscripción
    const users = await User.find({ pushSubscription: { $ne: null } });

    // 3. Enviar a todos
    const notificationPromises = users.map(user => {
      const payload = JSON.stringify({ title: titulo, body: mensaje });
      return webpush.sendNotification(user.pushSubscription, payload)
        .catch(err => console.error(`Fallo envío a ${user.nombre}:`, err));
    });

    await Promise.all(notificationPromises);
    res.json({ message: `Notificación enviada a ${users.length} usuarios` });

  } catch (error) {
    res.status(500).json({ message: "Error masivo" });
  }
});

// --- RUTA 4: OBTENER HISTORIAL (BLINDADA) ---
router.get("/", protect, async (req, res) => {
  try {
    const historial = await Notificacion.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("camionId", "numeroUnidad"); 

    const historialFormateado = historial.map(notif => {
        const n = notif.toObject();
        
        // Lógica para decidir qué mostrar en la columna "Camión"
        let nombreCamion = "N/A"; // Por defecto (para alertas generales)

        if (n.camionId && n.camionId.numeroUnidad) {
            // Caso perfecto: Tenemos el objeto camión y su número
            nombreCamion = n.camionId.numeroUnidad;
        } else if (n.tipo === 'incidente') {
            // Caso raro: Es incidente pero no se encontró el camión en la DB
            nombreCamion = "Desconocido";
        }

        return {
            ...n,
            camionUnidad: nombreCamion
        };
    });

    res.json(historialFormateado);

  } catch (error) {
    console.error("Error obteniendo historial:", error);
    res.status(500).json({ message: "Error al cargar alertas" });
  }
});

// Ruta para recibir la suscripción desde el Frontend
router.post("/suscribir", protect, async (req, res) => {
  const subscription = req.body;
  const userId = req.user._id; // Obtenido del token

  try {
    // Guardamos la suscripción en el documento del usuario
    await User.findByIdAndUpdate(userId, { pushSubscription: subscription });
    res.status(200).json({ message: "Suscripción guardada." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al guardar suscripción." });
  }
});

module.exports = router;
