const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Tarifa = require("../models/Tarifa");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.use(protect, adminOnly);

// GET /api/taquilla/user/:email — Buscar usuario por email
router.get("/user/:email", async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email }).select("-password");
        if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

        res.json({
            _id: user._id,
            nombre: user.nombre,
            email: user.email,
            tipo: user.tipo,
            saldo: user.saldo,
            es_estudiante: user.es_estudiante,
            rfid_uid: user.rfid_uid,
            estudiante: user.estudiante,
            conductor: user.conductor,
            estado: user.estado
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// PUT /api/taquilla/vincular — Vincular RFID y recargar saldo
router.put("/vincular", async (req, res) => {
    try {
        const { email, rfid_uid, monto_inicial } = req.body;
        if (!email || !rfid_uid || monto_inicial === undefined) {
            return res.status(400).json({ message: "email, rfid_uid y monto_inicial son requeridos" });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

        const rfidExistente = await User.findOne({ rfid_uid, _id: { $ne: user._id } });
        if (rfidExistente) {
            return res.status(409).json({ message: "Esta tarjeta RFID ya está vinculada a otro usuario" });
        }

        user.rfid_uid = rfid_uid;
        user.saldo = (user.saldo || 0) + Number(monto_inicial);
        await user.save();

        res.json({
            message: `Tarjeta ${rfid_uid} vinculada a ${email} con saldo de $${user.saldo}`,
            saldo: user.saldo,
            rfid_uid: user.rfid_uid
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// PUT /api/taquilla/estudiante — Cambiar estado de estudiante
router.put("/estudiante", async (req, res) => {
    try {
        const { email, estado } = req.body;
        if (!email || typeof estado !== "boolean") {
            return res.status(400).json({ message: "email y estado (boolean) son requeridos" });
        }

        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: "Usuario no encontrado" });

        user.es_estudiante = estado;
        await user.save();

        res.json({
            message: `Usuario ${email} ahora ${estado ? "es" : "no es"} estudiante`,
            es_estudiante: user.es_estudiante
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// GET /api/taquilla/tarifas — Listar todas las tarifas
router.get("/tarifas", async (req, res) => {
    try {
        const tarifas = await Tarifa.find().populate("rutaId", "nombre").sort({ rutaId: 1 });
        res.json(tarifas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// PUT /api/taquilla/tarifas/global — Crear o actualizar tarifa global
router.put("/tarifas/global", async (req, res) => {
    try {
        const { precioGeneral, precioEstudiante } = req.body;
        if (precioGeneral === undefined || precioEstudiante === undefined) {
            return res.status(400).json({ message: "precioGeneral y precioEstudiante son requeridos" });
        }

        const tarifa = await Tarifa.findOneAndUpdate(
            { rutaId: null },
            { precioGeneral, precioEstudiante, activa: true },
            { upsert: true, new: true }
        );

        res.json({ message: "Tarifa global actualizada", tarifa });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// PUT /api/taquilla/tarifas/ruta/:rutaId — Crear o actualizar tarifa por ruta
router.put("/tarifas/ruta/:rutaId", async (req, res) => {
    try {
        const { precioGeneral, precioEstudiante } = req.body;
        if (precioGeneral === undefined || precioEstudiante === undefined) {
            return res.status(400).json({ message: "precioGeneral y precioEstudiante son requeridos" });
        }

        const tarifa = await Tarifa.findOneAndUpdate(
            { rutaId: req.params.rutaId },
            { rutaId: req.params.rutaId, precioGeneral, precioEstudiante, activa: true },
            { upsert: true, new: true }
        );

        res.json({ message: "Tarifa actualizada para la ruta", tarifa });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

// DELETE /api/taquilla/tarifas/ruta/:rutaId — Eliminar tarifa específica de una ruta
router.delete("/tarifas/ruta/:rutaId", async (req, res) => {
    try {
        const tarifa = await Tarifa.findOneAndDelete({ rutaId: req.params.rutaId });
        if (!tarifa) return res.status(404).json({ message: "No hay tarifa para esta ruta" });

        res.json({ message: "Tarifa eliminada. La ruta usará la tarifa global." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

module.exports = router;
