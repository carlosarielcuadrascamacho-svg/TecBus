// frontend/assets/js/admin_dashboard.js

document.addEventListener("DOMContentLoaded", () => {
  // --- 1. VERIFICACIÓN DE SEGURIDAD ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");
  if (!token || !userString) {
    window.location.href = "login.html";
    return;
  }
  const user = JSON.parse(userString);
  if (user.tipo !== "administrador") {
    alert("Acceso denegado.");
    window.location.href = "login.html";
    return;
  }

  // Activar usuario al entrar (Lógica de V2)
  if (user && user.id) {
    fetch(`${BACKEND_URL}/api/users/${user.id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ estado: "activo" }),
    }).catch((err) => console.log("Error activando usuario al inicio", err));
  }

  // --- MOSTRAR FECHA ACTUAL (Recuperado de V1) ---
  const currentDateEl = document.getElementById("current-date");
  if (currentDateEl) {
    currentDateEl.textContent = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  // --- Variables Globales de Datos ---
  let camionesCargados = [];
  let rutasCargadas = [];
  let usuariosCargados = [];
  let horariosCargados = [];
  let alertasCargadas = [];
  let busMarkers = {};
  let alertCount = 0;

  // --- Configuración Inicial ---
  // Lugares clave para el buscador
  const LUGARES_CLAVE = [
    {
      nombre: "Instituto Tecnológico Superior de Guasave (TEC)",
      lat: 25.523708,
      lon: -108.382035,
      tipo: "escuela",
    },
    {
      nombre: "Central Camionera Regional de Guasave",
      lat: 25.570119,
      lon: -108.473013,
      tipo: "estacion",
    },
    { nombre: "Rochin", lat: 25.579152, lon: -108.462641, tipo: "tienda" },
  ];

  // Conexión Socket
  const socket = io(SOCKET_URL);
  socket.on("connect", () =>
    console.log("🔌 Admin Dashboard conectado a Socket.io:", socket.id)
  );

  // ============================================================
  //  DETECTOR DE CAMBIO DE PESTAÑA (Sincronización con Sidebar)
  // ============================================================
  const navLinks = document.querySelectorAll(".nav-item");
  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const targetId = link.getAttribute("href");

      // Si es cerrar sesión, ejecutamos logout (Por si acaso está aquí el botón)
      if (
        link.id === "btn-cerrar-sesion" ||
        link.classList.contains("logout-item")
      ) {
        return; // La lógica de logout se maneja aparte o en sidebar.js
      }

      // Cargar datos según la sección que el usuario eligió
      if (targetId === "#mapa") {
          inicializarDashboard();
          if (window.adminMap) setTimeout(() => window.adminMap.resize(), 550);
      }
      if (targetId === "#usuarios") cargarUsuarios();
      if (targetId === "#camiones") cargarCamiones();
      if (targetId === "#rutas") cargarRutas();
      if (targetId === "#horarios") {
        cargarHorarios();
        popularDropdownsHorarios();
      }
      if (targetId === "#alertas") cargarAlertas();
      if (targetId === "#taquilla") { cargarTarifas(); inicializarTaquillaRutas(); }
    });
  });

  // ============================================================
  //  MANEJO DE SIDEBAR COLAPSABLE
  // ============================================================
  const btnToggleMini = document.getElementById("sidebar-toggle-mini");
  const adminLayout = document.querySelector(".admin-layout");

  if (btnToggleMini && adminLayout) {
      btnToggleMini.addEventListener("click", () => {
          adminLayout.classList.toggle("sidebar-collapsed");
          
          // Forzar resize del mapa después de la transición (550ms)
          setTimeout(() => {
              if (window.adminMap) {
                  window.adminMap.resize();
              }
          }, 550);
      });
  }

  // ============================================================
  //  4. SISTEMA DE PESTAÑAS (TABS)
  // ============================================================
  const tabButtons = document.querySelectorAll(".btn-tab");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = btn.getAttribute("data-tab");
      const section = btn.closest(".dashboard-section");
      if (!section) return;

      // Desactivar otros botones de la misma sección
      section
        .querySelectorAll(".btn-tab")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Desactivar otros contenidos
      section
        .querySelectorAll(".tab-content")
        .forEach((c) => c.classList.remove("active"));
      const targetContent = document.getElementById(tabId);
      if (targetContent) targetContent.classList.add("active");

      // Acciones especiales según el tab
      if (tabId === "tab-horarios-timeline") {
        renderTimeline();
      }
    });
  });

  // --- LÓGICA DE NAVEGACIÓN TIMELINE ---
  let currentTimelineDay = "Lunes";
  const daysList = [
    "Lunes",
    "Martes",
    "Miércoles",
    "Jueves",
    "Viernes",
    "Sábado",
    "Domingo",
    "Lunes-Viernes",
    "Diario",
  ];

  document.getElementById("btn-prev-day")?.addEventListener("click", () => {
    let idx = daysList.indexOf(currentTimelineDay);
    idx = (idx - 1 + daysList.length) % daysList.length;
    currentTimelineDay = daysList[idx];
    document.getElementById("timeline-current-day").textContent =
      currentTimelineDay;
    renderTimeline();
  });

  document.getElementById("btn-next-day")?.addEventListener("click", () => {
    let idx = daysList.indexOf(currentTimelineDay);
    idx = (idx + 1) % daysList.length;
    currentTimelineDay = daysList[idx];
    document.getElementById("timeline-current-day").textContent =
      currentTimelineDay;
    renderTimeline();
  });

  // ============================================================
  //  LÓGICA DE BÚSQUEDA EN VIVO (LIVE SEARCH)
  // ============================================================
  function setupLiveSearch(inputId, getLatestData, renderFunc, filterFields) {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.addEventListener("input", (e) => {
          const dataArray = getLatestData();
          const term = e.target.value.toLowerCase().trim();
          if (!term) { renderFunc(dataArray); return; }
          const filtered = dataArray.filter(item => filterFields.some(field => {
              // Soporte para campos anidados (ej: 'ruta.nombre')
              const val = field.split('.').reduce((obj, key) => (obj && obj[key] !== undefined) ? obj[key] : undefined, item);
              return val && String(val).toLowerCase().includes(term);
          }));
          renderFunc(filtered);
      });
  }

  setupLiveSearch("live-search-user", () => usuariosCargados, renderTablaUsuarios, ["nombre", "email", "tipo"]);
  setupLiveSearch("live-search-camion", () => camionesCargados, renderTablaCamiones, ["numeroUnidad", "placa", "modelo"]);
  setupLiveSearch("live-search-ruta", () => rutasCargadas, renderTablaRutas, ["nombre", "descripcion"]);
  setupLiveSearch("live-search-horario", () => horariosCargados, renderTablaHorarios, ["rutaNombre", "camionUnidad", "conductorNombre", "diaSemana", "hora"]);
  setupLiveSearch("live-search-alerta", () => alertasCargadas, renderTablaAlertas, ["titulo", "mensaje", "tipo"]);

  // Carga inicial por defecto (Mapa y KPIs)
  // SE MOVIÓ ABAJO, DESPUÉS DE INICIALIZAR EL MAPA
  // inicializarDashboard();

  // ============================================================
  //  3. LÓGICA DEL MAPA
  // ============================================================
  const initialLat = 25.567,
    initialLng = -108.473,
    initialZoom = 13;
    
  const map = new maplibregl.Map({
    container: 'admin-map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [initialLng, initialLat],
    zoom: initialZoom,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  // Función para asegurar que el mapa siempre tenga el tamaño correcto
  function observeMapResize(mapInstance, containerId) {
    const container = document.getElementById(containerId);
    if (!container || !mapInstance) return;
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(() => {
        if (mapInstance) mapInstance.resize();
      });
    });
    observer.observe(container);
  }

  window.adminMap = map;
  observeMapResize(map, 'admin-map');

  // AHORA SÍ CARGAMOS LOS DATOS, YA QUE EL MAPA ESTÁ LISTO
  inicializarDashboard();

  // Auto-resize del mapa cuando termina la animación fadeIn al mostrar la sección
  const mapaSection = document.getElementById("mapa");
  if (mapaSection) {
      mapaSection.addEventListener("animationend", () => {
          if (window.adminMap) {
              window.adminMap.resize();
          }
      });
  }

  function createBusElement() {
    const el = document.createElement('div');
    el.className = "custom-bus-icon";
    el.innerHTML = `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; color: white; border: 2px solid white; font-size: 14px; box-shadow: 0 0 10px var(--color-primario);"><i class="fas fa-bus"></i></div>`;
    return el;
  }

  function createAlertElement() {
    const el = document.createElement('div');
    el.className = "custom-bus-icon-alert";
    el.innerHTML = `<div style="background-color:var(--color-error); border-radius: 50%; width: 35px; height: 35px; display: flex; justify-content: center; align-items: center; color: white; border: 3px solid white; font-size: 16px; animation: pulse 1.5s infinite; box-shadow: 0 0 15px var(--color-error);"><i class="fas fa-bus"></i></div>`;
    return el;
  }

  // --- OVERRIDE ALERT Y CONFIRM NATIVOS ---
  window.alert = function(message) {
    if (!message) return;
    const isError = message.toLowerCase().includes('error');
    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: isError ? 'error' : 'success',
      title: message.replace(/✅|❌/g, '').trim(),
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true
    });
  };

  window.confirmAsync = async function(mensaje) {
    const result = await Swal.fire({
      title: mensaje,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#e74c3c',
      cancelButtonColor: '#95a5a6',
      confirmButtonText: 'Sí, continuar',
      cancelButtonText: 'Cancelar'
    });
    return result.isConfirmed;
  };

  // --- FUNCIÓN PRINCIPAL DASHBOARD (KPIs y Mapa) ---
  async function inicializarDashboard() {
    console.log("🔄 Cargando datos del dashboard...");
    
    // Forzar resize del mapa para evitar distorsión
    if (window.adminMap) {
        setTimeout(() => window.adminMap.resize(), 100);
    }

    // 1. Camiones (Lo usaremos para el KPI de Total)
    try {
      const res = await fetch(BACKEND_URL + "/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const camiones = await res.json();
        camionesCargados = camiones;

        // Limpiar y redibujar marcadores
        Object.values(busMarkers).forEach((m) => m.remove());
        busMarkers = {};

        // --- AQUÍ ACTUALIZAMOS EL KPI DE TOTAL DE CAMIONES ---
        const elTotal = document.getElementById("kpi-total-buses");
        if (elTotal) elTotal.textContent = camiones.length;

        camiones.forEach((c) => {
          if (c.ubicacionActual && c.ubicacionActual.coordinates) {
            const [lng, lat] = c.ubicacionActual.coordinates;
            const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`🚍 <b>${c.numeroUnidad}</b><br>Vel: ${c.velocidad || 0} km/h`);
            const m = new maplibregl.Marker({ element: createBusElement() })
              .setLngLat([lng, lat])
              .setPopup(popup)
              .addTo(map);
            busMarkers[c._id] = m;
          }
        });

        // ACTUALIZAR LISTA DE FLOTA
        renderFleetList();
      }
    } catch (e) {
      console.error("Error camiones:", e);
    }

    // 2. Conductores Activos (CORREGIDO)
    try {
      const res = await fetch(BACKEND_URL + "/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const users = await res.json();
        usuariosCargados = users;

        // --- CORRECCIÓN CLAVE: ACEPTAR MÁS ESTADOS ---
        const conductoresActivos = users.filter((u) => {
          if (u.tipo !== "conductor") return false;

          // Lista de estados que consideramos "Trabajando"
          const estadosActivos = [
            "En Servicio",
            "Abordando",
            "Inicio de Recorridos",
            "En Ruta",
          ];

          // Verificamos si el estado del usuario está en la lista
          return estadosActivos.includes(u.estado);
        });

        // Actualizamos el KPI
        const elDrivers = document.getElementById("kpi-drivers-active");
        if (elDrivers) elDrivers.textContent = conductoresActivos.length;
      }
    } catch (e) {
      console.error("Error usuarios:", e);
    }

    // 3. Alertas
    try {
      const res = await fetch(BACKEND_URL + "/api/notificaciones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const alerts = await res.json();
        // Filtramos solo las de hoy o recientes si quieres, o todas
        alertCount = alerts.length;
        const elAlerts = document.getElementById("kpi-active-alerts");
        if (elAlerts) elAlerts.textContent = alertCount;
      }
    } catch (e) {
      console.error("Error alertas:", e);
    }
  }

  const kpiStudents = document.getElementById("kpi-students-waiting");
  const kpiAlerts = document.getElementById("kpi-active-alerts");
  let studentCount = 0;

  // --- SOCKETS ---
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLngLat([data.location.lng, data.location.lat]);
      // Actualizar también en el objeto local para la lista
      const cam = camionesCargados.find(c => c._id === data.camionId);
      if (cam) {
          cam.ubicacionActual = { coordinates: [data.location.lng, data.location.lat] };
          cam.velocidad = data.velocidad || 0;
          renderFleetList(); // Refrescar sidebar
      }
    } else {
      // Si es un camión nuevo, recargamos todo el mapa para asegurarnos
      inicializarDashboard();
      addActivityItem(`Nueva unidad conectada: ${data.camionId}`, 'success');
    }
  });

  socket.on("newIncidentAlert", (data) => {
    alert(`🚨 ¡NUEVO INCIDENTE!\nCamión: ${data.camionId}\nTipo: ${data.tipo}`);
    alertCount++;
    if (kpiAlerts) kpiAlerts.textContent = alertCount;

    const marker = busMarkers[data.camionId];
    if (marker) {
      const el = marker.getElement();
      el.className = "custom-bus-icon-alert";
      el.innerHTML = `<div style="background-color:var(--color-error); border-radius: 50%; width: 35px; height: 35px; display: flex; justify-content: center; align-items: center; color: white; border: 3px solid white; font-size: 16px; animation: pulse 1.5s infinite; box-shadow: 0 0 15px var(--color-error);"><i class="fas fa-bus"></i></div>`;
      
      const popup = marker.getPopup();
      if(popup) {
          popup.setHTML(`🚨 <b>ALERTA: ${data.tipo}</b><br>${data.detalles || ""}`);
      } else {
          marker.setPopup(new maplibregl.Popup({ offset: 15 }).setHTML(`🚨 <b>ALERTA: ${data.tipo}</b><br>${data.detalles || ""}`));
      }
      marker.togglePopup();
    }
  });

  socket.on("studentWaiting", (data) => {
    console.log("🙋‍♂️ Estudiante esperando:", data);
    studentCount++;
    if (kpiStudents) kpiStudents.textContent = studentCount;

    if (data.location && data.location.lat && data.location.lng) {
      const studentEl = document.createElement('div');
      studentEl.style.cssText = 'width: 40px; height: 40px; background-color: rgba(46, 204, 113, 0.5); border: 2px solid var(--color-exito); border-radius: 50%; animation: pulse 2s infinite;';
      
      const popup = new maplibregl.Popup({ offset: 10 }).setHTML(`<b>Pasajero esperando</b><br>Enviado a las: ${new Date().toLocaleTimeString()}`);
      new maplibregl.Marker({ element: studentEl })
          .setLngLat([data.location.lng, data.location.lat])
          .setPopup(popup)
          .addTo(map);
    }
  });

  window.abrirModalBusqueda = function (tipo) {
    if (tipo === "horario") {
      popularDropdownsHorarios("buscar");
    }
    const modal = document.getElementById(`search-${tipo}-modal`);
    if (modal) modal.classList.add("modal-visible");
  };

  // Cerrar cualquier modal con la X o botón cerrar
  document.addEventListener("click", (e) => {
    // Cerrar con botón X o Cancelar
    if (
      e.target.matches(".close-button") ||
      e.target.matches(".btn-secondary")
    ) {
      const modal = e.target.closest(".modal");
      const overlay = e.target.closest(".fullscreen-overlay");
      if (modal) modal.classList.remove("modal-visible");
      if (overlay) overlay.classList.remove("active");
      // Si es botón limpiar/cancelar de búsqueda, reseteamos el form
      if (e.target.classList.contains("btn-reset-search")) {
        const form = e.target.closest("form");
        if (form) form.reset();
        // Recargar tabla completa
        if (form.id.includes("usuario")) renderTablaUsuarios(usuariosCargados);
        if (form.id.includes("camion")) renderTablaCamiones(camionesCargados);
        if (form.id.includes("ruta")) renderTablaRutas(rutasCargadas);
        if (form.id.includes("horario")) renderTablaHorarios(horariosCargados);
        if (form.id.includes("alerta")) renderTablaAlertas(alertasCargadas);
      }
    }
    // Cerrar al dar click fuera (backdrop)
    if (e.target.classList.contains("modal")) {
      e.target.classList.remove("modal-visible");
    }
  });

  // ============================================================
  //  4. CRUD USUARIOS
  // ============================================================
  const modalUser = document.getElementById("edit-user-modal");
  const modalFormUser = document.getElementById("form-edit-user");
  const closeModalBtnUser = modalUser?.querySelector(".close-button");
  const camposConductorEdit = document.getElementById("campos-conductor");
  const formRegistrarUsuario = document.getElementById(
    "form-registrar-usuario"
  );
  const userTipoSelect = document.getElementById("user-tipo");
  const camposConductorNew = document.getElementById(
    "new-user-conductor-fields"
  );

  // Lógica campos dinámicos
  if (userTipoSelect) {
    userTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor") {
        camposConductorNew.style.display = "block";
      } else {
        camposConductorNew.style.display = "none";
        document.getElementById("user-licencia").value = "Si";
      }
    });
  }
  const editUserTipoSelect = document.getElementById("edit-user-tipo");
  if (editUserTipoSelect) {
    editUserTipoSelect.addEventListener("change", (e) => {
      if (e.target.value === "conductor")
        camposConductorEdit.style.display = "block";
      else camposConductorEdit.style.display = "none";
    });
  }

  function renderEmptyState(colspan, message) {
    return `<tr>
      <td colspan="${colspan}" style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 3rem; color: var(--color-secundario); margin-bottom: 15px;">
          <i class="fas fa-folder-open"></i>
        </div>
        <p style="color: var(--color-texto-gris); font-size: 1.1rem; margin: 0;">${message}</p>
      </td>
    </tr>`;
  }

  function renderTablaUsuarios(lista) {
    const tbody = document.getElementById("tabla-usuarios-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (lista.length === 0) {
      tbody.innerHTML = renderEmptyState(5, "No se encontraron usuarios.");
      return;
    }

    lista.forEach((u) => {
      const row = document.createElement("tr");

      // 1. Configurar badge de tipo
      let tipoTexto = "Usuario";
      let badgeClass = "badge-usuario";
      let icon = "fa-user";

      if (u.tipo === "administrador" || u.tipo === "admin") {
        tipoTexto = "Admin";
        badgeClass = "badge-admin";
        icon = "fa-user-shield";
      } else if (u.tipo === "conductor") {
        tipoTexto = "Conductor";
        badgeClass = "badge-conductor";
        icon = "fa-bus";
      } else if (u.tipo === "estudiante") {
        tipoTexto = "Pasajero";
        badgeClass = "badge-estudiante";
        icon = "fa-graduation-cap";
      }

      // 2. Generar HTML del estado con pulso
      const estaActivo = u.estado === "activo" || u.estado === "En Servicio" || u.estado === "En Ruta" || u.estado === "online";
      const estadoHtml = `
        <div class="status-pill">
          <span class="status-dot-pulse ${estaActivo ? 'active' : 'inactive'}"></span>
          ${estaActivo ? 'Activo' : 'Offline'}
        </div>
      `;

      // 3. RENDERIZADO
      row.innerHTML = `
        <td><b>${u.nombre}</b></td>
        <td><span class="text-muted">${u.email}</span></td>
        <td><span class="badge ${badgeClass}"><i class="fas ${icon}"></i> ${tipoTexto}</span></td>
        <td>${estadoHtml}</td>
        <td>
            <div class="table-actions" style="display:flex; gap:5px;">
                <button class="btn btn-secondary btn-sm btn-edit-user" title="Editar" data-id="${u._id}"><i class="fas fa-edit"></i></button>
                <button class="btn btn-danger btn-sm btn-delete-user" title="Eliminar" data-id="${u._id}"><i class="fas fa-trash"></i></button>
            </div>
        </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarUsuarios() {
    const tablaBody = document.getElementById("tabla-usuarios-body");
    if (tablaBody)
      tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch(BACKEND_URL + "/api/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error usuarios");
      usuariosCargados = await response.json();
      renderTablaUsuarios(usuariosCargados);
    } catch (error) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${error.message}</td></tr>`;
    }
  }

  // Buscador Usuarios
  const formSearchUsuario = document.getElementById("form-search-usuario");
  if (formSearchUsuario) {
    formSearchUsuario.addEventListener("submit", (e) => {
      e.preventDefault();
      const nombre = document
        .getElementById("search-user-nombre")
        .value.toLowerCase();
      const email = document
        .getElementById("search-user-email")
        .value.toLowerCase();
      const tipo = document.getElementById("search-user-tipo").value;
      const estado = document.getElementById("search-user-estado").value;

      const filtrados = usuariosCargados.filter((user) => {
        const matchNombre =
          !nombre || user.nombre.toLowerCase().includes(nombre);
        const matchEmail = !email || user.email.toLowerCase().includes(email);
        const matchTipo = !tipo || user.tipo === tipo;
        const matchEstado = !estado || (user.estado || "activo") === estado;
        return matchNombre && matchEmail && matchTipo && matchEstado;
      });
      renderTablaUsuarios(filtrados);
      document
        .getElementById("search-usuario-modal")
        .classList.remove("modal-visible");
    });
  }

  // Registrar Usuario
  if (formRegistrarUsuario) {
    formRegistrarUsuario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tipo = document.getElementById("user-tipo").value;
      const datos = {
        nombre: document.getElementById("user-nombre").value,
        email: document.getElementById("user-email").value,
        password: document.getElementById("user-password").value,
        tipo: tipo,
      };
      if (tipo === "conductor") {
        datos.licencia = document.getElementById("user-licencia").value;
      }
      try {
        const response = await fetch(BACKEND_URL + "/api/users", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error registro");
        alert("¡Usuario registrado!");
        formRegistrarUsuario.reset();
        camposConductorNew.style.display = "none";
        cargarUsuarios();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // Eventos Tabla Usuarios (Editar/Borrar)
  const tablaBodyUsuarios = document.getElementById("tabla-usuarios-body");
  if (tablaBodyUsuarios) {
    tablaBodyUsuarios.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-user");
      const btnDelete = e.target.closest(".btn-delete-user");
      if (btnEdit) {
        const user = usuariosCargados.find((u) => u._id === btnEdit.dataset.id);
        if (user) openEditUserModal(user);
      }
      if (btnDelete) handleDeleteUser(btnDelete.dataset.id);
    });
  }

  function openEditUserModal(user) {
    document.getElementById("edit-user-id").value = user._id;
    document.getElementById("edit-user-nombre").value = user.nombre;
    document.getElementById("edit-user-email").value = user.email;
    document.getElementById("edit-user-tipo").value = user.tipo;
    if (user.tipo === "conductor") {
      camposConductorEdit.style.display = "block";
      document.getElementById("edit-user-licencia").value =
        user.conductor?.licencia || "No";
    } else {
      camposConductorEdit.style.display = "none";
    }
    modalUser.classList.add("modal-visible");
  }

  if (closeModalBtnUser)
    closeModalBtnUser.onclick = () =>
      modalUser.classList.remove("modal-visible");

  if (modalFormUser) {
    modalFormUser.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-user-id").value;
      const tipo = document.getElementById("edit-user-tipo").value;
      const datos = {
        nombre: document.getElementById("edit-user-nombre").value,
        email: document.getElementById("edit-user-email").value,
        tipo: tipo,
      };
      if (tipo === "conductor") {
        datos.licencia = document.getElementById("edit-user-licencia").value;
      }
      try {
        const response = await fetch(`${BACKEND_URL}/api/users/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualización");
        alert("¡Usuario actualizado!");
        modalUser.classList.remove("modal-visible");
        cargarUsuarios();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  async function handleDeleteUser(id) {
    if (!(await confirmAsync("¿Eliminar usuario?"))) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/users/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error eliminando");
      alert("✅ Usuario eliminado");
      cargarUsuarios();
      inicializarDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  // ============================================================
  //  5. CRUD CAMIONES
  // ============================================================
  const modalCamion = document.getElementById("edit-camion-modal");
  const modalFormCamion = document.getElementById("form-edit-camion");
  const closeModalBtnCamion = modalCamion?.querySelector(".close-button");

  function renderTablaCamiones(lista) {
    const tbody = document.getElementById("tabla-camiones-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (lista.length === 0) {
      tbody.innerHTML = renderEmptyState(5, "No se encontraron camiones.");
      return;
    }

    lista.forEach((c) => {
      const row = document.createElement("tr");

      // Lógica de Estado del Camión
      const estaActivo = c.estado === "En Servicio" || c.estado === "activo";
      const estadoHtml = `
        <div class="status-pill">
          <span class="status-dot-pulse ${estaActivo ? 'active' : 'inactive'}"></span>
          ${estaActivo ? 'Operativo' : 'Inactivo'}
        </div>
      `;

      row.innerHTML = `
          <td><code class="text-primary" style="font-weight:700">${c.placa}</code></td>
          <td><b>${c.numeroUnidad}</b></td>
          <td><span class="text-muted">${c.modelo || "N/A"}</span></td>
          <td>${estadoHtml}</td>
          <td>
              <div class="table-actions" style="display:flex; gap:5px;">
                  <button class="btn btn-secondary btn-sm btn-edit-camion" title="Editar" data-id="${c._id}"><i class="fas fa-edit"></i></button>
                  <button class="btn btn-danger btn-sm btn-delete-camion" title="Eliminar" data-id="${c._id}"><i class="fas fa-trash"></i></button>
              </div>
          </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarCamiones() {
    const tablaBody = document.getElementById("tabla-camiones-body");
    if (tablaBody)
      tablaBody.innerHTML = '<tr><td colspan="5">Cargando...</td></tr>';
    try {
      const response = await fetch(BACKEND_URL + "/api/camiones", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error");
      camionesCargados = await response.json();
      renderTablaCamiones(camionesCargados);
    } catch (e) {
      if (tablaBody)
        tablaBody.innerHTML = `<tr><td colspan="5" class="text-danger">${e.message}</td></tr>`;
    }
  }

  const formSearchCamion = document.getElementById("form-search-camion");
  if (formSearchCamion) {
    formSearchCamion.addEventListener("submit", (e) => {
      e.preventDefault();
      const placa = document
        .getElementById("search-camion-placa")
        .value.toLowerCase();
      const unidad = document
        .getElementById("search-camion-unidad")
        .value.toLowerCase();
      const modelo = document
        .getElementById("search-camion-modelo")
        .value.toLowerCase();
      const capacidad = document.getElementById(
        "search-camion-capacidad"
      ).value;
      const estado = document.getElementById("search-camion-estado").value;

      const filtrados = camionesCargados.filter((c) => {
        const matchPlaca = !placa || c.placa.toLowerCase().includes(placa);
        const matchUnidad =
          !unidad || c.numeroUnidad.toLowerCase().includes(unidad);
        const matchModelo =
          !modelo || (c.modelo && c.modelo.toLowerCase().includes(modelo));
        // Comparación flexible de capacidad (si escriben 40, busca los de 40)
        const matchCapacidad =
          !capacidad || (c.capacidad && c.capacidad.toString() === capacidad);
        //const matchEstado = !estado || c.estado === estado;

        let matchEstado = true;
        if (estado === "Activo") {
          // Consideramos activo si está En Servicio
          matchEstado = c.estado === "En Servicio";
        } else if (estado === "Inactivo") {
          // Consideramos inactivo cualquier otra cosa
          matchEstado = c.estado !== "En Servicio";
        }

        return (
          matchPlaca &&
          matchUnidad &&
          matchModelo &&
          matchCapacidad &&
          matchEstado
        );
      });
      renderTablaCamiones(filtrados);
      document
        .getElementById("search-camion-modal")
        .classList.remove("modal-visible");
    });
  }

  const formRegistrarCamion = document.getElementById("form-registrar-camion");
  if (formRegistrarCamion) {
    formRegistrarCamion.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        placa: document.getElementById("camion-placa").value,
        numeroUnidad: document.getElementById("camion-unidad").value,
        modelo: document.getElementById("camion-modelo").value,
        capacidad: document.getElementById("camion-capacidad").value,
      };
      try {
        const response = await fetch(BACKEND_URL + "/api/camiones", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error registrar");
        alert("¡Camión registrado!");
        formRegistrarCamion.reset();
        cargarCamiones();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const tablaBodyCamiones = document.getElementById("tabla-camiones-body");
  if (tablaBodyCamiones) {
    tablaBodyCamiones.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-camion");
      const btnDelete = e.target.closest(".btn-delete-camion");
      if (btnEdit) {
        const c = camionesCargados.find((x) => x._id === btnEdit.dataset.id);
        if (c) openEditCamionModal(c);
      }
      if (btnDelete) handleDeleteCamion(btnDelete.dataset.id);
    });
  }

  function openEditCamionModal(camion) {
    document.getElementById("edit-camion-id").value = camion._id;
    document.getElementById("edit-camion-placa").value = camion.placa;
    document.getElementById("edit-camion-unidad").value = camion.numeroUnidad;
    document.getElementById("edit-camion-modelo").value = camion.modelo || "";
    document.getElementById("edit-camion-capacidad").value =
      camion.capacidad || "";
    modalCamion.classList.add("modal-visible");
  }

  async function handleDeleteCamion(id) {
    if (!(await confirmAsync("¿Eliminar camión?"))) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("No se pudo eliminar");
      alert("¡Camión eliminado!");
      cargarCamiones();
      inicializarDashboard();
    } catch (error) {
      alert(error.message);
    }
  }

  if (closeModalBtnCamion)
    closeModalBtnCamion.onclick = () =>
      modalCamion.classList.remove("modal-visible");

  if (modalFormCamion) {
    modalFormCamion.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-camion-id").value;
      const datos = {
        placa: document.getElementById("edit-camion-placa").value,
        numeroUnidad: document.getElementById("edit-camion-unidad").value,
        modelo: document.getElementById("edit-camion-modelo").value,
        capacidad: document.getElementById("edit-camion-capacidad").value,
      };
      try {
        const response = await fetch(`${BACKEND_URL}/api/camiones/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualizar");
        alert("¡Camión actualizado!");
        modalCamion.classList.remove("modal-visible");
        cargarCamiones();
        inicializarDashboard();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  6. CRUD RUTAS
  // ============================================================
  const modalRuta = document.getElementById("edit-ruta-modal");
  const modalFormRuta = document.getElementById("form-edit-ruta");
  const closeModalBtnRuta = modalRuta?.querySelector(".close-button");

  function renderTablaRutas(lista) {
    const tablaBody = document.getElementById("tabla-rutas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (lista.length === 0) {
      tablaBody.innerHTML = renderEmptyState(5, "No se encontraron rutas.");
      return;
    }
    lista.forEach((r) => {
      const row = document.createElement("tr");
      row.innerHTML = `<td><b>${r.nombre}</b></td><td><span class="text-muted">${
        r.descripcion || "N/A"
      }</span></td><td><span class="badge ${
        r.activa ? "badge-admin" : "badge-conductor"
      }">${r.activa ? "Activa" : "Inactiva"}</span></td>
      <td>
        <div class="table-actions" style="display:flex; gap:5px;">
            <button class="btn btn-secondary btn-sm btn-edit-ruta" title="Editar" data-id="${r._id}"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm btn-delete-ruta" title="Eliminar" data-id="${r._id}"><i class="fas fa-trash"></i></button>
            <button class="btn btn-primary btn-sm btn-edit-mapa-ruta" title="Editar Trazado" data-id="${r._id}"><i class="fas fa-pencil-alt"></i></button>
        </div>
      </td>
      <td>
        <button class="btn btn-info btn-sm btn-preview-ruta" data-id="${r._id}">
            <i class="fas fa-eye"></i> Ver Mapa
        </button>
      </td>`;
      tablaBody.appendChild(row);
    });
  }

  async function cargarRutas() {
    try {
      const response = await fetch(BACKEND_URL + "/api/rutas", {
        headers: { Authorization: `Bearer ${token}` },
      });
      rutasCargadas = await response.json();
      renderTablaRutas(rutasCargadas);
    } catch (e) {}
  }

  const formSearchRuta = document.getElementById("form-search-ruta");
  if (formSearchRuta) {
    formSearchRuta.addEventListener("submit", (e) => {
      e.preventDefault();
      const nombre = document
        .getElementById("search-ruta-nombre")
        .value.toLowerCase();
      const activaVal = document.getElementById("search-ruta-activa").value;
      const filtrados = rutasCargadas.filter((r) => {
        const matchName = !nombre || r.nombre.toLowerCase().includes(nombre);
        let matchActive = true;
        if (activaVal !== "") {
          matchActive = r.activa === (activaVal === "true");
        }
        return matchName && matchActive;
      });
      renderTablaRutas(filtrados);
      document
        .getElementById("search-ruta-modal")
        .classList.remove("modal-visible");
    });
  }

  const formRegistrarRuta = document.getElementById("form-registrar-ruta");
  if (formRegistrarRuta) {
    formRegistrarRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        nombre: document.getElementById("ruta-nombre").value,
        descripcion: document.getElementById("ruta-descripcion").value,
        tiempoEstimadoTotal: document.getElementById("ruta-tiempo").value,
      };
      try {
        const response = await fetch(BACKEND_URL + "/api/rutas", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error al registrar");
        alert("¡Ruta registrada!");
        formRegistrarRuta.reset();
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  const tablaBodyRutas = document.getElementById("tabla-rutas-body");
  if (tablaBodyRutas) {
    tablaBodyRutas.addEventListener("click", (e) => {
      const btnEdit = e.target.closest(".btn-edit-ruta");
      const btnDelete = e.target.closest(".btn-delete-ruta");
      const btnEditMapa = e.target.closest(".btn-edit-mapa-ruta");
      if (btnEdit) {
        const r = rutasCargadas.find((x) => x._id === btnEdit.dataset.id);
        if (r) openEditRutaModal(r);
      }
      if (btnDelete) handleDeleteRuta(btnDelete.dataset.id);
      if (btnEditMapa) {
        const r = rutasCargadas.find((x) => x._id === btnEditMapa.dataset.id);
        if (r) openEditRutaMapaModal(r);
      }
    });
  }

  async function handleDeleteRuta(id) {
    if (!(await confirmAsync("¿Eliminar ruta?"))) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Error eliminar");
      alert("¡Ruta eliminada!");
      cargarRutas();
    } catch (error) {
      alert(error.message);
    }
  }

  function openEditRutaModal(ruta) {
    document.getElementById("edit-ruta-id").value = ruta._id;
    document.getElementById("edit-ruta-nombre").value = ruta.nombre;
    document.getElementById("edit-ruta-descripcion").value =
      ruta.descripcion || "";
    document.getElementById("edit-ruta-tiempo").value =
      ruta.tiempoEstimadoTotal || "";
    document.getElementById("edit-ruta-activa").value = ruta.activa;
    modalRuta.classList.add("modal-visible");
  }

  if (closeModalBtnRuta)
    closeModalBtnRuta.onclick = () =>
      modalRuta.classList.remove("modal-visible");

  if (modalFormRuta) {
    modalFormRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-id").value;
      const datos = {
        nombre: document.getElementById("edit-ruta-nombre").value,
        descripcion: document.getElementById("edit-ruta-descripcion").value,
        tiempoEstimadoTotal: document.getElementById("edit-ruta-tiempo").value,
        activa: document.getElementById("edit-ruta-activa").value === "true",
      };
      try {
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (!response.ok) throw new Error("Error actualizar");
        alert("¡Ruta actualizada!");
        modalRuta.classList.remove("modal-visible");
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  7. CRUD HORARIOS
  // ============================================================
  const formRegistrarHorario = document.getElementById(
    "form-registrar-horario"
  );
  const modalEditarHorario = document.getElementById("modal-editar-horario");
  const formEditarHorario = document.getElementById("form-editar-horario");
  const closeBtnHorario = modalEditarHorario?.querySelector(".close-button");
  let editingSalidaId = null;
  let editingHorarioId = null;

  // Helper: Detectar si dos días de la semana chocan (considerando 'Diario' y 'Lunes-Viernes')
  function checkDayOverlap(d1, d2) {
    if (d1 === d2) return true;
    if (d1 === "Diario" || d2 === "Diario") return true;
    const semana = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    if (d1 === "Lunes-Viernes" && semana.includes(d2)) return true;
    if (d2 === "Lunes-Viernes" && semana.includes(d1)) return true;
    return false;
  }

  if (formRegistrarHorario) {
    formRegistrarHorario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const datos = {
        ruta: document.getElementById("horario-ruta").value,
        diaSemana: document.getElementById("horario-dia").value,
        hora: document.getElementById("horario-hora").value,
        camionAsignado: document.getElementById("horario-camion").value,
        conductorAsignado: document.getElementById("horario-conductor").value,
      };

      // --- DETECCIÓN DE CONFLICTOS ---
      const conflicto = horariosCargados.find(h => {
        const mismoDia = checkDayOverlap(h.diaSemana, datos.diaSemana);
        const mismaHora = h.hora === datos.hora;
        if (mismoDia && mismaHora) {
          // Nota: Comparamos IDs o Nombres según lo que devuelva la API
          // Usamos camionUnidad y conductorNombre como respaldo si el ID no está directo
          const matchCamion = (h.camionId === datos.camionAsignado) || (h.camion && h.camion._id === datos.camionAsignado);
          const matchConductor = (h.conductorId === datos.conductorAsignado) || (h.conductor && h.conductor._id === datos.conductorAsignado);
          return matchCamion || matchConductor;
        }
        return false;
      });

      if (conflicto) {
        const ent = conflicto.camionId === datos.camionAsignado || (conflicto.camion && conflicto.camion._id === datos.camionAsignado) ? "El Camión" : "El Conductor";
        const nombreEnt = ent === "El Camión" ? conflicto.camionUnidad : conflicto.conductorNombre;
        
        Swal.fire({
          title: '¡Conflicto de Horario!',
          text: `${ent} (${nombreEnt}) ya tiene una salida programada el ${conflicto.diaSemana} a las ${conflicto.hora} en la ruta "${conflicto.rutaNombre}".`,
          icon: 'warning',
          confirmButtonColor: '#f39c12'
        });
        return;
      }

      try {
        const res = await fetch(BACKEND_URL + "/api/horarios", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(datos),
        });
        if (res.ok) {
          Swal.fire({
              title: "✅ ¡Registrado!",
              text: "La salida se ha guardado correctamente.",
              icon: "success",
              timer: 2000,
              showConfirmButton: false
          });
          formRegistrarHorario.reset();
          cargarHorarios();
        } else {
          const d = await res.json();
          Swal.fire("Error", d.message, "error");
        }
      } catch (error) {
        Swal.fire("Error", "No se pudo conectar con el servidor", "error");
      }
    });
  }

  function renderTablaHorarios(lista) {
    const tbody = document.getElementById("tabla-horarios-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    if (lista.length === 0) {
      tbody.innerHTML = renderEmptyState(6, "No se encontraron horarios.");
      return;
    }
    lista.forEach((h) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${h.diaSemana}</td>
        <td><strong>${h.hora}</strong></td>
        <td>${h.rutaNombre || "N/A"}</td>
        <td>${h.camionUnidad || '<span class="text-muted">--</span>'}</td>
        <td>${h.conductorNombre || '<span class="text-muted">--</span>'}</td>
        <td>
            <button class="btn btn-secondary btn-sm btn-edit-horario" data-id="${
              h._id
            }" data-salida-id="${
        h.salidaId
      }"><i class="fas fa-edit"></i></button>
            <button class="btn btn-danger btn-sm btn-delete-horario" data-id="${
              h._id
            }" data-salida-id="${
        h.salidaId
      }"><i class="fas fa-trash"></i></button>
        </td>`;
      tbody.appendChild(row);
    });
  }

  async function cargarHorarios() {
    try {
      const response = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      horariosCargados = await response.json();
      renderTablaHorarios(horariosCargados);
    } catch (e) {}
  }

  // --- LÓGICA DE BÚSQUEDA DE HORARIOS CORREGIDA (VERSIÓN FINAL) ---
  // --- LÓGICA DE BÚSQUEDA DE HORARIOS (CORREGIDA Y UNIFICADA) ---
  const formSearchHorario = document.getElementById("form-search-horario");

  if (formSearchHorario) {
    formSearchHorario.addEventListener("submit", (e) => {
      e.preventDefault();

      // 1. Obtener valores de los campos (Con nombres claros)
      const selRuta = document.getElementById("search-horario-ruta");
      const selDia = document.getElementById("search-horario-dia");
      const elHora = document.getElementById("search-horario-hora"); // El input de hora
      const selCamion = document.getElementById("search-horario-camion");
      const selConductor = document.getElementById("search-horario-conductor");

      // 2. Extraer texto para comparar
      const busquedaRuta = selRuta ? selRuta.value.toLowerCase() : "";
      const busquedaDia = selDia ? selDia.value : "";
      const busquedaHora = elHora ? elHora.value : ""; // Valor ej: "08:00"
      const busquedaCamion = selCamion ? selCamion.value.toLowerCase() : "";
      const busquedaConductor = selConductor
        ? selConductor.value.toLowerCase()
        : "";

      const filtrados = horariosCargados.filter((h) => {
        // A. Filtro Ruta
        const matchRuta =
          !busquedaRuta ||
          (h.rutaNombre && h.rutaNombre.toLowerCase().includes(busquedaRuta));

        // B. Filtro Día
        const matchDia = !busquedaDia || h.diaSemana === busquedaDia;

        // C. Filtro Hora (CORREGIDO)
        let matchHora = true;
        if (busquedaHora) {
          // Quitamos el cero inicial para comparar (ej: convierte "09:00" a "9:00")
          const horaEnBD = h.hora ? h.hora.toString().replace(/^0+/, "") : "";
          const horaBuscada = busquedaHora.toString().replace(/^0+/, "");

          // Verificamos si empieza igual (para que "9" encuentre "9:00" y "9:30")
          matchHora = horaEnBD.startsWith(horaBuscada);
        }

        // D. Filtro Camión
        const matchCamion =
          !busquedaCamion ||
          (h.camionUnidad &&
            h.camionUnidad.toString().toLowerCase().includes(busquedaCamion));

        // E. Filtro Conductor
        const matchConductor =
          !busquedaConductor ||
          (h.conductorNombre &&
            h.conductorNombre.toLowerCase().includes(busquedaConductor));

        return (
          matchRuta && matchDia && matchHora && matchCamion && matchConductor
        );
      });

      renderTablaHorarios(filtrados);
      document
        .getElementById("search-horario-modal")
        .classList.remove("modal-visible");
    });
  }

  // --- EVENTO PARA ABRIR Y LLENAR EL MODAL DE BÚSQUEDA ---
  // Esto asegura que los selects se llenen ANTES de mostrar el modal
  const btnOpenSearchHorario =
    document.querySelector("#btn-open-search-horario") ||
    document.querySelector(".btn-open-search[data-target='horario']");

  if (btnOpenSearchHorario) {
    btnOpenSearchHorario.addEventListener("click", () => {
      popularDropdownsHorarios("buscar"); // <--- Esto llena los selects con NOMBRES
      document
        .getElementById("search-horario-modal")
        .classList.add("modal-visible");
    });
  }

  document
    .getElementById("tabla-horarios-body")
    ?.addEventListener("click", async (e) => {
      const btnEdit = e.target.closest(".btn-edit-horario");
      const btnDelete = e.target.closest(".btn-delete-horario");
      if (btnEdit) {
        const { id, salidaId } = btnEdit.dataset;
        abrirEditarHorario(id, salidaId);
      }
      if (btnDelete) {
        const { id, salidaId } = btnDelete.dataset;
        if (await confirmAsync("¿Eliminar horario?")) eliminarHorario(id, salidaId);
      }
    });

  // --- FUNCIÓN MEJORADA PARA LLENAR LISTAS (CREAR, EDITAR Y BUSCAR) ---
  async function popularDropdownsHorarios(modo = "crear") {
    // Definir prefijos según el modo
    // modo 'crear' -> id="horario-ruta"
    // modo 'editar' -> id="edit-horario-ruta"
    // modo 'buscar' -> id="search-horario-ruta"

    let prefix = "horario";
    if (modo === "editar") prefix = "edit-horario";
    if (modo === "buscar") prefix = "search-horario";

    const selRuta = document.getElementById(`${prefix}-ruta`);
    const selCamion = document.getElementById(`${prefix}-camion`);
    const selConductor = document.getElementById(`${prefix}-conductor`);

    // Evitar recargar si ya tiene datos (Solo para búsqueda, para no perder la selección)
    if (modo === "buscar" && selRuta && selRuta.options.length > 1) return;

    // Limpieza inicial
    if (selRuta)
      selRuta.innerHTML = '<option value="">-- C a r g a n d o --</option>';
    if (selCamion)
      selCamion.innerHTML = '<option value="">-- C a r g a n d o --</option>';
    if (selConductor)
      selConductor.innerHTML =
        '<option value="">-- C a r g a n d o --</option>';

    try {
      const [resRutas, resCamiones, resConductores] = await Promise.all([
        fetch(BACKEND_URL + "/api/rutas", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/camiones", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(BACKEND_URL + "/api/users", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const rutas = await resRutas.json();
      const camiones = await resCamiones.json();
      const usuarios = await resConductores.json();
      const conductores = usuarios.filter((u) => u.tipo === "conductor");

      // 1. LLENAR RUTAS
      if (selRuta) {
        selRuta.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        rutas.forEach((r) => {
          if (r.activa) {
            // TRUCO: Si es búsqueda, usamos el NOMBRE como valor. Si es crear/editar, usamos el ID.
            const valor = modo === "buscar" ? r.nombre : r._id;
            selRuta.innerHTML += `<option value="${valor}">${r.nombre}</option>`;
          }
        });
      }

      // 2. LLENAR CAMIONES
      if (selCamion) {
        selCamion.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        camiones.forEach((c) => {
          if (c.estado === "activo" || modo === "buscar") {
            // En búsqueda mostramos todos
            const valor = modo === "buscar" ? c.numeroUnidad : c._id;
            selCamion.innerHTML += `<option value="${valor}">${c.numeroUnidad} (${c.placa})</option>`;
          }
        });
      }

      // 3. LLENAR CONDUCTORES
      if (selConductor) {
        selConductor.innerHTML =
          '<option value="">-- Todos / Seleccionar --</option>';
        conductores.forEach((c) => {
          const valor = modo === "buscar" ? c.nombre : c._id;
          selConductor.innerHTML += `<option value="${valor}">${c.nombre}</option>`;
        });
      }
    } catch (e) {
      console.error(e);
      if (selRuta)
        selRuta.innerHTML = '<option value="">Error al cargar</option>';
    }
  }

  async function abrirEditarHorario(horarioId, salidaId) {
    await popularDropdownsHorarios("editar");
    try {
      const res = await fetch(`${BACKEND_URL}/api/horarios/${horarioId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const horarioDoc = await res.json();
      const salida = horarioDoc.salidas.find((s) => s._id === salidaId);

      document.getElementById("edit-horario-id").value = horarioId;
      document.getElementById("edit-salida-id").value = salidaId;
      editingSalidaId = salidaId;
      editingHorarioId = horarioId;

      document.getElementById("edit-horario-ruta").value =
        horarioDoc.ruta._id || horarioDoc.ruta;
      document.getElementById("edit-horario-dia").value = horarioDoc.diaSemana;
      document.getElementById("edit-horario-salida").value = salida.hora;
      document.getElementById("edit-horario-camion").value =
        salida.camionAsignado || "";
      document.getElementById("edit-horario-conductor").value =
        salida.conductorAsignado || "";

      modalEditarHorario.classList.add("modal-visible");
    } catch (e) {
      alert(e.message);
    }
  }

  async function eliminarHorario(horarioId, salidaId) {
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/horarios/${horarioId}/salidas/${salidaId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        alert("¡Eliminado!");
        cargarHorarios();
      }
    } catch (e) {
      alert(e.message);
    }
  }

  if (formEditarHorario) {
    formEditarHorario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {
        ruta: document.getElementById("edit-horario-ruta").value,
        diaSemana: document.getElementById("edit-horario-dia").value,
        hora: document.getElementById("edit-horario-salida").value,
        camionAsignado: document.getElementById("edit-horario-camion").value,
        conductorAsignado: document.getElementById("edit-horario-conductor")
          .value,
      };
      try {
        const res = await fetch(
          `${BACKEND_URL}/api/horarios/${editingHorarioId}/salidas/${editingSalidaId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(data),
          }
        );
        if (res.ok) {
          alert("✅ Actualizado");
          modalEditarHorario.classList.remove("modal-visible");
          cargarHorarios();
        }
      } catch (e) {
        alert("Error conexión");
      }
    });
  }

  if (closeBtnHorario)
    closeBtnHorario.onclick = () =>
      modalEditarHorario.classList.remove("modal-visible");
  window.cerrarModalEditarHorario = () =>
    modalEditarHorario.classList.remove("modal-visible");

  // 1. Icono de Pasajero (DOM Element para MapLibre)
  function createStudentAdminElement() {
    const el = document.createElement('div');
    el.className = "student-marker-admin";
    el.innerHTML = `<div style="background-color: #0dcaf0; color: white; width: 25px; height: 25px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.5);"><i class="fas fa-user"></i></div>`;
    return el;
  }

  // 2. Escuchar evento
  socket.on("studentWaiting", (data) => {
    console.log("Admin: Pasajero esperando", data);

    const popup = new maplibregl.Popup({ offset: 10 }).setHTML(`<strong>Pasajero esperando</strong><br>Ruta: ${data.rutaId}`);
    const marker = new maplibregl.Marker({ element: createStudentAdminElement() })
      .setLngLat([data.location.lng, data.location.lat])
      .setPopup(popup)
      .addTo(map);

    addActivityItem(`Pasajero esperando en ruta: ${data.rutaId}`, 'system');

    // Limpiar después de 5 min
    setTimeout(() => {
      marker.remove();
    }, 300000);
  });

  // ============================================================
  //  LÓGICA DEL CENTRO DE CONTROL (SIDEBAR Y FEED)
  // ============================================================
  function renderFleetList() {
      const container = document.getElementById("fleet-list-container");
      const activeCount = document.getElementById("fleet-active-count");
      if (!container) return;

      container.innerHTML = "";
      let count = 0;

      // Ordenar por número de unidad
      const listaOrdenada = [...camionesCargados].sort((a,b) => a.numeroUnidad.localeCompare(b.numeroUnidad));

      listaOrdenada.forEach(c => {
          const isOnline = c.ubicacionActual && c.ubicacionActual.coordinates;
          if (isOnline) count++;

          const item = document.createElement("div");
          item.className = `fleet-item ${isOnline ? 'online' : ''}`;
          item.innerHTML = `
              <div class="bus-info">
                  <span class="bus-id"><i class="fas fa-bus"></i> ${c.numeroUnidad}</span>
                  <span class="bus-status">
                      <span class="status-dot ${isOnline ? 'online' : ''}"></span>
                      ${isOnline ? 'En Línea' : 'Offline'}
                  </span>
              </div>
              <div class="bus-details">
                  <div style="display:flex; justify-content: space-between">
                    <span><i class="fas fa-tag"></i> ${c.placa}</span>
                    <span><i class="fas fa-tachometer-alt"></i> ${c.velocidad || 0} km/h</span>
                  </div>
              </div>
          `;

          item.onclick = () => {
              if (isOnline) {
                  const [lng, lat] = c.ubicacionActual.coordinates;
                  map.flyTo({ 
                      center: [lng, lat], 
                      zoom: 17, 
                      pitch: 45,
                      duration: 2000 
                  });
                  
                  if (busMarkers[c._id]) {
                      busMarkers[c._id].togglePopup();
                  }
                  
                  // Resaltar item
                  document.querySelectorAll('.fleet-item').forEach(i => i.classList.remove('active'));
                  item.classList.add('active');
              } else {
                  Swal.fire({
                      title: 'Unidad Offline',
                      text: `El camión ${c.numeroUnidad} no está transmitiendo señal en este momento.`,
                      icon: 'info',
                      timer: 2000,
                      showConfirmButton: false
                  });
              }
          };

          container.appendChild(item);
      });

      if (activeCount) activeCount.textContent = count;
  }

  function addActivityItem(message, type = 'info') {
      const feed = document.getElementById('recent-activity-feed');
      if (!feed) return;

      const item = document.createElement('div');
      item.className = `activity-item ${type}`;
      
      let icon = 'fas fa-info-circle';
      if (type === 'danger' || type === 'alert') icon = 'fas fa-exclamation-circle';
      if (type === 'warning') icon = 'fas fa-exclamation-triangle';
      if (type === 'success') icon = 'fas fa-check-circle';
      if (type === 'bus') icon = 'fas fa-bus';

      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      item.innerHTML = `
          <i class="${icon}"></i>
          <div class="activity-content">
              <span>${message}</span>
          </div>
          <span class="activity-time">${time}</span>
      `;

      feed.prepend(item);

      // Si es una alerta, incrementar contador en sidebar
      if (type === 'danger' || type === 'alert') {
          updateAlertBadge(1);
      }

      if (feed.children.length > 20) {
          feed.removeChild(feed.lastChild);
      }
  }

  function updateAlertBadge(delta) {
      const badge = document.getElementById('alert-count-badge');
      if (!badge) return;
      
      let current = parseInt(badge.textContent) || 0;
      current += delta;
      
      if (current > 0) {
          badge.textContent = current;
          badge.style.display = 'inline-block';
      } else {
          badge.style.display = 'none';
      }
  }

  // Hacer disponible globalmente por si otras partes quieren loguear actividad
  window.addActivityItem = addActivityItem;


  // ============================================================
  //  8. EDITOR DE RUTAS (MAPA)
  // ============================================================
  const modalRutaMapa = document.getElementById("edit-ruta-mapa-modal");
  const modalFormRutaMapa = document.getElementById("form-edit-ruta-mapa");
  const closeModalBtnRutaMapa = modalRutaMapa?.querySelector(".close-button");
  const listaParadasUI = document.getElementById("lista-paradas");
  const inputRefOrigin = document.getElementById("ref-origin");
  const inputRefDest = document.getElementById("ref-destination");
  const btnClearRefs = document.getElementById("btn-clear-refs");
  const btnModeTracing = document.getElementById("btn-mode-tracing");
  const btnModeStops = document.getElementById("btn-mode-stops");

  if (closeModalBtnRutaMapa) {
    closeModalBtnRutaMapa.addEventListener("click", () => {
      modalRutaMapa.classList.remove("modal-visible");
    });
  }

  let editorMode = "stops";
  let editorMap = null;
  let arrayPuntosTrazado = [];
  let arrayPuntosParada = [];
  let traceMarkers = [];
  let stopMarkers = [];
  let marcadoresGuia = [];

  if (btnModeTracing && btnModeStops) {
    btnModeTracing.addEventListener("click", () => setEditorMode("tracing"));
    btnModeStops.addEventListener("click", () => setEditorMode("stops"));
  }

  function setEditorMode(mode) {
    editorMode = mode;
    const helpText = document.getElementById("editor-help-text");
    if (mode === "tracing") {
      btnModeTracing.classList.add("active");
      btnModeStops.classList.remove("active");
      if (editorMap) editorMap.getContainer().style.cursor = "crosshair";
      if (helpText) helpText.innerHTML = "<b>Modo Trazado:</b> Haz clic para dibujar el camino línea por línea (ideal para caminos rurales o atajos).";
    } else {
      btnModeStops.classList.add("active");
      btnModeTracing.classList.remove("active");
      if (editorMap) editorMap.getContainer().style.cursor = "default";
      if (helpText) helpText.innerHTML = "<b>Modo Paradas:</b> Coloca los puntos donde suben los pasajeros. La ruta se trazará <b>automáticamente</b> por las calles.";
    }
  }

  function inicializarEditorMapa() {
    if (editorMap) return;
    
    editorMap = new maplibregl.Map({
      container: 'ruta-map-editor',
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [initialLng, initialLat],
      zoom: initialZoom,
      attributionControl: false
    });
    editorMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    // Observar cambios de tamaño en el editor
    const editorContainer = document.getElementById("ruta-map-editor");
    if (editorContainer) {
        new ResizeObserver(() => {
            if (editorMap) editorMap.resize();
        }).observe(editorContainer);
    }

    editorMap.on('load', () => {
      editorMap.addSource('trace-source', {
        'type': 'geojson',
        'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': [] } }
      });

      editorMap.addLayer({
        'id': 'trace-layer',
        'type': 'line',
        'source': 'trace-source',
        'layout': { 'line-join': 'round', 'line-cap': 'round' },
        'paint': { 'line-color': '#007bff', 'line-width': 5, 'line-opacity': 0.7 }
      });
      dibujarTrazado(); // Refresh in case data was loaded before style
    });

    editorMap.on("click", (e) => {
      // Ignorar clics si vienen de un popup o un marcador
      if (e.originalEvent && e.originalEvent.target) {
        if (e.originalEvent.target.closest('.maplibregl-popup') || e.originalEvent.target.closest('.maplibregl-marker')) {
          return;
        }
      }

      const { lng, lat } = e.lngLat;
      if (editorMode === "tracing") {
        arrayPuntosTrazado.push([lat, lng]);
        dibujarTrazado();
      } else {
        const nuevaParada = {
          nombre: `Parada ${arrayPuntosParada.length + 1}`,
          tipo: "parada_oficial",
          ubicacion: { type: "Point", coordinates: [lng, lat] },
        };
        arrayPuntosParada.push(nuevaParada);
        dibujarParadas();
      }
      actualizarListaUI();
    });
  }

  function dibujarTrazado() {
    traceMarkers.forEach(m => m.remove());
    traceMarkers = [];
    
    if (editorMap && editorMap.getSource('trace-source')) {
       const coords = arrayPuntosTrazado.map(p => [p[1], p[0]]); // GeoJSON needs [lng, lat]
       editorMap.getSource('trace-source').setData({ 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': coords } });
    }

    arrayPuntosTrazado.forEach((coords, index) => {
      const el = document.createElement('div');
      el.className = 'dot-marker maplibregl-marker';
      el.style.cssText = 'background-color:#007bff; border:2px solid white; width:12px; height:12px; border-radius:50%; cursor: pointer;';
      
      const popup = new maplibregl.Popup({ offset: 10 }).setHTML(`<div style="text-align:center;"><small>Punto #${index + 1}</small><br><button onclick="borrarPuntoTrazo(${index})" class="btn btn-danger btn-sm">Eliminar</button></div>`);
      
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([coords[1], coords[0]])
        .setPopup(popup)
        .addTo(editorMap);
        
      marker.on("dragend", () => {
        const newPos = marker.getLngLat();
        arrayPuntosTrazado[index] = [newPos.lat, newPos.lng];
        dibujarTrazado();
      });
      traceMarkers.push(marker);
    });
  }

  function dibujarParadas() {
    stopMarkers.forEach(m => m.remove());
    stopMarkers = [];
    
    arrayPuntosParada.forEach((parada, index) => {
      const [lng, lat] = parada.ubicacion.coordinates;
      const el = document.createElement('div');
      el.className = 'parada-marker maplibregl-marker';
      el.innerHTML = '<div style="background-color:#ffc107; color:#000; width:30px; height:30px; border-radius:50%; display:flex; justify-content:center; align-items:center; border:2px solid white; font-size:14px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); cursor: pointer;"><i class="fas fa-bus"></i></div>';
      
      const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`<div style="text-align:center;"><strong>${parada.nombre}</strong><br><button onclick="borrarParada(${index})" class="btn btn-danger btn-sm">Borrar</button></div>`);
      
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(editorMap);
        
      marker.on("dragend", () => {
        const newPos = marker.getLngLat();
        arrayPuntosParada[index].ubicacion.coordinates = [newPos.lng, newPos.lat];
      });
      stopMarkers.push(marker);
    });
  }

  function actualizarListaUI() {
    if (!listaParadasUI) return;
    listaParadasUI.innerHTML = "";
    const spanCountParadas = document.getElementById("count-paradas");
    const spanCountTrazado = document.getElementById("count-trazado");
    if (spanCountParadas)
      spanCountParadas.textContent = arrayPuntosParada.length;
    if (spanCountTrazado)
      spanCountTrazado.textContent = arrayPuntosTrazado.length;
    // (Aquí va tu lógica de renderizado de lista de paradas que ya tenías, resumida por espacio)
  }

  window.borrarPuntoTrazo = (index) => {
    arrayPuntosTrazado.splice(index, 1);
    dibujarTrazado();
    actualizarListaUI();
  };
  window.borrarParada = (index) => {
    arrayPuntosParada.splice(index, 1);
    dibujarParadas();
    actualizarListaUI();
  };

  function limpiarGuias() {
    marcadoresGuia.forEach((m) => m.remove());
    marcadoresGuia = [];
    if (inputRefOrigin) inputRefOrigin.value = "";
    if (inputRefDest) inputRefDest.value = "";
    // cerrarListas(); // Asegúrate de tener esta función si la usas
  }
  if (btnClearRefs) btnClearRefs.addEventListener("click", limpiarGuias);

  window.openEditRutaMapaModal = (ruta) => {
    modalRutaMapa.classList.add("modal-visible");
    document.getElementById("edit-ruta-mapa-id").value = ruta._id;
    const tituloSpan = document.getElementById("nombre-ruta-editor");
    if (tituloSpan) tituloSpan.textContent = ruta.nombre;

    const allPoints = ruta.paradas || [];
    arrayPuntosTrazado = [];
    arrayPuntosParada = [];
    allPoints.forEach((p) => {
      const [lng, lat] = p.ubicacion.coordinates;
      if (
        p.tipo === "parada_oficial" ||
        (p.nombre && p.nombre.toLowerCase().includes("parada"))
      ) {
        arrayPuntosParada.push(p);
      } else {
        arrayPuntosTrazado.push([lat, lng]);
      }
    });
    limpiarGuias();
    setTimeout(() => {
      inicializarEditorMapa();
      editorMap.resize();
      dibujarTrazado();
      dibujarParadas();
      actualizarListaUI();
      setEditorMode("tracing");
    }, 400);
  };

  if (modalFormRutaMapa) {
    modalFormRutaMapa.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = document.getElementById("edit-ruta-mapa-id").value;
      const trazoParaGuardar = arrayPuntosTrazado.map((coords, i) => ({
        nombre: `Punto ${i}`,
        tipo: "trazo",
        ubicacion: { type: "Point", coordinates: [coords[1], coords[0]] },
      }));
      const paradasParaGuardar = arrayPuntosParada.map((p) => ({
        ...p,
        tipo: "parada_oficial",
      }));
      const payload = { paradas: [...trazoParaGuardar, ...paradasParaGuardar] };

      try {
        const response = await fetch(`${BACKEND_URL}/api/rutas/${id}/paradas`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error("Error guardando");
        alert("¡Ruta guardada!");
        modalRutaMapa.classList.remove("modal-visible");
        cargarRutas();
      } catch (error) {
        alert(error.message);
      }
    });
  }

  // ============================================================
  //  BUSCADOR INTELIGENTE TIPO GOOGLE MAPS (Nominatim API)
  // ============================================================

  const listOrigin = document.getElementById("list-origin");

  const listDest = document.getElementById("list-destination");

  // Función para limpiar pines
  function limpiarGuias() {
    marcadoresGuia.forEach((m) => editorMap.removeLayer(m));
    marcadoresGuia = [];
    if (inputRefOrigin) inputRefOrigin.value = "";
    if (inputRefDest) inputRefDest.value = "";
    cerrarListas();
  }

  if (btnClearRefs) btnClearRefs.addEventListener("click", limpiarGuias);

  // Función "Debounce" (para no buscar en cada letra, espera 300ms)
  function debounce(func, timeout = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        func.apply(this, args);
      }, timeout);
    };
  }

  // Configurar Inputs
  setupAutocomplete(inputRefOrigin, listOrigin, "origen");
  setupAutocomplete(inputRefDest, listDest, "destino");

  function setupAutocomplete(input, listElement, tipo) {
    if (!input || !listElement) return;

    input.addEventListener(
      "input",
      debounce(async (e) => {
        const query = e.target.value.trim().toLowerCase();
        listElement.innerHTML = ""; // Limpiar lista

        if (query.length < 2) {
          listElement.classList.remove("active");
          return;
        }

        // 1. BUSCAR EN LUGARES PREDEFINIDOS (Tus Favoritos)
        const resultadosLocales = LUGARES_CLAVE.filter((lugar) =>
          lugar.nombre.toLowerCase().includes(query)
        );

        // Renderizar locales primero (con icono de estrella)
        resultadosLocales.forEach((lugar) => {
          const li = document.createElement("li");
          li.style.backgroundColor = "#1a2e1a"; // Un fondo verdecito para resaltar
          li.innerHTML = `
                <i class="fas fa-star" style="color:gold;"></i>
                <div style="display:flex; flex-direction:column;">
                    <span style="font-weight:bold; color:#fff;">${lugar.nombre}</span>
                    <span style="font-size:0.75rem; color:#aaa;">Ubicación Guardada</span>
                </div>
              `;
          li.addEventListener("click", () => {
            input.value = lugar.nombre;
            listElement.classList.remove("active");
            colocarMarcadorGuia(lugar.lat, lugar.lon, tipo, lugar.nombre);
          });
          listElement.appendChild(li);
        });

        // 2. BUSCAR EN INTERNET (NOMINATIM API) - Opcional si no encuentras lo local
        try {
          // Búsqueda restringida a la zona
          const viewbox = "-108.60,25.30,-107.90,25.80";
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
            query
          )}&countrycodes=mx&limit=3&viewbox=${viewbox}&bounded=1`;

          const res = await fetch(url);
          const data = await res.json();

          data.forEach((lugar) => {
            const li = document.createElement("li");
            const parts = lugar.display_name.split(",");
            const mainName = parts[0];

            li.innerHTML = `
                    <i class="fas fa-map-marker-alt"></i>
                    <div style="display:flex; flex-direction:column; line-height:1.2;">
                        <span style="font-weight:bold;">${mainName}</span>
                        <span style="font-size:0.75rem; color:#aaa;">Resultado de Internet</span>
                    </div>
                  `;

            li.addEventListener("click", () => {
              input.value = mainName;
              listElement.classList.remove("active");
              colocarMarcadorGuia(
                lugar.lat,
                lugar.lon,
                tipo,
                lugar.display_name
              );
            });

            listElement.appendChild(li);
          });
        } catch (error) {
          console.log("Sin internet o error en API, mostrando solo locales.");
        }

        // Mostrar lista si hay algún resultado (local o de internet)
        if (listElement.children.length > 0) {
          listElement.classList.add("active");
        } else {
          listElement.classList.remove("active");
        }
      }, 300)
    );

    // Cerrar al hacer clic fuera
    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !listElement.contains(e.target)) {
        listElement.classList.remove("active");
      }
    });
  }

  function renderResultados(resultados, listElement, inputElement, tipo) {
    listElement.innerHTML = "";

    if (resultados.length === 0) {
      listElement.classList.remove("active");
      return;
    }

    resultados.forEach((lugar) => {
      const li = document.createElement("li");
      // Mostramos el nombre principal (display_name suele ser muy largo)
      // Intentamos formatearlo un poco
      const parts = lugar.display_name.split(",");
      const mainName = parts[0];
      const secondary = parts.slice(1, 3).join(",");

      li.innerHTML = `
            <i class="fas fa-map-pin"></i>
            <div style="display:flex; flex-direction:column; line-height:1.2;">
                <span style="font-weight:bold;">${mainName}</span>
                <span style="font-size:0.75rem; color:#aaa;">${secondary}</span>
            </div>
          `;

      li.addEventListener("click", () => {
        // 1. Poner texto en input
        inputElement.value = mainName;

        // 2. Cerrar lista
        listElement.classList.remove("active");

        // 3. Crear Marcador Visual en el Mapa
        colocarMarcadorGuia(lugar.lat, lugar.lon, tipo, lugar.display_name);
      });

      listElement.appendChild(li);
    });

    listElement.classList.add("active");
  }

  function cerrarListas() {
    if (listOrigin) listOrigin.classList.remove("active");
    if (listDest) listDest.classList.remove("active");
  }

  function colocarMarcadorGuia(lat, lng, tipo, titulo) {
    if (!editorMap) return;

    const color = tipo === "origen" ? "#2ecc71" : "#e74c3c"; // Verde o Rojo

    const el = document.createElement('div');
    el.className = "guide-marker";
    el.innerHTML = `<div style="
              background-color: ${color};
              width: 32px; height: 32px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 3px 10px rgba(0,0,0,0.4);
              display: flex; justify-content: center; align-items: center;
              color: white; font-size: 16px;">
              <i class="fas ${
                tipo === "origen" ? "fa-play" : "fa-flag-checkered"
              }"></i>
          </div>`;

    const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`<strong style="color:${color}">${tipo.toUpperCase()}</strong><br>${titulo}`);

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .setPopup(popup)
      .addTo(editorMap);

    marker.togglePopup();
    marcadoresGuia.push(marker);

    // Centrar el mapa en el lugar seleccionado
    editorMap.jumpTo({ center: [lng, lat], zoom: 15 });
  }
  // ----------------------------------------------------

  // --- 9. ¡NUEVO! CRUD - HISTORIAL DE ALERTAS ---
  function renderTablaAlertas(listaAlertas) {
    const tablaBody = document.getElementById("tabla-alertas-body");
    if (!tablaBody) return;
    tablaBody.innerHTML = "";
    if (listaAlertas.length === 0) {
      tablaBody.innerHTML = renderEmptyState(4, "No hay alertas.");
      return;
    }
    listaAlertas.forEach((alerta) => {
      const row = document.createElement("tr");
      const fecha = new Date(alerta.createdAt).toLocaleString("es-MX", {
        dateStyle: "short",
        timeStyle: "short",
      });

      // Determinar clase de severidad
      let severityClass = "info";
      let badgeClass = "badge-admin"; // Default blue
      
      const titulo = (alerta.titulo || "").toLowerCase();
      if (titulo.includes("sos") || titulo.includes("emergencia") || titulo.includes("peligro")) {
          severityClass = "alert-row-danger";
          badgeClass = "badge-danger";
          row.classList.add("alert-row-danger");
      } else if (titulo.includes("retraso") || titulo.includes("mantenimiento")) {
          severityClass = "warning";
          badgeClass = "badge-warning";
      }

      row.innerHTML = `
        <td><b>${alerta.camionUnidad || "N/A"}</b></td>
        <td><span class="badge ${badgeClass}">${alerta.titulo}</span></td>
        <td>${alerta.mensaje}</td>
        <td class="text-muted">${fecha}</td>
      `;
      tablaBody.appendChild(row);
    });
  }

  async function cargarAlertas() {
    try {
      const response = await fetch(BACKEND_URL + "/api/notificaciones", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // ✅ CORRECCIÓN: Guardamos en la variable global para que el buscador funcione
      alertasCargadas = await response.json();

      renderTablaAlertas(alertasCargadas);
    } catch (e) {
      console.error("Error cargando alertas:", e);
    }
  }

  // --- BÚSQUEDA DE ALERTAS (CORREGIDO) ---
  // --- LÓGICA DE BÚSQUEDA DE ALERTAS (CORREGIDA) ---
  const formSearchAlerta = document.getElementById("form-search-alerta");

  if (formSearchAlerta) {
    formSearchAlerta.addEventListener("submit", (e) => {
      // 1. ESTA LÍNEA ES LA QUE EVITA LA RECARGA DE PÁGINA
      e.preventDefault();

      // 2. Obtener valores
      const unidad = document
        .getElementById("search-alerta-unidad")
        .value.toLowerCase();
      const tipo = document
        .getElementById("search-alerta-tipo")
        .value.toLowerCase();
      const fechaInput = document.getElementById("search-alerta-fecha").value; // YYYY-MM-DD

      // 3. Filtrar
      const filtrados = alertasCargadas.filter((a) => {
        // Filtro Unidad
        const matchUnidad =
          !unidad ||
          (a.camionUnidad && a.camionUnidad.toLowerCase().includes(unidad));

        // Filtro Tipo (Select)
        const matchTipo =
          !tipo || (a.titulo && a.titulo.toLowerCase().includes(tipo));

        // Filtro Fecha (Compara solo la parte de la fecha, ignorando la hora)
        let matchFecha = true;
        if (fechaInput) {
          // Convertimos la fecha de la alerta (ISO) a formato local YYYY-MM-DD para comparar
          // Nota: Usamos split('T')[0] para tomar solo la fecha de la base de datos
          const fechaAlerta = new Date(a.createdAt).toISOString().split("T")[0];
          matchFecha = fechaAlerta === fechaInput;
        }

        return matchUnidad && matchTipo && matchFecha;
      });

      // 4. Renderizar y cerrar
      renderTablaAlertas(filtrados);
      document
        .getElementById("search-alerta-modal")
        .classList.remove("modal-visible");
    });
  } else {
    console.error(
      "No se encontró el formulario 'form-search-alerta'. Revisa el HTML."
    );
  }
  // --- FUNCIÓN GENÉRICA PARA ABRIR/CERRAR MODALES DE BÚSQUEDA ---
  window.abrirModalBusqueda = function (tipo) {
    if (tipo === "horario") popularDropdownsHorarios("buscar");
    const modal = document.getElementById(`search-${tipo}-modal`);
    if (modal) modal.classList.add("modal-visible");
  };

  // --- CIERRE MODALES GENERAL ---
  // window.onclick = (e) => {
  //     if(e.target.classList.contains("modal") || e.target.classList.contains("fullscreen-overlay")) {
  //         e.target.classList.remove("modal-visible");
  //     }
  // };
  // document.querySelectorAll(".close-button").forEach(btn => {
  //     btn.addEventListener("click", (e) => {
  //         e.target.closest(".modal")?.classList.remove("modal-visible");
  //         e.target.closest(".fullscreen-overlay")?.classList.remove("modal-visible");
  //     });
  // });

  // Botones Limpiar Búsqueda
  document.querySelectorAll(".btn-reset-search").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const form = e.target.closest("form");
      form.reset();
      e.target.closest(".modal").classList.remove("modal-visible");
      if (form.id === "form-search-usuario")
        renderTablaUsuarios(usuariosCargados);
      if (form.id === "form-search-camion")
        renderTablaCamiones(camionesCargados);
      if (form.id === "form-search-ruta") renderTablaRutas(rutasCargadas);
      if (form.id === "form-search-horario")
        renderTablaHorarios(horariosCargados);
      if (form.id === "form-search-alerta") renderTablaAlertas(alertasCargadas);
    });
  });

  cargarDashboardStats();

  // Actualizar cada 30 segundos automáticamente
  setInterval(cargarDashboardStats, 30000);
  // --- RENDERIZADO DE LÍNEA DE TIEMPO ---
  function renderTimeline() {
    const grid = document.getElementById("horarios-timeline-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // 1. Headers (Horas 00-23)
    grid.appendChild(createTimelineCell("Recurso", "timeline-header-cell"));
    for (let i = 0; i < 24; i++) {
      grid.appendChild(
        createTimelineCell(
          `${i.toString().padStart(2, "0")}:00`,
          "timeline-header-cell"
        )
      );
    }

    // 2. Agrupar por Camión (para las filas)
    const camiones = [
      ...new Set(horariosCargados.map((h) => h.camionUnidad || "Sin Camión")),
    ];

    if (camiones.length === 0) {
        const emptyMsg = document.createElement("div");
        emptyMsg.style.gridColumn = "1 / -1";
        emptyMsg.style.padding = "40px";
        emptyMsg.style.textAlign = "center";
        emptyMsg.innerHTML = `<p style="color: #666;">No hay datos para mostrar en la línea de tiempo.</p>`;
        grid.appendChild(emptyMsg);
        return;
    }

    camiones.forEach((camion) => {
      // Label de la fila (Camión)
      grid.appendChild(
        createTimelineCell(
          `<i class="fas fa-bus"></i> ${camion}`,
          "timeline-row-label"
        )
      );

      // Celdas de la fila (una por hora)
      for (let h = 0; h < 24; h++) {
        const cell = document.createElement("div");
        cell.className = "timeline-cell";

        // Filtrar horarios que caen en este camión, este día y esta hora
        const events = horariosCargados.filter((item) => {
          const matchDay =
            item.diaSemana === currentTimelineDay ||
            (currentTimelineDay === "Lunes-Viernes" &&
              ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"].includes(
                item.diaSemana
              )) ||
            item.diaSemana === "Diario";
          const itemHour = parseInt(item.hora.split(":")[0]);
          return item.camionUnidad === camion && matchDay && itemHour === h;
        });

        events.forEach((event) => {
          const eventEl = document.createElement("div");
          eventEl.className = "timeline-event";
          const minutes = parseInt(event.hora.split(":")[1]);
          const offset = (minutes / 60) * 100;
          eventEl.style.left = `${offset}%`;
          eventEl.style.width = "55px"; // Duración aproximada de una salida
          eventEl.innerHTML = `
                    <span class="event-time">${event.hora}</span>
                    <span class="event-route" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${event.rutaNombre}</span>
                  `;
          eventEl.title = `${event.rutaNombre} - ${event.conductorNombre} (${event.hora})`;
          
          // Tooltip con SweetAlert al hacer clic
          eventEl.onclick = () => {
              Swal.fire({
                  title: `Salida: ${event.rutaNombre}`,
                  html: `
                    <div style="text-align: left;">
                        <p><b>Día:</b> ${event.diaSemana}</p>
                        <p><b>Hora:</b> ${event.hora}</p>
                        <p><b>Camión:</b> ${event.camionUnidad}</p>
                        <p><b>Conductor:</b> ${event.conductorNombre}</p>
                    </div>
                  `,
                  icon: 'info',
                  confirmButtonText: 'Cerrar'
              });
          };

          cell.appendChild(eventEl);
        });

        grid.appendChild(cell);
      }
    });
  }

  function createTimelineCell(text, className) {
    const el = document.createElement("div");
    el.className = className;
    el.innerHTML = text;
    return el;
  }

  // ============================================================
  //  TAQUILLA (BÚSQUEDA, VINCULAR RFID, RECARGAR, TARIFAS)
  // ============================================================
  let tarifasCargadas = [];
  let taquillaUsuarioActual = null;

  const formBuscarUsuario = document.getElementById("form-buscar-usuario-taquilla");
  const formVincularRFID = document.getElementById("form-vincular-rfid");
  const formToggleEstudiante = document.getElementById("form-toggle-estudiante");
  const formTarifaGlobal = document.getElementById("form-tarifa-global");
  const formTarifaRuta = document.getElementById("form-tarifa-ruta");
  const btnRecargarSolo = document.getElementById("btn-recargar-solo");

  if (formBuscarUsuario) {
    formBuscarUsuario.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("taquilla-email").value.trim();
      const resultDiv = document.getElementById("taquilla-user-result");
      const btnSubmit = formBuscarUsuario.querySelector("button[type=submit]");

      resultDiv.style.display = "none";
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando...';

      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/user/${encodeURIComponent(email)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("Usuario no encontrado");

        const user = await res.json();
        taquillaUsuarioActual = user;

        document.getElementById("tq-nombre").textContent = user.nombre;
        document.getElementById("tq-email").textContent = user.email;
        document.getElementById("tq-tipo").textContent = user.tipo;
        document.getElementById("tq-saldo").textContent = `$${parseFloat(user.saldo || 0).toFixed(2)}`;
        document.getElementById("tq-rfid").textContent = user.rfid_uid || "Ninguno";
        document.getElementById("tq-estudiante").textContent = user.es_estudiante ? "Sí" : "No";
        document.getElementById("tq-user-id").value = user._id;
        document.getElementById("tq-es-estudiante").value = user.es_estudiante ? "true" : "false";

        const btnDesvincular = document.getElementById("btn-desvincular-rfid");
        if (btnDesvincular) btnDesvincular.style.display = user.rfid_uid ? "inline-block" : "none";

        resultDiv.style.display = "block";
        cargarTransaccionesUsuario(user._id);
      } catch (error) {
        Swal.fire({ icon: "error", title: "No encontrado", text: "Verifica el correo electrónico.", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        resultDiv.style.display = "none";
      } finally {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = '<i class="fas fa-search"></i> Buscar';
      }
    });
  }

  if (formVincularRFID) {
    formVincularRFID.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("taquilla-email").value.trim();
      const rfid_uid = document.getElementById("tq-rfid-uid").value.trim();
      const monto_inicial = parseFloat(document.getElementById("tq-monto-recarga").value) || 0;

      if (!rfid_uid) {
        Swal.fire({ icon: "warning", title: "Campo requerido", text: "Ingresa el UID de la tarjeta RFID", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        return;
      }

      // Si el usuario ya tiene RFID vinculado, pedir confirmación
      if (taquillaUsuarioActual?.rfid_uid) {
        const confirm = await Swal.fire({
          icon: "warning",
          title: "¿Reemplazar RFID?",
          text: `El usuario ya tiene la tarjeta "${taquillaUsuarioActual.rfid_uid}" vinculada. ¿Reemplazarla con "${rfid_uid}"?`,
          showCancelButton: true,
          confirmButtonText: "Sí, reemplazar",
          cancelButtonText: "Cancelar",
          background: "#1e1e1e", color: "#fff", confirmButtonColor: "#f59e0b"
        });
        if (!confirm.isConfirmed) return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/vincular`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email, rfid_uid, monto_inicial }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: `RFID ${rfid_uid} vinculado` });
        document.getElementById("tq-rfid").textContent = rfid_uid;
        document.getElementById("tq-saldo").textContent = `$${parseFloat(data.saldo).toFixed(2)}`;
        document.getElementById("tq-rfid-uid").value = "";
        document.getElementById("tq-monto-recarga").value = "";
        taquillaUsuarioActual.rfid_uid = rfid_uid;
        taquillaUsuarioActual.saldo = data.saldo;
        const btnDesvincular = document.getElementById("btn-desvincular-rfid");
        if (btnDesvincular) btnDesvincular.style.display = "inline-block";
        cargarTransaccionesUsuario(taquillaUsuarioActual?._id);
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  if (btnRecargarSolo) {
    btnRecargarSolo.addEventListener("click", async () => {
      const email = document.getElementById("taquilla-email").value.trim();
      const monto = parseFloat(document.getElementById("tq-monto-recarga").value);
      if (!monto || monto <= 0) {
        Swal.fire({ icon: "warning", title: "Monto inválido", text: "Ingresa un monto mayor a 0", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        return;
      }
      if (!taquillaUsuarioActual) {
        Swal.fire({ icon: "warning", title: "Sin usuario", text: "Busca un usuario primero", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        return;
      }
      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/recargar`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email, monto }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: `Recarga de $${monto.toFixed(2)} exitosa` });
        document.getElementById("tq-saldo").textContent = `$${parseFloat(data.saldo).toFixed(2)}`;
        document.getElementById("tq-monto-recarga").value = "";
        if (taquillaUsuarioActual) taquillaUsuarioActual.saldo = data.saldo;
        cargarTransaccionesUsuario(taquillaUsuarioActual?._id);
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  if (formToggleEstudiante) {
    formToggleEstudiante.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = document.getElementById("taquilla-email").value.trim();
      const estado = document.getElementById("tq-es-estudiante").value === "true";

      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/estudiante`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email, estado }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: estado ? "Usuario ahora es Estudiante" : "Usuario ahora es General" });
        document.getElementById("tq-estudiante").textContent = estado ? "Sí" : "No";
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  async function cargarTransaccionesUsuario(userId) {
    const tbody = document.getElementById("tq-transacciones-body");
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Cargando...</td></tr>';

    try {
      const res = await fetch(`${BACKEND_URL}/api/transacciones/admin/user/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error");
      const transacciones = await res.json();

      if (transacciones.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">Sin transacciones</td></tr>';
        return;
      }

      // Calcular saldo después para cada transacción (reverse chronological)
      let saldoCorriente = parseFloat(taquillaUsuarioActual?.saldo || 0);
      // Las transacciones vienen ordenadas DESC por timestamp.
      // Acumulamos desde la más reciente hacia atrás para obtener el saldo en cada punto.
      const saldos = [];
      for (let i = transacciones.length - 1; i >= 0; i--) {
        const t = transacciones[i];
        if (t.tipo_tarifa === "Recarga") {
          saldos[i] = saldoCorriente;
          saldoCorriente -= parseFloat(t.monto);
        } else {
          saldos[i] = saldoCorriente;
          saldoCorriente += parseFloat(t.monto);
        }
      }

      tbody.innerHTML = "";
      transacciones.forEach((t, i) => {
        const fecha = new Date(t.timestamp).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
        const esRecarga = t.tipo_tarifa === "Recarga";
        const montoColor = esRecarga ? "var(--color-acento)" : "var(--color-error)";
        const montoSigno = esRecarga ? "+" : "-";
        const badgeClass = t.tipo_tarifa === "Estudiante" ? "badge-estudiante" : (esRecarga ? "badge-success" : "badge-admin");
        const saldoStr = saldos[i] !== undefined ? `$${saldos[i].toFixed(2)}` : "--";
        const row = document.createElement("tr");
        row.innerHTML = `
          <td>${fecha}</td>
          <td style="color:${montoColor}; font-weight:700;">${montoSigno}$${parseFloat(t.monto).toFixed(2)}</td>
          <td><span class="badge ${badgeClass}">${t.tipo_tarifa}</span></td>
          <td>${t.rutaId?.nombre || "N/A"}</td>
          <td>${t.camionId}</td>
          <td>${t.cantidad_boletos}</td>
          <td style="color:var(--color-primario); font-weight:600;">${saldoStr}</td>
        `;
        tbody.appendChild(row);
      });
    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-danger">Error al cargar</td></tr>';
    }
  }

  // Desvincular RFID
  const btnDesvincular = document.getElementById("btn-desvincular-rfid");
  if (btnDesvincular) {
    btnDesvincular.addEventListener("click", async () => {
      const email = document.getElementById("taquilla-email").value.trim();
      const confirm = await Swal.fire({
        title: "¿Desvincular RFID?",
        text: `Se eliminará la tarjeta "${taquillaUsuarioActual?.rfid_uid}" del usuario.`,
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Sí, desvincular",
        cancelButtonText: "Cancelar",
        background: "#1e1e1e", color: "#fff", confirmButtonColor: "#ef4444"
      });
      if (!confirm.isConfirmed) return;
      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/desvincular`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: "RFID desvinculado" });
        document.getElementById("tq-rfid").textContent = "Ninguno";
        btnDesvincular.style.display = "none";
        if (taquillaUsuarioActual) taquillaUsuarioActual.rfid_uid = null;
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  // --- GESTIÓN DE TARIFAS ---
  async function cargarTarifas() {
    try {
      const res = await fetch(`${BACKEND_URL}/api/taquilla/tarifas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      tarifasCargadas = await res.json();
      renderTablaTarifas(tarifasCargadas);

      // Precargar tarifa global en los inputs
      const global = tarifasCargadas.find(t => !t.rutaId);
      if (global) {
        document.getElementById("tg-general").value = global.precioGeneral;
        document.getElementById("tg-estudiante").value = global.precioEstudiante;
      }
    } catch (e) {
      console.error("Error cargando tarifas:", e);
    }
  }

  function renderTablaTarifas(lista) {
    const tbody = document.getElementById("tabla-tarifas-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (lista.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No hay tarifas configuradas</td></tr>';
      return;
    }

    lista.forEach((t) => {
      const row = document.createElement("tr");
      const ambito = t.rutaId ? (t.rutaId.nombre || t.rutaId._id || "Ruta específica") : "🌐 Global";
      row.innerHTML = `
        <td><b>${ambito}</b></td>
        <td>$${parseFloat(t.precioGeneral).toFixed(2)}</td>
        <td>$${parseFloat(t.precioEstudiante).toFixed(2)}</td>
        <td>
          ${t.rutaId ? `<button class="btn btn-danger btn-sm btn-eliminar-tarifa" data-id="${t.rutaId._id || t.rutaId}"><i class="fas fa-trash"></i></button>` : '<span class="text-muted">Global</span>'}
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  if (formTarifaGlobal) {
    formTarifaGlobal.addEventListener("submit", async (e) => {
      e.preventDefault();
      const precioGeneral = parseFloat(document.getElementById("tg-general").value);
      const precioEstudiante = parseFloat(document.getElementById("tg-estudiante").value);

      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/tarifas/global`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ precioGeneral, precioEstudiante }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: "Tarifa global actualizada" });
        cargarTarifas();
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  async function inicializarTaquillaRutas() {
    const select = document.getElementById("tr-ruta");
    if (!select || select.options.length > 1) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/rutas`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rutas = await res.json();
      select.innerHTML = '<option value="">-- Seleccionar --</option>';
      rutas.forEach((r) => {
        select.innerHTML += `<option value="${r._id}">${r.nombre}</option>`;
      });
    } catch (e) {
      console.error(e);
    }
  }

  if (formTarifaRuta) {
    formTarifaRuta.addEventListener("submit", async (e) => {
      e.preventDefault();
      const rutaId = document.getElementById("tr-ruta").value;
      const precioGeneral = parseFloat(document.getElementById("tr-general").value);
      const precioEstudiante = parseFloat(document.getElementById("tr-estudiante").value);

      if (!rutaId) {
        Swal.fire({ icon: "warning", title: "Selecciona una ruta", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        return;
      }

      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/tarifas/ruta/${rutaId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ precioGeneral, precioEstudiante }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message);
        Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: "Tarifa actualizada para la ruta" });
        cargarTarifas();
        formTarifaRuta.reset();
      } catch (error) {
        Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      }
    });
  }

  document.addEventListener("click", (e) => {
    const btnEliminar = e.target.closest(".btn-eliminar-tarifa");
    if (btnEliminar) {
      const rutaId = btnEliminar.dataset.id;
      eliminarTarifaRuta(rutaId);
    }
  });

  async function eliminarTarifaRuta(rutaId) {
    const confirm = await Swal.fire({
      title: "¿Eliminar tarifa?",
      text: "La ruta usará la tarifa global.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Sí, eliminar",
      cancelButtonText: "Cancelar",
      background: "#1e1e1e", color: "#fff", confirmButtonColor: "#ef4444"
    });
    if (!confirm.isConfirmed) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/taquilla/tarifas/ruta/${rutaId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error");
      Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" }).fire({ icon: "success", title: "Tarifa eliminada" });
      cargarTarifas();
    } catch (error) {
      Swal.fire({ icon: "error", title: "Error", text: error.message, background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
    }
  }
});

async function cargarDashboardStats() {
  try {
    const token = localStorage.getItem("tecbus_token");
    const res = await fetch(`${BACKEND_URL}/api/camiones/estadisticas/hoy`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.ok) {
      const data = await res.json();

      // 1. Actualizar Tarjetas (KPIs)
      const kpiTotalKm = document.getElementById("kpi-total-km");
      if (kpiTotalKm) kpiTotalKm.textContent = `${data.resumen.totalKm} km`;
      
      const kpiMaxSpeed = document.getElementById("kpi-max-speed");
      if (kpiMaxSpeed) kpiMaxSpeed.textContent = data.resumen.topVelocidad;
      
      const kpiActiveUnits = document.getElementById("kpi-active-units");
      if (kpiActiveUnits) {
        kpiActiveUnits.textContent = data.resumen.totalUnidadesActivas;
      }
      // 2. Actualizar Tabla
      const tbody = document.getElementById("stats-table-body");
      if (tbody) tbody.innerHTML = ""; // Limpiar tabla

      data.detalles.forEach((d) => {
        const row = `
                    <tr>
                        <td><strong>${d.unidad}</strong></td>
                        <td>${d.km} km</td>
                        <td style="${d.velMax > 90 ? "color:red" : ""}">${
          d.velMax
        } km/h</td>
                        <td>${d.actualizado}</td>
                    </tr>
                `;
        if (tbody) tbody.innerHTML += row;
      });
    }
  } catch (error) {
    console.error("Error cargando stats:", error);
  }
}


// Función manual asignada directamente al botón
window.filtrarAlertasManual = function () {
  console.log("🚀 Iniciando filtrado manual...");

  // Validamos que existan los datos
  if (typeof alertasCargadas === "undefined") {
    console.error("Error: alertasCargadas no está definido");
    return;
  }

  const unidadEl = document.getElementById("search-alerta-unidad");
  const tipoEl = document.getElementById("search-alerta-tipo");
  const fechaEl = document.getElementById("search-alerta-fecha");

  // Evitamos errores si algún input no existe
  const unidad = unidadEl ? unidadEl.value.toLowerCase() : "";
  const tipo = tipoEl ? tipoEl.value.toLowerCase() : "";
  const fechaInput = fechaEl ? fechaEl.value : "";

  const filtrados = alertasCargadas.filter((a) => {
    const matchUnidad =
      !unidad ||
      (a.camionUnidad && a.camionUnidad.toLowerCase().includes(unidad));
    const matchTipo =
      !tipo || (a.titulo && a.titulo.toLowerCase().includes(tipo));

    let matchFecha = true;
    if (fechaInput && a.createdAt) {
      const fechaAlerta = new Date(a.createdAt).toISOString().split("T")[0];
      matchFecha = fechaAlerta === fechaInput;
    }
    return matchUnidad && matchTipo && matchFecha;
  });

  renderTablaAlertas(filtrados);

  // Cerrar modal
  const modal = document.getElementById("search-alerta-modal");
  if (modal) modal.classList.remove("modal-visible");
};

// --- VISUALIZADOR DE RUTA (MODAL) ---
let previewMap = null;
window.previewMarkers = [];

document.addEventListener("click", (e) => {
    // Abrir Preview
    if (e.target.closest(".btn-preview-ruta")) {
        const btn = e.target.closest(".btn-preview-ruta");
        const rutaId = btn.getAttribute("data-id");
        mostrarPreviewRuta(rutaId);
    }
    
    // Cerrar Modales (Genérico)
    if (e.target.classList.contains("close-button") || e.target.classList.contains("close-modal")) {
        const modal = e.target.closest(".modal");
        if (modal) modal.style.display = "none";
    }
});

async function mostrarPreviewRuta(rutaId) {
    const modal = document.getElementById("route-preview-modal");
    if (!modal) return;
    
    modal.style.display = "flex";
    
    // Limpiar campos antes de cargar
    document.getElementById("preview-ruta-nombre").textContent = "Cargando...";
    document.getElementById("preview-ruta-distancia").textContent = "-- km";
    document.getElementById("preview-ruta-tiempo").textContent = "-- min";
    
    try {
        const tkn = localStorage.getItem("tecbus_token");
        const res = await fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, {
            headers: { Authorization: `Bearer ${tkn}` }
        });
        const ruta = await res.json();
        
        console.log("Ruta cargada para preview:", ruta);

        if (!ruta || ruta.error) throw new Error("No se pudo cargar la ruta");

        document.getElementById("preview-ruta-nombre").textContent = ruta.nombre || "Sin nombre";
        
        // El API usa distanciaTotal (metros) y tiempoEstimadoTotal (min)
        let distancia = ruta.distanciaTotal || ruta.distancia || ruta.distanciaKm || 0;
        if (distancia > 1000) distancia = (distancia / 1000).toFixed(1); // Convertir a km si es muy grande (m -> km)
        
        const tiempo = ruta.tiempoEstimadoTotal || ruta.tiempoEstimado || ruta.duracionMin || "N/D";
        
        document.getElementById("preview-ruta-distancia").textContent = distancia + " km";
        document.getElementById("preview-ruta-tiempo").textContent = tiempo + " min";

        // Inicializar mapa si no existe aún
        if (!previewMap) {
            previewMap = new maplibregl.Map({
                container: "route-preview-map",
                style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
                center: [-108.4716, 25.5727],
                zoom: 12
            });
            // Observar cambios de tamaño en el modal
            const observer = new ResizeObserver(() => {
                window.requestAnimationFrame(() => {
                    if (previewMap) previewMap.resize();
                });
            });
            const mapContainer = document.getElementById("route-preview-map");
            if (mapContainer) observer.observe(mapContainer);
        }

        const mapReady = async () => {
            // Limpiar capas y markers previos
            if (previewMap.getLayer('route')) previewMap.removeLayer('route');
            if (previewMap.getSource('route')) previewMap.removeSource('route');
            if (window.previewMarkers) {
                window.previewMarkers.forEach(m => m.remove());
            }
            window.previewMarkers = [];

            // El API devuelve paradas con ubicacion.coordinates = [lng, lat]
            const puntos = ruta.paradas || ruta.puntos || [];
            
            if (puntos.length > 0) {
                // Construir coords en formato GeoJSON [lng, lat]
                const coords = puntos.map(p => {
                    if (p.ubicacion && p.ubicacion.coordinates) {
                        return [p.ubicacion.coordinates[0], p.ubicacion.coordinates[1]];
                    }
                    // Fallback si viniera como {lng, lat}
                    return [parseFloat(p.lng), parseFloat(p.lat)];
                }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

                if (coords.length < 2) {
                    console.warn("No hay suficientes puntos para trazar la ruta");
                    return;
                }

                // --- NUEVO: Obtener trazado real por calles (OSRM) ---
                let finalCoords = coords;
                try {
                    const waypoints = coords.map(c => `${c[0]},${c[1]}`).join(';');
                    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${waypoints}?overview=full&geometries=geojson`;
                    const osrmRes = await fetch(osrmUrl);
                    const osrmData = await osrmRes.json();
                    
                    if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes[0]) {
                        finalCoords = osrmData.routes[0].geometry.coordinates;
                        console.log("🛣️ Trazado real obtenido de OSRM");
                    }
                } catch (err) {
                    console.warn("No se pudo obtener trazado real, usando líneas rectas:", err);
                }

                previewMap.addSource('route', {
                    'type': 'geojson',
                    'data': {
                        'type': 'Feature',
                        'properties': {},
                        'geometry': {
                            'type': 'LineString',
                            'coordinates': finalCoords
                        }
                    }
                });

                previewMap.addLayer({
                    'id': 'route',
                    'type': 'line',
                    'source': 'route',
                    'layout': { 'line-join': 'round', 'line-cap': 'round' },
                    'paint': { 'line-color': '#3498db', 'line-width': 6, 'line-opacity': 0.9 }
                });

                // Marcadores de inicio y fin
                const startMarker = new maplibregl.Marker({ color: '#2ecc71' })
                    .setLngLat(coords[0])
                    .setPopup(new maplibregl.Popup().setHTML("<b>🟢 Inicio</b>"))
                    .addTo(previewMap);
                
                const endMarker = new maplibregl.Marker({ color: '#e74c3c' })
                    .setLngLat(coords[coords.length - 1])
                    .setPopup(new maplibregl.Popup().setHTML("<b>🔴 Fin</b>"))
                    .addTo(previewMap);

                window.previewMarkers.push(startMarker, endMarker);

                // Ajustar vista al bounding box de la ruta
                const bounds = coords.reduce(
                    (acc, coord) => acc.extend(coord),
                    new maplibregl.LngLatBounds(coords[0], coords[0])
                );
                previewMap.fitBounds(bounds, { padding: 60, animate: true });
            } else {
                console.warn("La ruta no tiene puntos/paradas registradas");
                previewMap.setCenter([-108.4716, 25.5727]);
                previewMap.setZoom(11);
            }
        };

        if (previewMap.loaded()) {
            mapReady();
        } else {
            previewMap.once('load', mapReady);
        }

        // Forzar resize para evitar franja negra
        setTimeout(() => previewMap.resize(), 150);
        setTimeout(() => previewMap.resize(), 400);

    } catch (err) {
        console.error("Error cargando preview de ruta:", err);
        document.getElementById("preview-ruta-nombre").textContent = "Error al cargar";
    }
}

// --- ANALYTICS DASHBOARD (CHARTS) ---
let chartDemanda = null;
let chartFlota = null;
let chartAlertas = null;

function inicializarGraficos() {
    console.log("📊 Inicializando Gráficos...");
    
    // 1. Gráfico de Demanda (Líneas)
    const ctxDemanda = document.getElementById('chart-demanda');
    if (ctxDemanda) {
        if (chartDemanda) chartDemanda.destroy();
        chartDemanda = new Chart(ctxDemanda, {
            type: 'line',
            data: {
                labels: ['06:00', '08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'],
                datasets: [{
                    label: 'Pasajeros Esperando',
                    data: [12, 45, 30, 65, 80, 40, 55, 20],
                    borderColor: '#007bff',
                    backgroundColor: 'rgba(0, 123, 255, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
                    x: { grid: { display: false }, ticks: { color: '#888' } }
                }
            }
        });
    }

    // 2. Gráfico de Flota (Barras)
    const ctxFlota = document.getElementById('chart-flota');
    if (ctxFlota) {
        if (chartFlota) chartFlota.destroy();
        chartFlota = new Chart(ctxFlota, {
            type: 'bar',
            data: {
                labels: ['TEC-01', 'TEC-02', 'TEC-03', 'TEC-04', 'TEC-05'],
                datasets: [{
                    label: 'KM Recorridos',
                    data: [120, 85, 150, 95, 110],
                    backgroundColor: '#2ed573',
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888' } },
                    x: { grid: { display: false }, ticks: { color: '#888' } }
                }
            }
        });
    }

    // 3. Gráfico de Alertas (Doughnut)
    const ctxAlertas = document.getElementById('chart-alertas');
    if (ctxAlertas) {
        if (chartAlertas) chartAlertas.destroy();
        chartAlertas = new Chart(ctxAlertas, {
            type: 'doughnut',
            data: {
                labels: ['SOS', 'Retrasos', 'Mecánico', 'Otros'],
                datasets: [{
                    data: [5, 12, 3, 8],
                    backgroundColor: ['#ff4757', '#ffa502', '#2f3542', '#ced4da'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom', labels: { color: '#888', padding: 20 } }
                },
                cutout: '70%'
            }
        });
    }
}

// Escuchar cambios de pestaña para refrescar gráficos
document.addEventListener("click", (e) => {
    const link = e.target.closest(".nav-item");
    // Solo actualizar si hacemos clic en el link de estadísticas
    if (link && link.getAttribute("href") === "#estadisticas") {
        setTimeout(() => {
            if (!chartDemanda) {
                inicializarGraficos();
            }
            // Eliminamos actualizarDatosGraficos() para que sea estático
        }, 150);
    }
});

async function actualizarDatosGraficos() {
    // Función desactivada para mantener datos estáticos
    console.log("📊 Datos estáticos mantenidos.");
}

if (window.location.hash === "#estadisticas") {
    setTimeout(inicializarGraficos, 500);
}
