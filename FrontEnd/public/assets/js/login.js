// frontend/assets/js/login.js

async function procesarInicioSesionGoogle(response) {
  const messageEl = document.getElementById("auth-message");
  if (messageEl) {
    messageEl.textContent = "Verificando cuenta con Google...";
    messageEl.className = "text-info mb-3";
  }

  try {
    const res = await fetch(BACKEND_URL + "/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: response.credential }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || "Error al autenticar con Google");
    }

    if (data.token) {
      localStorage.setItem("tecbus_token", data.token);
    }
    localStorage.setItem("tecbus_user", JSON.stringify(data.user));

    const paneles = {
      estudiante: "pasajero.html",
      conductor: "conductor.html",
      administrador: "admin.html",
      usuario: "pasajero.html",
    };

    const destino = paneles[data.user.tipo] || "pasajero.html";

    if (messageEl) {
      messageEl.textContent = `¡Hola, ${data.user.nombre}! Redirigiendo...`;
      messageEl.className = "text-success mb-3";
    }

    setTimeout(() => {
      window.location.href = destino;
    }, 800);
  } catch (error) {
    console.error("Error en Google Sign-In:", error);
    if (messageEl) {
      messageEl.textContent = error.message;
      messageEl.className = "text-danger mb-3";
    }
  }
}

window.handleGoogleCredentialResponse = procesarInicioSesionGoogle;

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("login-form");
  const messageEl = document.getElementById("auth-message");
  const submitButton = loginForm ? loginForm.querySelector('button[type="submit"]') : null;

  // Inicializar Google Sign-In si está disponible el SDK de Google
  function initGoogleAuth() {
    const isNative = typeof window.Capacitor !== "undefined" && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform();

    if (isNative) {
      if (window.__google_native_initialized) return;
      window.__google_native_initialized = true;

      const gOnload = document.getElementById("g_id_onload");
      if (gOnload) gOnload.remove();
      const gSignin = document.querySelector(".g_id_signin");
      if (gSignin) gSignin.remove();

      const container = document.getElementById("google-btn-container");
      if (container) {
        container.innerHTML = `
          <button type="button" id="btn-google-native" class="btn w-100 py-2 d-flex align-items-center justify-content-center gap-2 rounded-pill shadow-sm" style="background: #131314; border: 1px solid #3c4043; color: #e3e3e3; font-weight: 500; font-size: 14px; min-width: 280px; max-width: 320px; transition: all 0.2s ease;">
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            <span>Continuar con Google</span>
          </button>
        `;
        const nativeBtn = document.getElementById("btn-google-native");
        if (nativeBtn) {
          nativeBtn.addEventListener("click", iniciarSesionGoogleNativo);
        }
      }
      return;
    }

    const clientId = window.GOOGLE_CLIENT_ID || "935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com";
    if (window.google && window.google.accounts && clientId) {
      if (window.__gsi_login_initialized) return;
      window.__gsi_login_initialized = true;

      if (!document.getElementById("g_id_onload")) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: procesarInicioSesionGoogle,
            auto_select: false,
          });
        } catch (err) {
          console.warn("Google Sign-In init error:", err);
        }
      }

      const container = document.getElementById("google-btn-container");
      const existingBtn = document.querySelector(".g_id_signin iframe, #google-btn-container iframe");
      if (container && !existingBtn && !document.querySelector(".g_id_signin")) {
        try {
          google.accounts.id.renderButton(container, {
            theme: "filled_black",
            size: "large",
            type: "standard",
            shape: "pill",
            text: "continue_with",
            logo_alignment: "left",
            width: 320,
          });
        } catch (err) {
          console.warn("Google renderButton error:", err);
        }
      }
    } else {
      setTimeout(initGoogleAuth, 300);
    }
  }

  async function iniciarSesionGoogleNativo() {
    const messageEl = document.getElementById("auth-message");
    if (messageEl) {
      messageEl.textContent = "Conectando con Google...";
      messageEl.className = "text-info mb-3";
    }

    try {
      if (!window.SocialLogin) {
        throw new Error("El servicio de inicio de sesión nativo no está disponible.");
      }

      const clientId = window.GOOGLE_CLIENT_ID || "935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com";
      await window.SocialLogin.initialize({
        google: {
          webClientId: clientId,
          mode: 'online',
        },
      });

      const res = await window.SocialLogin.login({
        provider: 'google',
        options: {},
      });

      const token = res?.result?.idToken || res?.idToken;
      if (!token) {
        throw new Error("No se pudo obtener la credencial de Google.");
      }

      await procesarInicioSesionGoogle({ credential: token });
    } catch (err) {
      console.error("Error en Google Nativo:", err);
      const isCancel = err?.code === 'USER_CANCELLED' || String(err?.message || err).toLowerCase().includes('cancel');
      if (isCancel) {
        if (messageEl) {
          messageEl.textContent = "Inicio de sesión cancelado.";
          messageEl.className = "text-muted mb-3";
        }
      } else {
        if (messageEl) {
          messageEl.textContent = err?.message || "Error al iniciar sesión con Google.";
          messageEl.className = "text-danger mb-3";
        }
      }
    }
  }
  initGoogleAuth();

  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
    e.preventDefault(); // Evita que la página se recargue

    const correo = document.getElementById("correo").value;
    const contrasena = document.getElementById("contrasena").value;

    if (messageEl) {
      messageEl.textContent = ""; // Limpia errores anteriores
    }

    // 2. Llamada al Backend
    submitButton.disabled = true;
    submitButton.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Ingresando...';

    try {
      const response = await fetch(BACKEND_URL + "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: correo,
          password: contrasena,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        // Si la respuesta no es 200, muestra el error del backend
        throw new Error(data.message);
      }

      // 3. ¡ÉXITO! Guardamos perfil y token (dual-auth para compatibilidad con iOS Safari/PWA)
      if (data.token) {
        localStorage.setItem("tecbus_token", data.token);
      }
      localStorage.setItem("tecbus_user", JSON.stringify(data.user));

      // 4. Redirección por Rol (¡La parte más importante!)
      // Leemos el 'tipo' de usuario que nos devolvió el backend
      // (Esto se basa en tu diseño de DB: "estudiante", "conductor", "administrador")

      const paneles = {
        estudiante: "pasajero.html",
        conductor: "conductor.html",
        administrador: "admin.html",
      };

      const destino = paneles[data.user.tipo];

      if (!destino) {
        if (messageEl) {
          messageEl.textContent = `Tu cuenta tiene el rol "${
            data.user.tipo || "sin rol"
          }" y no tiene un panel asignado. Contacta al administrador.`;
          messageEl.className = "text-danger mb-3";
        }
        submitButton.disabled = false;
        submitButton.innerHTML =
          '<i class="fas fa-sign-in-alt me-2"></i> Ingresar';
        return;
      }

      if (messageEl) {
        messageEl.textContent = "¡Éxito! Redirigiendo...";
        messageEl.className = "text-success mb-3"; // Color verde
      }

      setTimeout(() => {
        window.location.href = destino;
      }, 1000); // Pequeña espera para que el usuario vea el mensaje
    } catch (error) {
      // 4. Error (ej. "Credenciales incorrectas")
      if (messageEl) {
        messageEl.textContent = error.message;
      }
      submitButton.disabled = false;
      submitButton.innerHTML =
        '<i class="fas fa-sign-in-alt me-2"></i> Ingresar';
    }
  });
  }
});
