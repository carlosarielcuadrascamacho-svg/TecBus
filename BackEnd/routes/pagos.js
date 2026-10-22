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
    return Number.isNaN(fecha.getTime()) ? new Date() : fecha;
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

function errorConCodigo(mensaje, codigo) {
    const error = new Error(mensaje);
    error.codigo = codigo;
    return error;
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

                const { precio, tipo } = await obtenerPrecioUnitario(user.es_estudiante, rutaId);
                const precioNumero = Number(precio);
                const total = Number((precioNumero * cantidad).toFixed(2));

                if (!Number.isFinite(precioNumero) || precioNumero <= 0 || !Number.isFinite(total) || total <= 0) {
                    resultados.push({ uid, estado: "error", motivo: "Tarifa inválida" });
                    fallidas++;
                    continue;
                }

                const validRutaId = (rutaId && mongoose.Types.ObjectId.isValid(rutaId)) ? rutaId : undefined;
                let nuevaTrans = null;
                let saldoRestante = null;
                let duplicado = false;

                // El descuento y el registro se hacen en la misma transacción para
                // que un fallo entre ambos no deje el saldo descontado sin recibo.
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        if (eventoId) {
                            const existente = await Transaccion.findOne({ eventoId }).session(session);
                            if (existente) {
                                if (existente.usuarioId.toString() !== user._id.toString()) {
                                    throw errorConCodigo(
                                        "El evento ya fue procesado para otro usuario",
                                        "EVENTO_OTRO_USUARIO"
                                    );
                                }
                                const usuarioActual = await User.findById(user._id)
                                    .select("saldo")
                                    .session(session);
                                nuevaTrans = existente;
                                saldoRestante = usuarioActual ? usuarioActual.saldo : user.saldo;
                                duplicado = true;
                                return;
                            }
                        }

                        const userActualizado = await User.findOneAndUpdate(
                            { _id: user._id, saldo: { $gte: total } },
                            { $inc: { saldo: -total } },
                            { new: true, session }
                        );

                        if (!userActualizado) {
                            throw errorConCodigo("Saldo insuficiente", "SALDO_INSUFICIENTE");
                        }

                        const [creada] = await Transaccion.create([{
                            usuarioId: user._id,
                            camionId: camionId.trim(),
                            rutaId: validRutaId,
                            monto: total,
                            tipo_tarifa: tipo,
                            cantidad_boletos: cantidad,
                            timestamp: fechaEvento(timestamp),
                            eventoId: eventoId || undefined
                        }], { session });

                        nuevaTrans = creada;
                        saldoRestante = userActualizado.saldo;
                    });
                } catch (errorTransaccion) {
                    // Dos peticiones concurrentes con el mismo eventoId: la segunda
                    // choca con el índice único. Se responde como duplicado válido.
                    if (errorTransaccion && errorTransaccion.code === 11000 && eventoId) {
                        const existente = await Transaccion.findOne({ eventoId });
                        if (existente && existente.usuarioId.toString() === user._id.toString()) {
                            const usuarioActual = await User.findById(user._id).select("saldo");
                            nuevaTrans = existente;
                            saldoRestante = usuarioActual ? usuarioActual.saldo : user.saldo;
                            duplicado = true;
                        } else {
                            throw errorTransaccion;
                        }
                    } else {
                        throw errorTransaccion;
                    }
                } finally {
                    await session.endSession();
                }

                if (!nuevaTrans) {
                    throw new Error("No se pudo registrar la transacción");
                }

                if (!duplicado) {
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
                                monto: nuevaTrans.monto,
                                tipo_tarifa: tipo,
                                cantidad_boletos: cantidad,
                                timestamp: nuevaTrans.timestamp,
                                usuarioId: { nombre: user.nombre || "Pasajero" },
                                rutaId: rutaNombre ? { nombre: rutaNombre } : null
                            });
                        }
                    } catch (_) { /* emit no crítico */ }
                }

                resultados.push({
                    uid,
                    estado: "ok",
                    monto: nuevaTrans.monto,
                    saldo_restante: saldoRestante,
                    ...(duplicado ? { duplicado: true } : {})
                });
                procesadas++;

            } catch (err) {
                const motivo = err.codigo === "SALDO_INSUFICIENTE"
                    ? "Saldo insuficiente"
                    : (err.message || "Error");
                resultados.push({
                    uid: item?.uid || "?",
                    estado: "error",
                    motivo
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
