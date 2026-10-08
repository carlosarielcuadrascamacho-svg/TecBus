const express = require("express");
const router = express.Router();
const Transaccion = require("../models/Transaccion");
const { protect, adminOnly } = require("../middleware/authMiddleware");

router.use(protect);

// GET /api/transacciones — Admin: Historial global de transacciones
router.get("/", adminOnly, async (req, res) => {
    try {
        const transacciones = await Transaccion.find({})
            .populate("usuarioId", "nombre email")
            .populate("rutaId", "nombre")
            .sort({ timestamp: -1 }) // Las más recientes primero
            .limit(100); // Traemos las últimas 100 para que cargue súper rápido
            
        res.json(transacciones);
    } catch (error) {
        console.error("Error obteniendo historial global:", error);
        res.status(500).json({ message: "Error del servidor" });
    }
});

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

// POST /api/transacciones/recargar — Pasajero: Recargar saldo desde su app
router.post("/recargar", async (req, res) => {
    try {
        const { monto } = req.body;
        
        // Validación de seguridad básica
        if (!monto || monto < 10) {
            return res.status(400).json({ message: "El monto mínimo es de $10 MXN" });
        }
        if (monto > 10000) {
            return res.status(400).json({ message: "El monto máximo por recarga es de $10,000 MXN" });
        }

        // 1. Buscar al pasajero logueado
        const User = require("../models/User");
        const usuario = await User.findById(req.user._id);
        if (!usuario) return res.status(404).json({ message: "Usuario no encontrado" });

        // 2. Sumar el dinero a su saldo
        usuario.saldo = (parseFloat(usuario.saldo) || 0) + parseFloat(monto);
        await usuario.save();

        // 3. Registrar el movimiento para que aparezca en el historial (Global y del Pasajero)
        const nuevaTransaccion = new Transaccion({
            usuarioId: usuario._id,
            usuarioEmail: usuario.email,
            monto: parseFloat(monto),
            tipo_tarifa: "Recarga", // Esta palabra clave hará que se pinte en verde (+)
            saldo_despues: usuario.saldo
        });
        await nuevaTransaccion.save();

        // 4. Responder con éxito y el nuevo saldo
        res.json({ 
            message: "Recarga exitosa", 
            nuevoSaldo: usuario.saldo 
        });
    } catch (error) {
        console.error("Error en la pasarela de recarga:", error);
        res.status(500).json({ message: "Error del servidor al procesar el pago" });
    }
});

// POST /api/transacciones/recargar — Pasajero: Simular recarga de saldo
router.post("/recargar", async (req, res) => {
    try {
        const { monto } = req.body;
        
        if (!monto || monto < 10) {
            return res.status(400).json({ message: "El monto mínimo es de $10 MXN" });
        }
        if (monto > 10000) {
            return res.status(400).json({ message: "El monto máximo por recarga es de $10,000 MXN" });
        }

        // 1. Encontrar al usuario actual
        const User = require("../models/User");
        const usuario = await User.findById(req.user._id);
        if (!usuario) return res.status(404).json({ message: "Usuario no encontrado" });

        // 2. Sumar el saldo matemático
        usuario.saldo = (parseFloat(usuario.saldo) || 0) + parseFloat(monto);
        await usuario.save();

        // 3. Crear el "Ticket" del movimiento
        const nuevaTransaccion = new Transaccion({
            usuarioId: usuario._id,
            usuarioEmail: usuario.email,
            monto: parseFloat(monto),
            tipo_tarifa: "Recarga", // Esta palabra clave le dice al panel que pinte esto de verde (+)
            saldo_despues: usuario.saldo
        });
        await nuevaTransaccion.save();

        // 4. Responder al frontend
        res.json({ 
            message: "Recarga procesada exitosamente", 
            nuevoSaldo: usuario.saldo 
        });
    } catch (error) {
        console.error("Error procesando recarga simulada:", error);
        res.status(500).json({ message: "Error del servidor al procesar el pago" });
    }
});

module.exports = router;
