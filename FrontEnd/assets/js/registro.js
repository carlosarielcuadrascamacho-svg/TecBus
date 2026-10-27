// frontend/assets/js/registro.js

async function procesarRegistroGoogle(response) {
  const messageEl = document.getElementById("auth-message");
  if (messageEl) {
    messageEl.textContent = "Conectando con Google...";
    messageEl.className = "text-info mb-2";
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
      messageEl.textContent = `¡Bienvenido, ${data.user.nombre}! Redirigiendo...`;
      messageEl.className = "text-success mb-2";
    }

    setTimeout(() => {
      window.location.href = destino;
    }, 800);
  } catch (error) {
    console.error("Error en Google Sign-In:", error);
    if (messageEl) {
      messageEl.textContent = error.message;
      messageEl.className = "text-danger mb-2";
    }
  }
}

window.handleGoogleCredentialResponse = procesarRegistroGoogle;

document.addEventListener("DOMContentLoaded", () => {
  const registroForm = document.getElementById("registro-form");
  const messageEl = document.getElementById("auth-message");
  const submitButton = registroForm ? registroForm.querySelector('button[type="submit"]') : null;

  // Inicializar Google Sign-In si está disponible el SDK de Google
  function initGoogleAuth() {
    const clientId = window.GOOGLE_CLIENT_ID || "935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com";
    if (window.google && window.google.accounts && clientId) {
      if (window.__gsi_reg_initialized) return;
      window.__gsi_reg_initialized = true;

      if (!document.getElementById("g_id_onload")) {
        try {
          google.accounts.id.initialize({
            client_id: clientId,
            callback: procesarRegistroGoogle,
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
            text: "signup_with",
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

  if (registroForm) {
    registroForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const nombre = document.getElementById("nombre")?.value;
      const correo = document.getElementById("correo")?.value;
      const contrasena = document.getElementById("contrasena")?.value;

      if (messageEl) {
        messageEl.textContent = "";
        messageEl.className = "text-danger mb-2";
      }

      if (!nombre || !correo || !contrasena) {
        if (messageEl) messageEl.textContent = "Todos los campos son obligatorios.";
        return;
      }
      if (!correo.includes("@") || !correo.includes(".")) {
        if (messageEl) messageEl.textContent = "Por favor, usa un correo válido.";
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Registrando...';
      }

      try {
        const response = await fetch(BACKEND_URL + "/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nombre: nombre,
            email: correo,
            password: contrasena,
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.message || "Error al registrarse");
        }

        if (messageEl) {
          messageEl.textContent = `¡Registro exitoso! Serás redirigido...`;
          messageEl.className = "text-success mb-2";
        }

        setTimeout(() => {
          window.location.href = "login.html";
        }, 2000);
      } catch (error) {
        if (messageEl) messageEl.textContent = error.message;
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.innerHTML = '<i class="fas fa-check-circle me-2"></i> Continuar Registro';
        }
      }
    });
  }
});