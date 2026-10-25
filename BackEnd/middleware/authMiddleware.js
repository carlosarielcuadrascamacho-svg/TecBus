// backend/middleware/authMiddleware.js

const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getTokenFromRequest } = require("../utils/cookies");

const protect = async (req, res, next) => {
  // 1. Prioridad: cookie HttpOnly. Se mantiene Bearer como compatibilidad
  // para scripts/API que todavía lo usen.
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ message: "No autorizado, no hay token" });
  }

  try {
    // 2. Verifica el token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Obtiene el usuario del token (sin la contraseña)
    const user = await User.findById(decoded.id).select("-password");

    // Si el usuario fue eliminado, el token ya no vale
    if (!user) {
      return res
        .status(401)
        .json({ message: "No autorizado, usuario inexistente" });
    }

    // 4. Si el usuario cerró sesión, tokenVersion cambió y el JWT queda revocado.
    if (
      Number(decoded.tokenVersion || 0) !== Number(user.tokenVersion || 0)
    ) {
      return res
        .status(401)
        .json({ message: "Sesión revocada, inicia sesión de nuevo" });
    }

    req.user = user;
    return next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ message: "No autorizado, token falló" });
  }
};

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'l2225010051@guasave.tecnm.mx')
  .split(',')
  .map(e => e.trim().toLowerCase());

// Guardaespaldas específico para Admins con blindaje estricto de identidad
const adminOnly = (req, res, next) => {
  if (
    req.user &&
    req.user.tipo === "administrador" &&
    ADMIN_EMAILS.includes(String(req.user.email || "").trim().toLowerCase())
  ) {
    next(); // ¡Luz verde para el admin autorizado!
  } else {
    res
      .status(403)
      .json({ message: "Acceso denegado. Solo para el administrador oficial autorizado." });
  }
};

module.exports = { protect, adminOnly };
