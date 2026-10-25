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

    localStorage.removeItem("tecbus_token");
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

      // 3. ¡ÉXITO! El token vive en una cookie HttpOnly; aquí solo
      // guardamos los datos públicos del usuario para la interfaz.
      localStorage.removeItem("tecbus_token");
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
