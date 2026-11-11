// frontend/assets/js/admin_sidebar.js

document.addEventListener("DOMContentLoaded", () => {
  console.log("🎨 Inicializando interfaz del Administrador...");

  // --- 1. REFERENCIAS DOM ---
  const sidebar = document.getElementById("sidebar");
  const menuToggle = document.getElementById("menu-toggle");
  const backdrop = document.getElementById("backdrop");
  const navLinks = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".dashboard-section");
  const pageTitle = document.getElementById("page-title");
  const currentDateEl = document.getElementById("current-date");

  // --- 2. FECHA ACTUAL ---
  try {
    if (currentDateEl) {
      currentDateEl.textContent = new Date().toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    }
  } catch (e) {
    console.error("Error formateando fecha.");
  }

  // --- 3. TOGGLE SIDEBAR (ABRIR/CERRAR) ---
  const toggleSidebar = () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("open");
  };

  if (menuToggle) menuToggle.addEventListener("click", toggleSidebar);
  if (backdrop) backdrop.addEventListener("click", toggleSidebar);

  // --- 4. NAVEGACIÓN ENTRE PESTAÑAS (VISUAL) ---
  function activarSeccion(targetId, link) {
    if (!targetId || !targetId.startsWith("#")) return;
    const targetSection = document.querySelector(targetId);
    if (!targetSection) return;

    navLinks.forEach((nav) => nav.classList.remove("active"));
    if (link) link.classList.add("active");

    sections.forEach((sec) => sec.classList.remove("active"));
    targetSection.classList.add("active");

    if (pageTitle && link) {
      const spanText = link.querySelector("span");
      pageTitle.textContent = spanText ? spanText.textContent.trim() : link.textContent.trim();
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      // Si es el botón de cerrar sesión, manejamos la lógica básica aquí o dejamos que pase
      if (link.textContent.includes("Cerrar Sesión") || link.getAttribute("href") === "#logout") {
         return; // Dejamos que el evento específico de logout lo maneje si es necesario, o lo hacemos aquí.
      }

      e.preventDefault();
      const targetId = link.getAttribute("href");

      // Validar si es un enlace de navegación interna (#)
      if (!targetId || !targetId.startsWith("#")) return;

      activarSeccion(targetId, link);

      if (window.location.hash !== targetId && history.replaceState) {
        history.replaceState(null, "", targetId);
      }

      // D. Cerrar menú automáticamente en móviles
      if (window.innerWidth <= 992 && sidebar.classList.contains("open")) {
        toggleSidebar();
      }
    });
  });

  if (window.location.hash && window.location.hash !== "#logout") {
    const initialLink = Array.from(navLinks).find(
      (l) => l.getAttribute("href") === window.location.hash
    );
    if (initialLink) {
      activarSeccion(window.location.hash, initialLink);
    }
  }

  // --- 5. LOGOUT (NUEVO MODAL) ---
  const btnLogout = Array.from(navLinks).find(l => l.textContent.includes("Cerrar Sesión"));
  if(btnLogout) {
      btnLogout.addEventListener("click", (e) => {
          e.preventDefault();
          // Ocultar el menú lateral en móviles si está abierto
          if (sidebar) sidebar.classList.remove("open");
          if (backdrop) backdrop.classList.remove("open");

          // Mostrar nuestro modal oscuro
          document.getElementById("modal-logout").classList.add("modal-visible");
      });
  }

  // Funciones globales para los botones del HTML
  window.cerrarModalLogout = function() {
      document.getElementById("modal-logout").classList.remove("modal-visible");
  };

  window.ejecutarLogout = async function() {
      const btnSalir = document.querySelector("#modal-logout .btn-danger");
      if (btnSalir) {
          btnSalir.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saliendo...';
          btnSalir.disabled = true;
      }

      let userId = null;
      try {
          const userString = localStorage.getItem("tecbus_user");
          if (userString) {
              const user = JSON.parse(userString);
              userId = user?._id || user?.id || null;
          }
      } catch(err) {
          console.error("Error leyendo el usuario para cerrar sesión", err);
      }

      // Marca inactivo, revoca el JWT en el servidor y borra la cookie.
      await window.cerrarSesionTecBus({ userId });
  };

  // --- 6. CIERRE DE PESTAÑA ---
  // No marcamos al usuario como inactivo en beforeunload: recargar o navegar
  // también dispara ese evento y dejaba estados falsos. El logout explícito
  // sigue marcando inactivo en ejecutarLogout().

});
