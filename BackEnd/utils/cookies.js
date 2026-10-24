// backend/utils/cookies.js
// Utilidades compartidas para la sesión mediante cookie HttpOnly.

const TOKEN_COOKIE = "tecbus_token";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function parseCookies(cookieHeader = "") {
  const cookies = {};

  for (const part of String(cookieHeader).split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;

    const name = part.slice(0, separator).trim();
    if (!name) continue;

    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }

  return cookies;
}

function getTokenFromCookie(req) {
  const cookies = parseCookies(req.headers?.cookie);
  return cookies[TOKEN_COOKIE] || null;
}

function getBearerToken(req) {
  const header = String(req.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function getTokenFromRequest(req) {
  return getTokenFromCookie(req) || getBearerToken(req);
}

function esConexionSegura(req) {
  return Boolean(
    req.secure ||
      req.headers["x-forwarded-proto"] === "https" ||
      process.env.NODE_ENV === "production"
  );
}

function opcionesCookie(req) {
  const secure = esConexionSegura(req);

  return {
    httpOnly: true,
    secure,
    // El frontend puede vivir en otro dominio (Render). En producción
    // necesitamos SameSite=None; en local HTTP usamos Lax.
    sameSite: secure ? "none" : "lax",
    maxAge: TOKEN_TTL_MS,
    path: "/",
  };
}

function opcionesCookieParaBorrar(req) {
  const { httpOnly, secure, sameSite, path } = opcionesCookie(req);
  return { httpOnly, secure, sameSite, path };
}

module.exports = {
  TOKEN_COOKIE,
  TOKEN_TTL_MS,
  parseCookies,
  getTokenFromCookie,
  getBearerToken,
  getTokenFromRequest,
  opcionesCookie,
  opcionesCookieParaBorrar,
};
