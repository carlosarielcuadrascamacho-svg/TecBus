const mongoose = require('mongoose');

const tarifaSchema = new mongoose.Schema({
    rutaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Ruta',
        default: null,
        unique: true,
        sparse: true
    },
    precioGeneral: {
        type: Number,
        required: true
    },
    precioEstudiante: {
        type: Number,
        required: true
    },
    activa: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Tarifa', tarifaSchema);
