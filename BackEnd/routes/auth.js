// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Importamos nuestro Modelo de Usuario
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { protect } = require('../middleware/authMiddleware');
const {
    TOKEN_COOKIE,
    opcionesCookie,
    opcionesCookieParaBorrar,
    getTokenFromRequest,
} = require('../utils/cookies');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function datosPublicos(user) {
    return {
        id: user._id,
        nombre: user.nombre,
        email: user.email,
        tipo: user.tipo,
        conductor: user.conductor,
        estudiante: user.estudiante,
        administrador: user.administrador,
    };
}

// --- RUTA DE REGISTRO (POST /api/auth/register) ---
router.post('/register', async (req, res) => {
    try {
        const { nombre, email, password } = req.body;
        const emailNormalizado = String(email || "").trim().toLowerCase();

        // 1. Validar que los datos estén
        if (!nombre || !emailNormalizado || !password) {
            return res.status(400).json({ message: 'Por favor, introduce todos los campos.' });
        }

        if (!EMAIL_REGEX.test(emailNormalizado)) {
            return res.status(400).json({ message: 'El correo electrónico no es válido.' });
        }

        if (String(password).length < 8) {
            return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
        }
        
        // 2. Revisar si el usuario ya existe (basado en tu PDF)
        const userExists = await User.findOne({ email: emailNormalizado })
            .collation({ locale: 'en', strength: 2 });
        if (userExists) {
            return res.status(400).json({ message: 'El correo electrónico ya está registrado.' });
        }

        // 3. Encriptar la contraseña (basado en tu PDF "Hash")
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Crear el nuevo usuario (tipo 'estudiante' por defecto)
        // Usamos el Schema que definimos en tu PDF
        const newUser = new User({
            nombre: nombre,
            email: emailNormalizado,
            password: hashedPassword,
            tipo: 'estudiante', // Por defecto al registrarse
            estudiante: { // Llenamos los datos de estudiante
                matricula: "PENDIENTE", // El admin puede llenar esto después
                carrera: "PENDIENTE"
            }
        });

        // 5. Guardar en la Base de Datos
        const savedUser = await newUser.save();

        // 6. Enviar una respuesta exitosa
        res.status(201).json({ 
            message: '¡Usuario registrado exitosamente!',
            userId: savedUser._id 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- RUTA DE LOGIN (POST /api/auth/login) ---
// (La creamos ahora para tenerla lista)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const emailNormalizado = String(email || "").trim().toLowerCase();

        if (!emailNormalizado || !password) {
            return res.status(400).json({ message: 'Credenciales incorrectas.' });
        }

        // 1. Revisar si el usuario existe. El hash no se selecciona por defecto.
        const user = await User.findOne({ email: emailNormalizado })
            .collation({ locale: 'en', strength: 2 })
            .select('+password');
        if (!user) {
            return res.status(400).json({ message: 'Credenciales incorrectas.' });
        }

        // 2. Comparar la contraseña
        if (!user.password) {
            return res.status(400).json({ message: 'Esta cuenta no tiene contraseña local.' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales incorrectas.' });
        }

        // 3. Crear un Token (JWT) con versión para poder revocar sesiones.
        const token = jwt.sign(
            {
                id: user._id,
                tipo: user.tipo,
                tokenVersion: user.tokenVersion ?? 0,
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // 4. La cookie es HttpOnly: JavaScript no puede leer el token.
        res.cookie(TOKEN_COOKIE, token, opcionesCookie(req));

        // 5. Solo devolvemos los datos públicos del usuario.
        res.json({ user: datosPublicos(user) });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- RUTA DE SESIÓN (POST /api/auth/session) ---
// Canjea un token Bearer antiguo por una cookie HttpOnly. También renueva
// la cookie de una sesión ya autenticada.
router.post('/session', protect, (req, res) => {
    try {
        const token = jwt.sign(
            {
                id: req.user._id,
                tipo: req.user.tipo,
                tokenVersion: req.user.tokenVersion ?? 0,
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        res.cookie(TOKEN_COOKIE, token, opcionesCookie(req));
        res.json({ user: datosPublicos(req.user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- RUTA DE LOGOUT (POST /api/auth/logout) ---
// Incrementa tokenVersion para revocar los JWT emitidos y borra la cookie.
router.post('/logout', async (req, res) => {
    try {
        const token = getTokenFromRequest(req);
        if (token) {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                await User.updateOne(
                    { _id: decoded.id },
                    { $inc: { tokenVersion: 1 } }
                );
            } catch (error) {
                // Token vencido o inválido: igual limpiamos la cookie.
                console.warn('Logout con token inválido:', error.message);
            }
        }
    } catch (error) {
        console.error('Error al revocar la sesión:', error);
    }

    res.clearCookie(TOKEN_COOKIE, opcionesCookieParaBorrar(req));
    res.json({ message: 'Sesión cerrada correctamente.' });
});


module.exports = router;