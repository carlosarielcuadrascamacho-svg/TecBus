// backend/routes/resenas.js

const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const { rateLimit } = require("express-rate-limit");
const router = express.Router();

const Resena = require("../models/Resena");
const Ruta = require("../models/Ruta");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const MIN_COMENTARIO = 10;
const MAX_COMENTARIO = 600;
const RUTA_GENERAL = "Servicio general";

const resenaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  // Limitar por usuario autenticado evita bloquear a todo el campus detrás de la misma IP NAT.
  keyGenerator: (req) => String(req.user?._id || ""),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Demasiadas reseñas en poco tiempo. Intenta de nuevo más tarde.",
  },
});

function hashIp(req) {
  const ip = req.ip || req.socket?.remoteAddress || "";
  const salt =
    process.env.RESENA_IP_SALT || process.env.JWT_SECRET || "tecbus-resenas";
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}

function esUsuarioVerificadoGoogle(user) {
  return Boolean(
    user &&
      (user.googleId ||
        user.authProvider === "google" ||
        user.authProvider === "both")
  );
}

function serializar(resena, { admin = false } = {}) {
  const data = {
    _id: resena._id,
    nombre: resena.nombre,
    avatar: resena.avatar || null,
    rutaId: resena.rutaId || null,
    rutaNombre: resena.rutaNombre || RUTA_GENERAL,
    calificacion: resena.calificacion,
    comentario: resena.comentario,
    visible: resena.visible,
    destacada: resena.destacada,
    verificadoGoogle: Boolean(resena.verificadoGoogle),
    createdAt: resena.createdAt,
    updatedAt: resena.updatedAt,
  };

  if (admin) {
    const usuario = resena.usuarioId;
    data.usuarioId =
      usuario && usuario._id ? String(usuario._id) : usuario || null;
    data.email = usuario && usuario.email ? usuario.email : null;
  }

  return data;
}

function parseRutaId(valor) {
  if (valor === undefined || valor === null || valor === "" || valor === "general") {
    return { ok: true, rutaId: null };
  }
  if (!mongoose.Types.ObjectId.isValid(valor)) {
    return { ok: false };
  }
  return { ok: true, rutaId: valor };
}

// ─── PÚBLICO: listado paginado de reseñas visibles ───
router.get("/", async (req, res) => {
  try {
    const filtro = { visible: true };

    if (req.query.rutaId !== undefined) {
      const parsed = parseRutaId(req.query.rutaId);
      if (!parsed.ok) {
        return res.status(400).json({ message: "La ruta indicada no es válida." });
      }
      filtro.rutaId = parsed.rutaId;
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 9));

    const [items, total] = await Promise.all([
      Resena.find(filtro)
        .sort({ destacada: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Resena.countDocuments(filtro),
    ]);

    res.json({
      items: items.map((r) => serializar(r)),
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
    });
  } catch (error) {
    console.error("Error al listar reseñas:", error);
    res.status(500).json({ message: "No se pudieron cargar las reseñas." });
  }
});

// ─── PÚBLICO: promedio, distribución y desglose por ruta ───
router.get("/resumen", async (req, res) => {
  try {
    const [total, promedioAgg, distribucionAgg, porRuta] = await Promise.all([
      Resena.countDocuments({ visible: true }),
      Resena.aggregate([
        { $match: { visible: true } },
        { $group: { _id: null, promedio: { $avg: "$calificacion" } } },
      ]),
      Resena.aggregate([
        { $match: { visible: true } },
        { $group: { _id: "$calificacion", total: { $sum: 1 } } },
      ]),
      Resena.aggregate([
        { $match: { visible: true } },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: "$rutaId",
            rutaNombre: { $first: "$rutaNombre" },
            total: { $sum: 1 },
            promedio: { $avg: "$calificacion" },
          },
        },
        { $sort: { total: -1, _id: 1 } },
      ]),
    ]);

    const rutaIds = porRuta.map((r) => r._id).filter(Boolean);
    const rutasActuales = rutaIds.length
      ? await Ruta.find({ _id: { $in: rutaIds } })
          .select("nombre")
          .lean()
      : [];
    const nombresPorId = new Map(
      rutasActuales.map((r) => [String(r._id), r.nombre])
    );

    const distribucion = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    distribucionAgg.forEach((d) => {
      if (distribucion[d._id] !== undefined) distribucion[d._id] = d.total;
    });

    const promedio = promedioAgg[0]?.promedio || 0;

    res.json({
      total,
      promedio: Number(promedio.toFixed(2)),
      distribucion,
      rutas: porRuta.map((r) => ({
        rutaId: r._id || null,
        rutaNombre:
          (r._id ? nombresPorId.get(String(r._id)) : null) ||
          r.rutaNombre ||
          RUTA_GENERAL,
        total: r.total,
        promedio: Number(r.promedio.toFixed(2)),
      })),
    });
  } catch (error) {
    console.error("Error al calcular el resumen de reseñas:", error);
    res.status(500).json({ message: "No se pudo cargar el resumen de reseñas." });
  }
});

