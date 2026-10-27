// Cliente HTTP común de TecBus.
//
// - Soporte Dual-Auth (Cookie HttpOnly + Bearer Token en localStorage):
//   Fundamental para iOS Safari, iPadOS y PWAs en WebKit donde Apple ITP (Intelligent Tracking
//   Prevention) bloquea por defecto cookies cross-site entre Render (smartbus-mx vs tecbus-api).
// - Envía automáticamente credentials: "include" y cabecera "Authorization: Bearer <token>"
//   en todas las peticiones dirigidas a la API.
// - Reemplaza o limpia "Bearer null/undefined" de llamadas heredadas.
// - Centraliza el cierre de sesión y revocación en servidor.

(function () {
  "use strict";

  const TOKEN_KEY = "tecbus_token";
  const USER_KEY = "tecbus_user";
  const nativeFetch = window.fetch.bind(window);

  function obtenerBaseApi() {
    return window.BACKEND_URL || "https://tecbus-api.onrender.com";
  }

  function esUrlApi(input) {
    try {
      const raw = typeof input === "string" ? input : input && input.url;
      if (!raw) return false;

      const destino = new URL(raw, window.location.href);
      const base = new URL(obtenerBaseApi(), window.location.href);

      return (
        destino.origin === base.origin ||
        (destino.origin === window.location.origin &&
          destino.pathname.startsWith("/api/"))
      );
    } catch {
      return false;
    }
  }

  function prepararHeaders(headers) {
    const normalizados = new Headers(headers || {});
    const auth = normalizados.get("Authorization");

    let token = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }

    const authEsInvalido = !auth || /^Bearer\s*(null|undefined)?\s*$/i.test(auth);

    if (authEsInvalido) {
      if (token) {
        normalizados.set("Authorization", `Bearer ${token}`);
      } else {
        normalizados.delete("Authorization");
      }
    }

    return normalizados;
  }

  window.fetch = function (input, init) {
    const opciones = Object.assign({}, init || {});

    if (esUrlApi(input)) {
      if (opciones.credentials === undefined) {
        opciones.credentials = "include";
      }
      opciones.headers = prepararHeaders(opciones.headers);
    } else if (opciones.headers) {
      const headers = new Headers(opciones.headers);
      const auth = headers.get("Authorization");
      if (auth && /^Bearer\s*(null|undefined)?\s*$/i.test(auth)) {
        headers.delete("Authorization");
      }
      opciones.headers = headers;
    }

    return nativeFetch(input, opciones);
  };

  // Mantener sesión sincronizada si tenemos token
  let tokenActual = null;
  try {
    tokenActual = localStorage.getItem(TOKEN_KEY);
  } catch {
    tokenActual = null;
  }

  if (tokenActual) {
    nativeFetch(obtenerBaseApi() + "/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: "Bearer " + tokenActual },
    })
      .then(async (response) => {
        if (response.ok) {
          try {
            const data = await response.json();
            if (data && data.user) {
              localStorage.setItem(USER_KEY, JSON.stringify(data.user));
            }
            if (data && data.token) {
              localStorage.setItem(TOKEN_KEY, data.token);
            }
          } catch {
            // No interrumpe navegación si falla parseo
          }
        } else if (response.status === 401 || response.status === 403) {
          try {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
          } catch {
            // Silencioso
          }
        }
      })
      .catch(() => {
        // Error de red: preservamos el token para reintentos posteriores
      });
  }

  window.cerrarSesionTecBus = async function (opciones = {}) {
    const { userId, estado = "inactivo" } = opciones;

    let token = null;
    try {
      token = localStorage.getItem(TOKEN_KEY);
    } catch {
      token = null;
    }

    const authHeader = token ? { Authorization: "Bearer " + token } : {};

    try {
      if (userId) {
        await nativeFetch(
          obtenerBaseApi() + "/api/users/" + encodeURIComponent(userId),
          {
            method: "PUT",
            headers: Object.assign({ "Content-Type": "application/json" }, authHeader),
            credentials: "include",
            body: JSON.stringify({ estado }),
          }
        );
      }
    } catch (error) {
      console.error("No se pudo actualizar el estado del usuario:", error);
    }

    try {
      await nativeFetch(obtenerBaseApi() + "/api/auth/logout", {
        method: "POST",
        credentials: "include",
        headers: authHeader,
      });
    } catch (error) {
      console.error("No se pudo revocar la sesión en el servidor:", error);
    }

    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // Si localStorage está bloqueado, igual redirigimos.
    }

    window.location.href = "login.html";
  };
})();
