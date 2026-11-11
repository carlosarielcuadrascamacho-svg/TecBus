// backend/models/Resena.js

const mongoose = require("mongoose");

const resenaSchema = new mongoose.Schema(
  {
    usuarioId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Snapshot del autor para no depender de cambios posteriores en el perfil.
    nombre: { type: String, required: true, trim: true, maxlength: 80 },
    avatar: { type: String, trim: true, default: "" },
    // null = reseña del servicio general; ObjectId = reseña de una ruta.
    rutaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Ruta",
      default: null,
    },
    rutaNombre: { type: String, trim: true, maxlength: 120, default: "" },
    calificacion: { type: Number, required: true, min: 1, max: 5 },
    comentario: {
      type: String,
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 600,
    },
    visible: { type: Boolean, default: true },
    destacada: { type: Boolean, default: false },
    // Huella con sal para detectar abuso sin almacenar la IP real.
    ipHash: { type: String, select: false },
  },
  { timestamps: true }
);

// Una sola reseña por usuario y ruta (incluye la general con rutaId = null).
resenaSchema.index({ usuarioId: 1, rutaId: 1 }, { unique: true });
// Consulta principal de la landing y del panel.
resenaSchema.index({ visible: 1, destacada: -1, createdAt: -1 });

module.exports = mongoose.model("Resena", resenaSchema);
