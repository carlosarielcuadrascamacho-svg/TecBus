const mongoose = require('mongoose');

const ubicacionEnVivoSchema = new mongoose.Schema({
  camionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Camion',
    required: true,
    unique: true // CLAVE: Garantiza que solo haya 1 doc por camión
  },
  numeroUnidad: { type: String, required: true },
  ubicacion: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [Longitud, Latitud]
  },
  velocidad: Number,
  pasajeros_actuales: { type: Number, default: 0 },
  luces_perifericos_encendidos: { type: Boolean, default: false },
  minutos_ralenti: { type: Number, default: 0 },
  ultimaActualizacion: { type: Date, default: Date.now },
  estado: String // "En Ruta", "Detenido", etc.
});

// Índice geoespacial para búsquedas rápidas "cerca de mí"
ubicacionEnVivoSchema.index({ ubicacion: '2dsphere' });

module.exports = mongoose.model('UbicacionEnVivo', ubicacionEnVivoSchema, 'ubicacionesEnVivo');