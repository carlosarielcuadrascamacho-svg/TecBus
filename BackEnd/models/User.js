// backend/models/User.js

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Definimos los sub-documentos que especificaste en tu PDF
const estudianteSchema = new mongoose.Schema({
    matricula: { type: String },
    carrera: { type: String },
    rutaPreferida: { type: String }
});

const conductorSchema = new mongoose.Schema({
    licencia: { type: String },
    // Usamos 'ObjectId' para referenciar a la colección 'Camiones'
    vehiculoAsignado: { type: mongoose.Schema.Types.ObjectId, ref: 'Camion' }, 
    horarioTrabajo: [String],
    agencia: { type: String }
});

const administradorSchema = new mongoose.Schema({
    nivelAcceso: { type: String },
    agencia: { type: String },
    permisos: [String]
});

// Este es el Schema Principal de Usuario
// Se basa 100% en tu documento "BASE DE DATOS PROYECTO INTEGRADOR.pdf"
const userSchema = new mongoose.Schema({
    nombre: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true // Tu diseño especifica "Unique"
    },
    password: {
        type: String,
        required: true // Tu diseño especifica "Hash"
    },
    tipo: {
        type: String,
        required: true,
        enum: ['estudiante', 'conductor', 'administrador', 'usuario'],
        default: 'estudiante'
    },
    telefono: { type: String },
    // === SmartBus Pagos ===
    rfid_uid: { type: String, unique: true, sparse: true },
    saldo: { type: Number, default: 0 },
    es_estudiante: { type: Boolean, default: false },
    // =====================
    estado: {
      type: String,
      // 👇 AGREGAMOS AQUÍ LOS NUEVOS ESTADOS QUE USA EL CONDUCTOR
      enum: [
            'activo', 
            'inactivo', 
            'Inactivo', // Si quieres permitir mayúscula
            'Inicio de Recorridos',
            'En Servicio',
            'En Espera',
            'Fuera de Servicio'
      ],
      default: "inactivo",
    },
    pushSubscription: {
        type: Object, // Guardaremos el objeto JSON que nos da el navegador
        default: null
    },
    // Aquí incluimos los campos específicos según el tipo de usuario
    estudiante: estudianteSchema,
    conductor: conductorSchema,
    administrador: administradorSchema,
    
    // Mongoose maneja la 'fechaRegistro' y 'ultimoAcceso' automáticamente con 'timestamps'
}, {
    timestamps: true // Esto crea automáticamente 'createdAt' (fechaRegistro) y 'updatedAt' (ultimoAcceso)
});

// Exportamos el modelo para que el resto del servidor pueda usarlo
module.exports = mongoose.model('User', userSchema);