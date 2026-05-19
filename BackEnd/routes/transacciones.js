const express = require("express");
const router = express.Router();
const Transaccion = require("../models/Transaccion");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.use(protect);

// GET /api/transacciones/admin/user/:userId — Admin: ver transacciones de cualquier usuario
router.get("/admin/user/:userId", adminOnly, async (req, res) => {
    try {
        const transacciones = await Transaccion.find({ usuarioId: req.params.userId })
            .populate("rutaId", "nombre")
            .sort({ timestamp: -1 })
            .limit(50);
        res.json(transacciones);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// GET /api/transacciones/mias — Transacciones del usuario logueado
router.get("/mias", async (req, res) => {
    try {
        const transacciones = await Transaccion.find({ usuarioId: req.user._id })
            .populate("rutaId", "nombre")
            .sort({ timestamp: -1 })
            .limit(50);
        res.json(transacciones);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// GET /api/transacciones/camion/:camionId — Últimas transacciones de un camión
router.get("/camion/:camionId", async (req, res) => {
    try {
        const transacciones = await Transaccion.find({ camionId: req.params.camionId })
            .populate("usuarioId", "nombre email es_estudiante")
            .populate("rutaId", "nombre")
            .sort({ timestamp: -1 })
            .limit(30);
        res.json(transacciones);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// GET /api/transacciones/saldo — Saldo actual del usuario logueado
router.get("/saldo", async (req, res) => {
    try {
        const User = require("../models/User");
        const user = await User.findById(req.user._id).select("saldo es_estudiante");
        if (!user) return res.status(404).json({ message: "Usuario no encontrado" });
        res.json({ saldo: user.saldo, es_estudiante: user.es_estudiante });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

module.exports = router;
