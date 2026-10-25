// Cliente HTTP común de TecBus.
//
// - Envía cookies HttpOnly en las llamadas a la API.
// - Elimina cabeceras "Bearer null/undefined" que quedaron en el código
//   antiguo mientras se termina la migración.
// - Canjea un token viejo de localStorage por una cookie HttpOnly.
// - Centraliza el cierre de sesión para revocar el JWT en el servidor.

(function () {
  "use strict";

  const LEGACY_TOKEN_KEY = "tecbus_token";
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

  function limpiarHeaders(headers) {
    if (!headers) return headers;

    const normalizados = new Headers(headers);
    const auth = normalizados.get("Authorization");

    // El código anterior guardaba el token en localStorage. Al quitarlo,
    // algunas llamadas siguen enviando "Bearer null"; el backend ya no las
    // necesita porque autentica por cookie.
    if (auth && /^Bearer\s*(null|undefined)?\s*$/i.test(auth)) {
      normalizados.delete("Authorization");
    }

    return normalizados;
  }

  window.fetch = function (input, init) {
    const opciones = Object.assign({}, init || {});

    if (esUrlApi(input) && opciones.credentials === undefined) {
      opciones.credentials = "include";
    }

    if (opciones.headers) {
      opciones.headers = limpiarHeaders(opciones.headers);
    }

    return nativeFetch(input, opciones);
  };

  // Migración transparente: si el navegador todavía tiene el JWT viejo,
  // lo cambiamos por una cookie HttpOnly sin obligar al usuario a relogin.
  let tokenLegacy = null;
  try {
    tokenLegacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  } catch {
    tokenLegacy = null;
  }

  if (tokenLegacy) {
    nativeFetch(obtenerBaseApi() + "/api/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { Authorization: "Bearer " + tokenLegacy },
    })
      .then(async (response) => {
        if (response.ok) {
          try {
            const data = await response.json();
            if (data && data.user) {
              localStorage.setItem(USER_KEY, JSON.stringify(data.user));
            }
          } catch {
            // La cookie ya quedó establecida; el usuario se conserva.
          }

          try {
            localStorage.removeItem(LEGACY_TOKEN_KEY);
          } catch {
            // localStorage puede estar bloqueado; la cookie sigue funcionando.
          }
        } else if (response.status === 401 || response.status === 403) {
          try {
            localStorage.removeItem(LEGACY_TOKEN_KEY);
          } catch {
            // Nada más que hacer.
          }
        }
      })
      .catch(() => {
        // Error de red: conservamos el token viejo para reintentar luego.
      });
  }

  window.cerrarSesionTecBus = async function (opciones = {}) {
    const { userId, estado = "inactivo" } = opciones;

    try {
      if (userId) {
        await window.fetch(
          obtenerBaseApi() + "/api/users/" + encodeURIComponent(userId),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ estado }),
          }
        );
      }
    } catch (error) {
      console.error("No se pudo actualizar el estado del usuario:", error);
    }

    try {
      await window.fetch(obtenerBaseApi() + "/api/auth/logout", {
        method: "POST",
      });
    } catch (error) {
      console.error("No se pudo revocar la sesión en el servidor:", error);
    }

    try {
      localStorage.removeItem(LEGACY_TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      // Si localStorage está bloqueado, igual redirigimos.
    }

    window.location.href = "login.html";
  };
})();
