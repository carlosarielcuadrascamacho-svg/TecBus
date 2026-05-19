const express = require("express");
const router = express.Router();
const User = require("../models/User");
const Tarifa = require("../models/Tarifa");
const Transaccion = require("../models/Transaccion");
const Ruta = require("../models/Ruta");
const { apiKeyAuth } = require("../middleware/apiKeyMiddleware");

const PRECIO_GENERAL_DEFAULT = 12.00;
const PRECIO_ESTUDIANTE_DEFAULT = 8.00;

router.use(apiKeyAuth);

// Busca el precio aplicable para un usuario y ruta
async function obtenerPrecioUnitario(esEstudiante, rutaId) {
    let tarifa = await Tarifa.findOne({ rutaId, activa: true });

    if (!tarifa) {
        tarifa = await Tarifa.findOne({ rutaId: null, activa: true });
    }

    if (tarifa) {
        return {
            precio: esEstudiante ? tarifa.precioEstudiante : tarifa.precioGeneral,
            tipo: esEstudiante ? "Estudiante" : "General"
        };
    }

    return {
        precio: esEstudiante ? PRECIO_ESTUDIANTE_DEFAULT : PRECIO_GENERAL_DEFAULT,
        tipo: esEstudiante ? "Estudiante" : "General"
    };
}

// POST /api/pagos/procesar — Procesar array batch de cobros
router.post("/procesar", async (req, res) => {
    try {
        const eventos = req.body;

        if (!Array.isArray(eventos) || eventos.length === 0) {
            return res.status(400).json({ message: "El body debe ser un array de eventos" });
        }

        const resultados = [];
        let procesadas = 0;
        let fallidas = 0;

        for (const item of eventos) {
            try {
                const { uid, rutaId, cantidad_boletos, camionId, timestamp } = item;

                if (!uid || !camionId) {
                    resultados.push({ uid: uid || "?", estado: "error", motivo: "Datos incompletos" });
                    fallidas++;
                    continue;
                }

                const user = await User.findOne({ rfid_uid: uid });
                if (!user) {
                    resultados.push({ uid, estado: "error", motivo: "Usuario no encontrado" });
                    fallidas++;
                    continue;
                }

                const { precio, tipo } = await obtenerPrecioUnitario(user.es_estudiante, rutaId);
                const cantidad = Number(cantidad_boletos) || 1;
                const total = parseFloat((precio * cantidad).toFixed(2));

                user.saldo = parseFloat(((user.saldo || 0) - total).toFixed(2));
                await user.save();

                const nuevaTrans = await Transaccion.create({
                    usuarioId: user._id,
                    camionId,
                    rutaId: rutaId || undefined,
                    monto: total,
                    tipo_tarifa: tipo,
                    cantidad_boletos: cantidad,
                    timestamp: timestamp ? new Date(timestamp * 1000) : new Date()
                });

                try {
                    const io = req.app.get("io");
                    if (io) {
                        let rutaNombre = null;
                        if (rutaId) {
                            const rutaDoc = await Ruta.findById(rutaId).select("nombre");
                            if (rutaDoc) rutaNombre = rutaDoc.nombre;
                        }
                        io.emit("nuevaTransaccion", {
                            _id: nuevaTrans._id,
                            camionId,
                            monto: total,
                            tipo_tarifa: tipo,
                            cantidad_boletos: cantidad,
                            timestamp: nuevaTrans.timestamp,
                            usuarioId: { nombre: user.nombre || "Pasajero" },
                            rutaId: rutaNombre ? { nombre: rutaNombre } : null
                        });
                    }
                } catch (_) { /* emit no crítico */ }

                resultados.push({
                    uid,
                    estado: "ok",
                    monto: total,
                    saldo_restante: user.saldo
                });
                procesadas++;

            } catch (err) {
                resultados.push({
                    uid: item?.uid || "?",
                    estado: "error",
                    motivo: err.message
                });
                fallidas++;
            }
        }

        res.json({
            procesadas,
            fallidas,
            detalle: resultados
        });

    } catch (error) {
        console.error("Error en /api/pagos/procesar:", error);
        res.status(500).json({ message: "Error interno del servidor", error: error.message });
    }
});

module.exports = router;