// ─── PRIVADO: reseñas del usuario autenticado ───
router.get("/mia", protect, async (req, res) => {
  try {
    const filtro = { usuarioId: req.user._id };

    if (req.query.rutaId !== undefined) {
      const parsed = parseRutaId(req.query.rutaId);
      if (!parsed.ok) {
        return res.status(400).json({ message: "La ruta indicada no es válida." });
      }
      filtro.rutaId = parsed.rutaId;
    }

    const items = await Resena.find(filtro)
      .sort({ updatedAt: -1 })
      .lean();

    res.json({ items: items.map((r) => serializar(r)) });
  } catch (error) {
    console.error("Error al cargar las reseñas del usuario:", error);
    res.status(500).json({ message: "No se pudieron cargar tus reseñas." });
  }
});

// ─── PRIVADO: crear o actualizar la reseña del usuario ───
router.post("/", protect, resenaLimiter, async (req, res) => {
  try {
    const calificacion = Number(req.body.calificacion);
    if (!Number.isInteger(calificacion) || calificacion < 1 || calificacion > 5) {
      return res
        .status(400)
        .json({ message: "La calificación debe ser un entero entre 1 y 5." });
    }

    const comentario = String(req.body.comentario || "").trim();
    if (comentario.length < MIN_COMENTARIO) {
      return res.status(400).json({
        message: `El comentario debe tener al menos ${MIN_COMENTARIO} caracteres.`,
      });
    }
    if (comentario.length > MAX_COMENTARIO) {
      return res.status(400).json({
        message: `El comentario no puede superar los ${MAX_COMENTARIO} caracteres.`,
      });
    }

    const parsed = parseRutaId(req.body.rutaId);
    if (!parsed.ok) {
      return res.status(400).json({ message: "La ruta indicada no es válida." });
    }

    let rutaNombre = "";
    if (parsed.rutaId) {
      const ruta = await Ruta.findById(parsed.rutaId).select("nombre").lean();
      if (!ruta) {
        return res.status(404).json({ message: "La ruta seleccionada no existe." });
      }
      rutaNombre = String(ruta.nombre || "").slice(0, 120);
    }

    const filtro = { usuarioId: req.user._id, rutaId: parsed.rutaId };
    const existente = await Resena.findOne(filtro).select("_id").lean();
    const nombreAutor =
      String(req.user.nombre || "").trim().slice(0, 80) || "Pasajero";

    const resena = await Resena.findOneAndUpdate(
      filtro,
      {
        $set: {
          nombre: nombreAutor,
          avatar: String(req.user.avatar || "").slice(0, 500),
          rutaNombre,
          calificacion,
          comentario,
          verificadoGoogle: esUsuarioVerificadoGoogle(req.user),
          ipHash: hashIp(req),
        },
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    const mensaje = !existente
      ? "¡Gracias por compartir tu experiencia!"
      : resena.visible
        ? "Tu reseña se actualizó correctamente."
        : "Tu reseña se actualizó, aunque permanece oculta por moderación.";

    res.status(existente ? 200 : 201).json({
      message: mensaje,
      resena: serializar(resena),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({
        message: "Ya existe una reseña tuya para esta ruta. Intenta actualizarla.",
      });
    }
    console.error("Error al guardar la reseña:", error);
    res.status(500).json({ message: "No se pudo guardar la reseña." });
  }
});

// ─── ADMIN: listado completo con filtros ───
router.get("/admin", protect, adminOnly, async (req, res) => {
  try {
    const estado = String(req.query.estado || "todas");
    const filtro = {};

    if (estado === "visibles") filtro.visible = true;
    else if (estado === "ocultas") filtro.visible = false;
    else if (estado === "destacadas") filtro.destacada = true;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const [items, total] = await Promise.all([
      Resena.find(filtro)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("usuarioId", "nombre email avatar")
        .lean(),
      Resena.countDocuments(filtro),
    ]);

    res.json({
      items: items.map((r) => serializar(r, { admin: true })),
      total,
      page,
      pages: Math.ceil(total / limit) || 0,
    });
  } catch (error) {
    console.error("Error al listar reseñas para el admin:", error);
    res.status(500).json({ message: "No se pudieron cargar las reseñas." });
  }
});

// ─── ADMIN: contadores para el panel ───
router.get("/admin/resumen", protect, adminOnly, async (req, res) => {
  try {
    const [total, visibles, ocultas, destacadas, promedioAgg] =
      await Promise.all([
        Resena.countDocuments({}),
        Resena.countDocuments({ visible: true }),
        Resena.countDocuments({ visible: false }),
        Resena.countDocuments({ visible: true, destacada: true }),
        Resena.aggregate([
          { $match: { visible: true } },
          { $group: { _id: null, promedio: { $avg: "$calificacion" } } },
        ]),
      ]);

    const promedio = promedioAgg[0]?.promedio || 0;

    res.json({
      total,
      visibles,
      ocultas,
      destacadas,
      promedio: Number(promedio.toFixed(2)),
    });
  } catch (error) {
    console.error("Error al calcular el resumen admin de reseñas:", error);
    res.status(500).json({ message: "No se pudo cargar el resumen de reseñas." });
  }
});

// ─── ADMIN: ocultar / mostrar / destacar ───
router.patch("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Identificador de reseña inválido." });
    }

    const cambios = {};
    if (typeof req.body.visible === "boolean") cambios.visible = req.body.visible;
    if (typeof req.body.destacada === "boolean") {
      cambios.destacada = req.body.destacada;
    }

    if (Object.keys(cambios).length === 0) {
      return res
        .status(400)
        .json({ message: "No se recibieron cambios válidos para la reseña." });
    }

    const resena = await Resena.findByIdAndUpdate(req.params.id, cambios, {
      new: true,
      runValidators: true,
    }).populate("usuarioId", "nombre email avatar");

    if (!resena) {
      return res.status(404).json({ message: "La reseña no existe." });
    }

    res.json({
      message: "Reseña actualizada.",
      resena: serializar(resena, { admin: true }),
    });
  } catch (error) {
    console.error("Error al actualizar la reseña:", error);
    res.status(500).json({ message: "No se pudo actualizar la reseña." });
  }
});

// ─── ADMIN: eliminar definitivamente ───
router.delete("/:id", protect, adminOnly, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Identificador de reseña inválido." });
    }

    const resena = await Resena.findByIdAndDelete(req.params.id);
    if (!resena) {
      return res.status(404).json({ message: "La reseña no existe." });
    }

    res.json({ message: "Reseña eliminada." });
  } catch (error) {
    console.error("Error al eliminar la reseña:", error);
    res.status(500).json({ message: "No se pudo eliminar la reseña." });
  }
});

module.exports = router;
