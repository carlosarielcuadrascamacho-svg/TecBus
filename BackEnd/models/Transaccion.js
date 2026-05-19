const mongoose = require('mongoose');

const transaccionSchema = new mongoose.Schema({
    usuarioId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    camionId: {
        type: String,
        required: true
    },
    rutaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ruta'
    },
    monto: {
        type: Number,
        required: true
    },
    tipo_tarifa: {
        type: String,
        enum: ['General', 'Estudiante'],
        default: 'General'
    },
    cantidad_boletos: {
        type: Number,
        default: 1
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Transaccion', transaccionSchema);
