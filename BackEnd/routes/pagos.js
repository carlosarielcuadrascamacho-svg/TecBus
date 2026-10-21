const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Tarifa = require("../models/Tarifa");
const Transaccion = require("../models/Transaccion");
const Ruta = require("../models/Ruta");
const { apiKeyAuth } = require("../middleware/apiKeyMiddleware");

const PRECIO_GENERAL_DEFAULT = 18.00;
const PRECIO_ESTUDIANTE_DEFAULT = 10.00;
const MAX_BOLETOS_POR_EVENTO = 10;

function fechaEvento(timestamp) {
    const numero = Number(timestamp);
    if (!Number.isFinite(numero) || numero <= 0) return new Date();
    const milisegundos = numero > 1e12 ? numero : numero * 1000;
    const fecha = new Date(milisegundos);
    if (Number.isNaN(fecha.getTime()) || Math.abs(Date.now() - fecha.getTime()) > 24 * 60 * 60 * 1000) {
        return new Date();
    }
    return fecha;
}

router.use(apiKeyAuth);

// Busca el precio aplicable para un usuario y ruta
async function obtenerPrecioUnitario(esEstudiante, rutaId) {
    let tarifa = null;

    if (rutaId && mongoose.Types.ObjectId.isValid(rutaId)) {
        tarifa = await Tarifa.findOne({ rutaId, activa: true });
    }

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

                if (!uid || !camionId || typeof camionId !== "string" || !camionId.trim()) {
                    resultados.push({ uid: uid || "?", estado: "error", motivo: "Datos incompletos" });
                    fallidas++;
                    continue;
                }

                const cantidad = cantidad_boletos === undefined ? 1 : Number(cantidad_boletos);
                if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_BOLETOS_POR_EVENTO) {
                    resultados.push({
                        uid,
                        estado: "error",
                        motivo: `Cantidad de boletos inválida (1 a ${MAX_BOLETOS_POR_EVENTO})`
                    });
                    fallidas++;
                    continue;
                }

                const eventoId = item.eventoId ? String(item.eventoId).trim() : null;

                const cleanUid = String(uid).trim().toUpperCase();
                const user = await User.findOne({
                    $or: [
                        { rfid_uid: cleanUid },
                        { rfid_uid: cleanUid.toLowerCase() },
                        { rfid_uid: String(uid).trim() }
                    ]
                });
                if (!user) {
                    resultados.push({ uid, estado: "error", motivo: "Usuario no encontrado" });
                    fallidas++;
                    continue;
                }

                // Idempotencia: si el mismo evento ya se procesó, no volver a cobrar.
                if (eventoId) {
                    const existente = await Transaccion.findOne({ eventoId });
                    if (existente) {
                        resultados.push({
                            uid,
                            estado: "ok",
                            monto: existente.monto,
                            saldo_restante: user.saldo,
                            duplicado: true
                        });
                        procesadas++;
                        continue;
                    }
                }

                const { precio, tipo } = await obtenerPrecioUnitario(user.es_estudiante, rutaId);
                const precioNumero = Number(precio);
                const total = Number((precioNumero * cantidad).toFixed(2));

                if (!Number.isFinite(precioNumero) || precioNumero <= 0 || !Number.isFinite(total) || total <= 0) {
                    resultados.push({ uid, estado: "error", motivo: "Tarifa inválida" });
                    fallidas++;
                    continue;
                }

                // Descuento atómico: la condición del saldo y el $inc se ejecutan
                // en una sola operación, evitando el doble gasto por concurrencia.
                const userActualizado = await User.findOneAndUpdate(
                    { _id: user._id, saldo: { $gte: total } },
                    { $inc: { saldo: -total } },
                    { new: true }
                );

                if (!userActualizado) {
                    resultados.push({ uid, estado: "error", motivo: "Saldo insuficiente" });
                    fallidas++;
                    continue;
                }

                let nuevaTrans;
                try {
                    const validRutaId = (rutaId && mongoose.Types.ObjectId.isValid(rutaId)) ? rutaId : undefined;
                    nuevaTrans = await Transaccion.create({
                        usuarioId: user._id,
                        camionId: camionId.trim(),
                        rutaId: validRutaId,
                        monto: total,
                        tipo_tarifa: tipo,
                        cantidad_boletos: cantidad,
                        timestamp: fechaEvento(timestamp),
                        eventoId: eventoId || undefined
                    });
                } catch (errorCreacion) {
                    // Revertir el descuento si no se pudo registrar la transacción.
                    await User.updateOne({ _id: user._id }, { $inc: { saldo: total } });
                    throw errorCreacion;
                }

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
                    saldo_restante: userActualizado.saldo
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
