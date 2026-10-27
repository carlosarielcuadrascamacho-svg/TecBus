// backend/routes/auth.js

const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Importamos nuestro Modelo de Usuario
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { protect } = require('../middleware/authMiddleware');

const googleClient = new OAuth2Client();

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'l2225010051@guasave.tecnm.mx')
    .split(',')
    .map(e => e.trim().toLowerCase());
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
        avatar: user.avatar,
        authProvider: user.authProvider,
    };
}

// --- RUTA DE REGISTRO (POST /api/auth/register) ---
// El registro público manual está deshabilitado para prevenir cuentas falsas sin verificar.
// Todo nuevo usuario debe registrarse mediante Google OAuth con correo 100% verificado.
router.post('/register', async (req, res) => {
    return res.status(403).json({ 
        message: 'Por seguridad del sistema y para garantizar la identidad de los usuarios, el registro se realiza exclusivamente con tu cuenta de Google verificada. Por favor, utiliza el botón "Registrarse con Google".' 
    });
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

        // 5. Devolvemos datos públicos y el token JWT (crucial para clientes sin cookies cross-site como iOS Safari/PWA).
        res.json({
            user: datosPublicos(user),
            token: token
        });

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
        res.json({
            user: datosPublicos(req.user),
            token: token
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error en el servidor.' });
    }
});

// --- RUTA DE LOGIN CON GOOGLE (POST /api/auth/google) ---
router.post('/google', async (req, res) => {
    try {
        const { credential } = req.body;
        if (!credential) {
            return res.status(400).json({ message: 'Credencial de Google no proporcionada.' });
        }

        const webClientId = process.env.GOOGLE_CLIENT_ID || '935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com';
        const androidClientId = process.env.GOOGLE_ANDROID_CLIENT_ID || '935209953046-gthvlevovhlivr97ahg5ihlk9nos61au.apps.googleusercontent.com';
        const playStoreClientId = process.env.GOOGLE_PLAYSTORE_CLIENT_ID || '935209953046-s07jd8rklb50iev8qjk4lcinkcqq3tih.apps.googleusercontent.com';
        const allowedAudiences = [webClientId, androidClientId, playStoreClientId].filter(Boolean);

        // 1. Validar el token con los servidores de Google
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: allowedAudiences,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return res.status(400).json({ message: 'Error validando identidad con Google.' });
        }

        if (!payload.email_verified) {
            return res.status(400).json({ message: 'El correo de Google no está verificado.' });
        }

        const email = String(payload.email).trim().toLowerCase();
        const googleId = payload.sub;
        const nombre = payload.name || payload.given_name || email.split('@')[0];
        const avatar = payload.picture;

        // 2. Determinar privilegios
        const esAdmin = ADMIN_EMAILS.includes(email);
        const esEstudianteTecNM = email.endsWith('@guasave.tecnm.mx');

        // 3. Buscar si el usuario ya existe por googleId o email
        let user = await User.findOne({
            $or: [{ googleId: googleId }, { email: email }]
        });

        if (user) {
            let modificado = false;
            if (!user.googleId) {
                user.googleId = googleId;
                user.authProvider = user.password ? 'both' : 'google';
                modificado = true;
            }
            if (!user.avatar && avatar) {
                user.avatar = avatar;
                modificado = true;
            }
            if (!user.emailVerified) {
                user.emailVerified = true;
                modificado = true;
            }
            // Blindaje del admin: tu correo siempre es y será administrador, y ningún otro puede serlo
            if (esAdmin) {
                if (user.tipo !== 'administrador') {
                    user.tipo = 'administrador';
                    if (!user.administrador) {
                        user.administrador = { nivelAcceso: 'superadmin', permisos: ['all'] };
                    }
                    modificado = true;
                }
            } else if (user.tipo === 'administrador') {
                user.tipo = 'estudiante';
                user.administrador = undefined;
                modificado = true;
            }
            if (modificado) {
                await user.save();
            }
        } else {
            // Usuario nuevo
            const tipoUsuario = esAdmin ? 'administrador' : 'estudiante';

            user = new User({
                nombre: nombre,
                email: email,
                googleId: googleId,
                authProvider: 'google',
                avatar: avatar,
                emailVerified: true,
                tipo: tipoUsuario,
                es_estudiante: esEstudianteTecNM,
                estado: 'activo',
                estudiante: {
                    matricula: esEstudianteTecNM ? email.split('@')[0].toUpperCase() : 'PENDIENTE',
                    carrera: 'PENDIENTE',
                },
                administrador: esAdmin ? { nivelAcceso: 'superadmin', permisos: ['all'] } : undefined
            });
            await user.save();
        }

        // 4. Crear JWT para la sesión en TecBus
        const token = jwt.sign(
            {
                id: user._id,
                tipo: user.tipo,
                tokenVersion: user.tokenVersion ?? 0,
            },
            process.env.JWT_SECRET,
            { expiresIn: '12h' }
        );

        // 5. Configurar cookie HttpOnly
        res.cookie(TOKEN_COOKIE, token, opcionesCookie(req));

        // 6. Devolver datos públicos
        res.json({
            user: datosPublicos(user),
            token: token
        });

    } catch (error) {
        console.error('Error en login con Google:', error);
        res.status(401).json({ message: 'Token de Google inválido o expirado.' });
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