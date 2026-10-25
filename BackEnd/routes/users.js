// backend/routes/users.js

const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const Camion = require("../models/Camion");
const Horario = require("../models/Horario");
const bcrypt = require("bcryptjs");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { diasBusquedaHoy } = require("../utils/dias");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'l2225010051@guasave.tecnm.mx')
  .split(',')
  .map(e => e.trim().toLowerCase());

function usuarioPublico(user) {
  const objeto = user.toObject ? user.toObject() : { ...user };
  delete objeto.password;
  return objeto;
}

// --- RUTA 1: Obtener TODOS los usuarios (para la tabla del admin) ---
// GET /api/users
router.get("/", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}).select("-password"); // Trae todos menos el password
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 2: Registrar un NUEVO usuario (desde el panel de admin) ---
// POST /api/users
router.post("/", protect, adminOnly, async (req, res) => {
  try {
    const { nombre, email, password, tipo, licencia, matricula, carrera } =
      req.body;
    const emailNormalizado = String(email || "").trim().toLowerCase();

    if (!nombre || !emailNormalizado || !password || !tipo) {
      return res.status(400).json({ message: "nombre, email, password y tipo son requeridos" });
    }

    if (!EMAIL_REGEX.test(emailNormalizado)) {
      return res.status(400).json({ message: "El correo electrónico no es válido." });
    }

    if (String(password).length < 8) {
      return res.status(400).json({ message: "La contraseña debe tener al menos 8 caracteres." });
    }

    const rolesValidos = ["estudiante", "conductor", "administrador", "usuario"];
    if (!rolesValidos.includes(tipo)) {
      return res.status(400).json({ message: "Rol no válido." });
    }

    if (tipo === "administrador" && !ADMIN_EMAILS.includes(emailNormalizado)) {
      return res.status(403).json({ message: "Por seguridad, solo el correo del superadministrador oficial puede tener rol de administrador." });
    }

    const userExists = await User.findOne({ email: emailNormalizado });
    if (userExists) {
      return res.status(400).json({ message: "El correo ya está registrado" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      nombre,
      email: emailNormalizado,
      password: hashedPassword,
      tipo,
    });

    // Añade el sub-documento correcto basado en el tipo
    if (tipo === "estudiante") {
      newUser.estudiante = { matricula, carrera };
    } else if (tipo === "conductor") {
      newUser.conductor = { licencia }; // El camión se asigna después
    }

    const savedUser = await newUser.save();
    res.status(201).json(usuarioPublico(savedUser));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

router.get("/mi-camion", protect, async (req, res) => {
  try {
    // 1. Primero buscamos si tiene asignación fija en su perfil
    const user = await User.findById(req.user._id).populate("conductor.vehiculoAsignado");

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    let camion = user.conductor ? user.conductor.vehiculoAsignado : null;

    // 2. Si NO tiene camión fijo, buscamos en los horarios de HOY
    if (!camion) {
        console.log(`[DEBUG] Conductor ${user.nombre} sin vehículo fijo. Buscando en horarios...`);
        
        // Calcular el día actual en la zona horaria de Guasave.
        const diasBusqueda = diasBusquedaHoy();

        // La asignación vive dentro de salidas[], no en la raíz del horario.
        const horariosHoy = await Horario.find({
            "salidas": { $elemMatch: { conductorAsignado: user._id } },
            diaSemana: { $in: diasBusqueda }
        }).populate("salidas.camionAsignado");

        const salidasHoy = horariosHoy.flatMap((horario) => horario.salidas || []);
        const salidaHoy = salidasHoy.find(
            (salida) => salida.conductorAsignado?.toString() === user._id.toString()
                && salida.camionAsignado
        );

        if (salidaHoy && salidaHoy.camionAsignado) {
            camion = salidaHoy.camionAsignado;
            console.log(`[DEBUG] ¡Camión encontrado por horario! Unidad: ${camion.numeroUnidad}`);
        }
    }

    // 3. Respuesta Final
    if (!camion || !camion.numeroUnidad) {
       // Si de plano no tiene ni fijo ni horario
       return res.json({
         camionId: null,
         placa: "",
         numeroUnidad: ""
       });
    }

    // ¡ÉXITO! Devolvemos los datos del camión encontrado
    res.json({
      camionId: camion._id,
      placa: camion.placa,
      numeroUnidad: camion.numeroUnidad,
      ubicacionActual: camion.ubicacionActual
    });

  } catch (error) {
    console.error("Error al buscar camión:", error);
    res.status(500).json({ message: "Error interno del servidor" });
  }
});

// --- RUTA 3: Actualizar un USUARIO (¡La más importante!) ---
// PUT /api/users/:id
router.put("/:id", protect, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "ID de usuario inválido" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    const esAdmin = req.user.tipo === "administrador";
    const esMismoUsuario = req.user._id.toString() === req.params.id;

    if (!esAdmin && !esMismoUsuario) {
        return res.status(401).json({ message: "No autorizado para editar este usuario" });
    }

    const {
      nombre,
      email,
      tipo,
      estado,
      licencia,
      matricula,
      vehiculoAsignado,
    } = req.body;

    // Solo un administrador puede cambiar el rol o el correo de una cuenta.
    // (Sin esto, cualquier usuario se auto-asignaba "administrador" en el body)
    if (!esAdmin) {
      if (tipo && tipo !== user.tipo) {
        return res.status(403).json({ message: "Solo un administrador puede cambiar el rol de un usuario." });
      }
      if (email && String(email).trim().toLowerCase() !== user.email) {
        return res.status(403).json({ message: "Solo un administrador puede cambiar el correo de una cuenta." });
      }
    }

    const rolesValidos = ["estudiante", "conductor", "administrador", "usuario"];
    if (tipo && !rolesValidos.includes(tipo)) {
      return res.status(400).json({ message: "Rol no válido." });
    }

    if (tipo === "administrador" && !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res.status(403).json({ message: "Por seguridad, solo el correo del superadministrador oficial puede tener rol de administrador." });
    }

    const estadosValidos = [
      "activo", "inactivo", "Inactivo", "Inicio de Recorridos",
      "En Servicio", "En Espera", "Fuera de Servicio",
    ];
    if (estado && !estadosValidos.includes(estado)) {
      return res.status(400).json({ message: "Estado no válido." });
    }

    if (email) {
      const emailNormalizado = String(email).trim().toLowerCase();
      if (!EMAIL_REGEX.test(emailNormalizado)) {
        return res.status(400).json({ message: "El correo electrónico no es válido." });
      }
      if (emailNormalizado !== user.email) {
        const existe = await User.findOne({ email: emailNormalizado, _id: { $ne: user._id } });
        if (existe) return res.status(400).json({ message: "El correo ya está registrado" });
        user.email = emailNormalizado;
      }
    }

    // Actualiza campos comunes
    user.nombre = nombre || user.nombre;
    user.tipo = tipo || user.tipo;
    user.estado = estado || user.estado;

    // Lógica de roles (esto borra los datos viejos si cambia de rol)
    if (tipo === "conductor") {
      user.estudiante = undefined; // Borra datos de estudiante
      user.conductor = {
        licencia: licencia || user.conductor?.licencia,
        // ¡AQUÍ ESTÁ LA MAGIA! Asigna el camión
        vehiculoAsignado: vehiculoAsignado || user.conductor?.vehiculoAsignado,
      };
    } else if (tipo === "estudiante") {
      user.conductor = undefined; // Borra datos de conductor
      user.estudiante = {
        matricula: matricula || user.estudiante?.matricula,
        carrera: req.body.carrera || user.estudiante?.carrera,
      };
    }

    const updatedUser = await user.save();
    res.json(usuarioPublico(updatedUser));
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA 4: Obtener TODOS los conductores (La que ya teníamos) ---
router.get("/conductores", protect, adminOnly, async (req, res) => {
  try {
    const conductores = await User.find({ tipo: "conductor" }).select("nombre");
    res.json(conductores);
  } catch (error) {
    res.status(500).json({ message: "Error del servidor" });
  }
});

// --- RUTA: Eliminar Usuario ---
// DELETE /api/users/:id
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "ID de usuario inválido" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "Usuario no encontrado" });
    }

    // Evitar que el admin oficial sea eliminado
    if (ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      return res
        .status(403)
        .json({
          message: "La cuenta del superadministrador oficial está blindada y no puede ser eliminada.",
        });
    }

    // Evitar que el admin se borre a sí mismo por error
    if (req.user._id.equals(user._id)) {
      return res
        .status(400)
        .json({
          message: "No puedes eliminar tu propia cuenta de administrador",
        });
    }

    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Usuario eliminado correctamente" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error al eliminar el usuario" });
  }
});

module.exports = router;
