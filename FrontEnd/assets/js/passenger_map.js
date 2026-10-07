// frontend/assets/js/student_map.js

// ============================================================
// 1. CONFIGURACIÓN GLOBAL Y UTILIDADES
// ============================================================

// Clave Pública VAPID (Debe coincidir con la privada del Backend)
const PUBLIC_VAPID_KEY = "BB2W0pmQXVhTWikH1YxYYJb2hMGjqU5aAechud7OzKxJiKH9-8_jWnygraHnh7WzlpuwwXWmLDUI65eosU6cZSs";

// Utilidad para convertir la clave VAPID
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// ============================================================
// 2. LÓGICA PRINCIPAL (DOM LOADED)
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  
  // --- A. VERIFICACIÓN DE SESIÓN ---
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "login.html";
    return;
  }

  const user = JSON.parse(userString);

  // Validación de Rol
  if (user.tipo !== "estudiante") {
    if (user.tipo === "administrador") window.location.href = "admin.html";
    else if (user.tipo === "conductor") window.location.href = "conductor.html";
    return;
  }

  // --- B. MARCAR COMO ACTIVO AL ENTRAR ---
  // Esto asegura que si refresca la página, vuelva a estar "activo"
  if (user && user.tipo === "estudiante") {
      const userId = user._id || user.id;
      fetch(`${BACKEND_URL}/api/users/${userId}`, {
          method: 'PUT',
          headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}` 
          },
          body: JSON.stringify({ estado: "activo" }) 
      }).catch(err => console.error("Error activando estudiante:", err));
  }

  // --- C. BOTÓN DE NOTIFICACIONES ---
  const btnNotif = document.getElementById("btn-activar-notificaciones");
  if (btnNotif) {
    const newBtn = btnNotif.cloneNode(true);
    btnNotif.parentNode.replaceChild(newBtn, btnNotif);
    newBtn.addEventListener("click", activarNotificaciones);
    console.log("✅ Botón de notificaciones activado");
  }

  // ============================================================
  // 3. CONFIGURACIÓN DEL MAPA
  // ============================================================
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;

  // Conexión Socket.IO
  const socket = io(SOCKET_URL);

  let busMarkers = {};
  let rutaPolyline = null;
  let currentRouteId = "";
  let stopMarkers = [];
  let selectedStopCoords = null;
  let selectedStopName = "";

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [initialLng, initialLat],
    zoom: initialZoom,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  let userMarker = null;
  let userLocationCoords = null;

  function centrarMapaEnUsuario(autoSelectStop = false) {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        const { latitude, longitude } = position.coords;
        userLocationCoords = [longitude, latitude];
        
        // Crear o actualizar marcador de usuario
        if (!userMarker) {
          const el = document.createElement('div');
          el.className = 'user-location-marker';
          el.innerHTML = '<div class="pulse-dot"></div>';
          userMarker = new maplibregl.Marker(el)
            .setLngLat([longitude, latitude])
            .addTo(map);
        } else {
          userMarker.setLngLat([longitude, latitude]);
        }

        if (!autoSelectStop) {
          map.flyTo({
            center: [longitude, latitude],
            zoom: 16,
            essential: true
          });
        } else if (currentRouteId) {
          // Si estamos auto-seleccionando por cambio de ruta
          seleccionarParadaMasCercana();
        }
      }, (err) => {
        console.warn("Error obteniendo ubicación:", err);
      });
    }
  }

  // Intentar obtener ubicación al inicio para tenerla lista
  centrarMapaEnUsuario(false);

  const btnCenterLoc = document.getElementById("btn-center-location");
  if (btnCenterLoc) {
    btnCenterLoc.addEventListener("click", () => centrarMapaEnUsuario(false));
  }

  // --- CAMBIO DE ESTILO DE MAPA ---
  let isSatellite = false;
  const btnToggleMap = document.getElementById("btn-toggle-map-style");
  if (btnToggleMap) {
    btnToggleMap.addEventListener("click", () => {
      isSatellite = !isSatellite;
      const newStyle = isSatellite 
        ? {
            "version": 8,
            "sources": {
              "satellite": {
                "type": "raster",
                "tiles": ["https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"],
                "tileSize": 256
              }
            },
            "layers": [{
              "id": "satellite",
              "type": "raster",
              "source": "satellite"
            }]
          }
        : "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

      map.setStyle(newStyle);
      
      // Re-dibujar elementos tras el cambio de estilo
      map.once('styledata', () => {
        if (currentRouteId) dibujarRuta(currentRouteId);
        fetchAndUpdateBuses();
      });

      btnToggleMap.querySelector('i').className = isSatellite ? "fas fa-map" : "fas fa-layer-group";
      btnToggleMap.style.color = isSatellite ? "var(--color-primario)" : "white";
    });
  }

  // --- ALTERNAR VISTA 3D ---
  let is3D = false;
  const btnToggle3D = document.getElementById("btn-toggle-3d");
  if (btnToggle3D) {
    btnToggle3D.addEventListener("click", () => {
      is3D = !is3D;
      map.easeTo({
        pitch: is3D ? 60 : 0,
        bearing: is3D ? -15 : 0,
        duration: 1000
      });
      btnToggle3D.style.color = is3D ? "var(--color-primario)" : "white";
      btnToggle3D.querySelector('i').style.transform = is3D ? "rotateX(45deg)" : "none";
    });
  }

  // Funciones creadoras de elementos para los marcadores
  function createBusElement(camionId) {
    const el = document.createElement('div');
    el.className = "custom-bus-icon";
    el.style.cursor = "pointer";
    el.innerHTML = `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; color: white; border: 2px solid white; font-size: 14px; box-shadow: 0 0 15px var(--color-primario); transition: all 0.3s ease;"><i class="fas fa-bus"></i></div>`;
    
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      mostrarDetallesCamion(camionId);
    });
    
    return el;
  }

  function mostrarDetallesCamion(camionId) {
    const section = document.getElementById("bus-details-section");
    if (!camionId) {
      if (section) section.classList.add("hidden");
      return;
    }

    fetch(`${BACKEND_URL}/api/camiones/${camionId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(camion => {
      const plateEl = document.getElementById("bus-plate");
      const driverEl = document.getElementById("bus-driver");
      
      if (plateEl) plateEl.textContent = `${camion.numeroUnidad || 'N/A'} - ${camion.placa || '---'}`;
      if (driverEl) driverEl.textContent = camion.conductorActual?.nombre || "Conductor SmartBus";
      
      if (section) section.classList.remove("hidden");
    })
    .catch(err => console.error("Error al obtener datos del camión:", err));
  }

  function createStudentElement() {
    const el = document.createElement('div');
    el.className = "student-icon";
    el.innerHTML = `<div style="background-color: #ffc107; color: #000; width: 35px; height: 35px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 8px rgba(0,0,0,0.4); font-size: 16px;"><i class="fas fa-street-view"></i></div>`;
    return el;
  }

  // ============================================================
  // 4. LÓGICA DE PERFIL (MODAL)
  // ============================================================
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilSidebar = document.getElementById("btn-open-perfil-sidebar");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnClosePerfil = document.getElementById("btn-perfil-close");
  const profileMenu = document.getElementById("profile-menu");
  const profileToggle = document.getElementById("profile-toggle");
  const userNameDisplay = document.getElementById("user-name-display");

  if (userNameDisplay) userNameDisplay.textContent = user.nombre.split(" ")[0];

  function abrirPerfil() {
    document.getElementById("perfil-nombre-completo").textContent = user.nombre || "Usuario";
    document.getElementById("perfil-correo").textContent = user.email || user.correo || "No registrado";
    
    let idMostrar = "Sin Identificador";
    
    const esValido = (texto) => texto && texto !== "PENDIENTE" && texto.trim() !== "";

    if (user.estudiante && esValido(user.estudiante.matricula)) {
        idMostrar = user.estudiante.matricula;
    } 
    else if (esValido(user.matricula)) {
        idMostrar = user.matricula; 
    }
    else if (user._id || user.id) {
        idMostrar = (user._id || user.id);
    }

    document.getElementById("perfil-id").textContent = idMostrar;

    // Fetch saldo y transacciones
    fetch(`${BACKEND_URL}/api/transacciones/saldo`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      document.getElementById("perfil-saldo").textContent = `$${parseFloat(data.saldo || 0).toFixed(2)}`;
      document.getElementById("perfil-tipo-tarifa").textContent = data.es_estudiante ? "Estudiante" : "General";
    })
    .catch(() => {
      document.getElementById("perfil-saldo").textContent = "$--";
    });

    fetch(`${BACKEND_URL}/api/transacciones/mias`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(transacciones => {
      const container = document.getElementById("perfil-transacciones");
      if (transacciones.length === 0) {
        container.innerHTML = '<p style="color: #666; text-align: center; font-size: 0.85rem; margin: 10px 0;">Sin transacciones</p>';
        return;
      }
      container.innerHTML = transacciones.slice(0, 10).map(t => {
        const fecha = new Date(t.timestamp).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
        const hora = new Date(t.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
        return `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.05); font-size:0.8rem;">
          <div>
            <span style="color:#aaa;">${fecha} ${hora}</span>
            <span style="color:#888; margin-left:6px;">${t.rutaId?.nombre || ""}</span>
          </div>
          <span style="color:var(--color-error); font-weight:700;">-$${parseFloat(t.monto).toFixed(2)}</span>
        </div>`;
      }).join("");
    })
    .catch(() => {
      document.getElementById("perfil-transacciones").innerHTML = '<p style="color: #666; text-align: center; font-size: 0.85rem;">Error al cargar</p>';
    });

    document.getElementById("sidebar").classList.remove("active");
    if (profileMenu) profileMenu.classList.remove("show");
    modalPerfil.classList.add("show");
  }

  if (btnOpenPerfilSidebar) btnOpenPerfilSidebar.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnOpenPerfilHeader) btnOpenPerfilHeader.addEventListener("click", (e) => { e.preventDefault(); abrirPerfil(); });
  if (btnClosePerfil) btnClosePerfil.addEventListener("click", () => modalPerfil.classList.remove("show"));

  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }

  // ==========================================
  // LÓGICA PARA CERRAR SESIÓN (NUEVO MODAL)
  // ==========================================
  function handleLogout(e) {
    e.preventDefault();
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("active");
    
    document.getElementById("modal-logout").classList.add("show");
  }

  window.cerrarModalLogout = function() {
    document.getElementById("modal-logout").classList.remove("show");
  };

  window.ejecutarLogout = function() {
    const btnSalir = document.querySelector("#modal-logout .btn-error-lg");
    if (btnSalir) {
        btnSalir.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saliendo...';
        btnSalir.disabled = true;
    }

    const userId = user._id || user.id;
    
    // Intentar marcar como inactivo antes de borrar token
    fetch(`${BACKEND_URL}/api/users/${userId}`, {
        method: 'PUT',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ estado: "inactivo" }) 
    }).finally(() => {
        localStorage.removeItem("tecbus_token");
        localStorage.removeItem("tecbus_user");
        window.location.href = "login.html";
    });
  };

  const logoutBtn = document.getElementById("logout-button");
  const sidebarLogout = document.getElementById("sidebar-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
  if (sidebarLogout) sidebarLogout.addEventListener("click", handleLogout);

  // ============================================================
  // 5. MENÚ LATERAL Y UI GENERAL
  // ============================================================
  const sidebar = document.getElementById("sidebar");
  const actionPanel = document.querySelector(".action-panel");
  const overlay = document.getElementById("overlay");
  const btnMenuToggle = document.getElementById("btn-menu-toggle");
  const btnMenuClose = document.getElementById("btn-menu-close");

  if (btnMenuToggle) btnMenuToggle.addEventListener("click", () => sidebar.classList.add("active"));
  if (btnMenuClose) btnMenuClose.addEventListener("click", () => sidebar.classList.remove("active"));

  // Cerrar modales al hacer clic fuera
  window.addEventListener("click", (e) => {
    if (e.target === modalPerfil) modalPerfil.classList.remove("show");
    if (modalHistorial && e.target === modalHistorial) modalHistorial.classList.remove("show");
    if (sidebar.classList.contains("active") && !sidebar.contains(e.target) && !e.target.closest("#btn-menu-toggle")) {
      sidebar.classList.remove("active");
    }
    if (profileMenu && profileMenu.classList.contains("show") && !profileMenu.contains(e.target) && !e.target.closest("#profile-toggle")) {
      profileMenu.classList.remove("show");
    }
  });

  // ============================================================
  // 6. HISTORIAL Y CALENDARIO
  // ============================================================
  const modalHistorial = document.getElementById("modal-historial");
  const btnVerHistorial = document.getElementById("btn-ver-historial");
  const btnCerrarHistorial = document.getElementById("btn-historial-close");

  async function registrarBusqueda(rutaId) {
    if (!rutaId) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = { lat: position.coords.latitude, lng: position.coords.longitude };
          enviarBusquedaAlBackend(rutaId, location);
        },
        () => enviarBusquedaAlBackend(rutaId, null)
      );
    } else {
      enviarBusquedaAlBackend(rutaId, null);
    }
  }

  async function enviarBusquedaAlBackend(rutaId, location) {
    try {
      await fetch(`${BACKEND_URL}/api/historial`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ rutaId, location }),
      });
      console.log("🔍 Búsqueda registrada.");
    } catch (error) { console.error("Error historial:", error); }
  }

  const abrirHistorial = async () => {
    modalHistorial.classList.add("show");
    const container = document.getElementById("historial-list-container");
    container.innerHTML = '<p class="horario-vacio"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';

    try {
      const response = await fetch(`${BACKEND_URL}/api/historial`, { headers: { Authorization: `Bearer ${token}` } });
      const historial = await response.json();

      if (historial.length === 0) {
        container.innerHTML = '<p class="horario-vacio">No hay búsquedas recientes.</p>';
        return;
      }

      let html = "";
      historial.forEach((item) => {
        const fecha = new Date(item.createdAt).toLocaleDateString();
        const origenTexto = item.ubicacionOrigen ? "📍 Ubicación registrada" : "📍 Ubicación desconocida";
        html += `<div class="horario-item" style="flex-direction: column; align-items: flex-start;">
                  <div style="display:flex; justify-content:space-between; width:100%">
                      <span class="horario-hora" style="color:var(--color-primario); font-weight:bold;">${item.ruta.nombre}</span>
                      <span class="horario-camion" style="font-size:0.85rem;">${fecha} - ${item.horaBusqueda}</span>
                  </div>
                  <small style="color:#888; margin-top:4px;">${origenTexto}</small>
                 </div>`;
      });
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = '<p class="horario-vacio" style="color: #ff6b6b;">Error cargando historial.</p>';
    }
  };

  if (btnVerHistorial) btnVerHistorial.addEventListener("click", (e) => { e.preventDefault(); abrirHistorial(); });
  const btnVerHistorialCard = document.getElementById("btn-ver-historial-card");
  if (btnVerHistorialCard) btnVerHistorialCard.addEventListener("click", (e) => { e.preventDefault(); abrirHistorial(); });


  if (btnCerrarHistorial) btnCerrarHistorial.addEventListener("click", () => modalHistorial.classList.remove("show"));

  // --- CALENDARIO ---
  const fullscreenHorarios = document.getElementById("fullscreen-horarios");
  const btnAbrirHorarios = document.getElementById("btn-open-horarios");
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const selectRutaCalendar = document.getElementById("calendar-ruta-selector");
  const calendarGrid = document.getElementById("calendario-semanal");

  if (btnAbrirHorarios) {
    btnAbrirHorarios.addEventListener("click", (e) => {
      e.preventDefault();
      sidebar.classList.remove("active");
      fullscreenHorarios.classList.add("active");
      cargarRutasEnSelector(selectRutaCalendar);
    });
  }
  if (btnCerrarHorarios) btnCerrarHorarios.addEventListener("click", () => fullscreenHorarios.classList.remove("active"));

  if (selectRutaCalendar) {
    selectRutaCalendar.addEventListener("change", async (e) => {
      const rutaId = e.target.value;
      if (!rutaId) { calendarGrid.innerHTML = '<p class="placeholder-text">Selecciona una ruta.</p>'; return; }
      registrarBusqueda(rutaId);
      calendarGrid.innerHTML = '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando...</p>';
      try {
        const response = await fetch(`${BACKEND_URL}/api/horarios/publico/${rutaId}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error("Error");
        const horarios = await response.json();

        // Unidades de la ruta (asignación del camión). Se usan solo como
        // respaldo informativo cuando un horario no trae camión.
        let unidadesRuta = [];
        try {
          const resCam = await fetch(`${BACKEND_URL}/api/camiones/por-ruta/${rutaId}`, { headers: { Authorization: `Bearer ${token}` } });
          if (resCam.ok) {
            const cams = await resCam.json();
            unidadesRuta = cams.map(c => c.numeroUnidad);
          }
        } catch (_) {}

        dibujarCalendario(horarios, unidadesRuta);
      } catch (error) {
        calendarGrid.innerHTML = '<p class="placeholder-text" style="color:red">Error al cargar calendario.</p>';
      }
    });
  }

  function dibujarCalendario(horarios, unidadesRuta = []) {
    const diasOrdenados = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const grupos = {};
    diasOrdenados.forEach((d) => (grupos[d] = []));
    horarios.forEach((h) => { if (grupos[h.diaSemana]) grupos[h.diaSemana].push(h); });

    calendarGrid.innerHTML = "";
    diasOrdenados.forEach((dia) => {
      const viajes = grupos[dia];
      let contenido = viajes.length === 0 ? '<div class="no-service">Sin servicio</div>' : "";
      viajes.forEach((v) => {
        // El horario es un dato informativo: la unidad puede venir del propio
        // horario o, si no, de las unidades asignadas a la ruta.
        const unidad = v.camionUnidad || unidadesRuta.join(", ") || "Sin unidad asignada";
        contenido += `<div class="cal-item"><span class="cal-time">${v.hora}</span><span class="cal-bus"><i class="fas fa-bus"></i> ${unidad}</span></div>`;
      });
      calendarGrid.innerHTML += `<div class="day-card"><div class="day-header"><h3>${dia}</h3></div><div class="day-body">${contenido}</div></div>`;
    });
  }

  // ============================================================
  // 7. FUNCIONES DEL MAPA (CORE)
  // ============================================================
  async function cargarRutasEnSelector(selectorElement) {
    if (selectorElement.options.length > 1) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/rutas`, { headers: { Authorization: `Bearer ${token}` } });
      const rutas = await response.json();
      
      const favs = JSON.parse(localStorage.getItem("tecbus_fav_routes") || "[]");
      
      // Separar favoritas de normales
      const favoritas = rutas.filter(r => favs.includes(r._id) && r.activa);
      const normales = rutas.filter(r => !favs.includes(r._id) && r.activa);

      selectorElement.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
      
      if (favoritas.length > 0) {
        selectorElement.innerHTML += '<optgroup label="⭐ Mis Favoritas">';
        favoritas.forEach(r => selectorElement.innerHTML += `<option value="${r._id}">${r.nombre}</option>`);
        selectorElement.innerHTML += '</optgroup>';
      }

      selectorElement.innerHTML += '<optgroup label="Todas las Rutas">';
      normales.forEach(r => selectorElement.innerHTML += `<option value="${r._id}">${r.nombre}</option>`);
      selectorElement.innerHTML += '</optgroup>';
    } catch (error) { console.error(error); }
  }

  const mapRutaSelector = document.getElementById("ruta-selector");
  if (mapRutaSelector) {
    cargarRutasEnSelector(mapRutaSelector);
    mapRutaSelector.addEventListener("change", (e) => {
      currentRouteId = e.target.value;
      registrarBusqueda(currentRouteId);
      dibujarRuta(currentRouteId);
      // Los camiones de la ruta se piden por la asignación del camión,
      // así que se recargan al cambiar de ruta.
      fetchAndUpdateBuses();
      mostrarTarjetaRuta(currentRouteId);
    });
  }

  function calcularDistanciaHaversine(coord1, coord2) {
    const R = 6371; // Radio de la Tierra en km
    const dLat = (coord2[1] - coord1[1]) * Math.PI / 180;
    const dLon = (coord2[0] - coord1[0]) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(coord1[1] * Math.PI / 180) * Math.cos(coord2[1] * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function mostrarTarjetaRuta(rutaId) {
    const card = document.getElementById("route-info-card");
    
    // OCULTAR PANEL GLOBAL AL INSTANTE si hay una ruta
    if (rutaId && actionPanel) {
      actionPanel.style.display = "none";
    }

    if (!rutaId) {
      card.classList.remove("show");
      card.classList.add("hidden");
      const btnRestore = document.getElementById("btn-restore-card");
      if (btnRestore) btnRestore.classList.add("hidden");

      // YA NO MOSTRAMOS EL actionPanel GLOBAL
      selectedStopCoords = null; // Resetear parada al cambiar ruta
      
      // Ocultar también detalles de camión si estaban abiertos
      const busSec = document.getElementById("bus-details-section");
      if (busSec) busSec.classList.add("hidden");
      
      return;
    }
    
    // ... resto de la lógica de llenado (distancia total, etc) que ya teníamos ...
    fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(ruta => {
        // (Mantengo tu lógica anterior de distancia total y duración de ruta completa)
        const paradas = ruta.paradas || [];
        const puntosParada = paradas.filter(p => p.tipo === 'parada_oficial' || !p.tipo);
        const puntosTrazo = paradas.filter(p => p.tipo === 'trazo');
        let distanciaTotal = 0;
        const puntosParaCalculo = puntosTrazo.length > 0 ? puntosTrazo : paradas;
        for (let i = 0; i < puntosParaCalculo.length - 1; i++) {
          distanciaTotal += calcularDistanciaHaversine(puntosParaCalculo[i].ubicacion.coordinates, puntosParaCalculo[i+1].ubicacion.coordinates);
        }
        if (distanciaTotal < 0.1) distanciaTotal = ruta.distanciaKm || 8.5;

        document.getElementById("card-route-name").textContent = ruta.nombre;
        document.getElementById("card-distance").textContent = `${distanciaTotal.toFixed(1)} km`;
        document.getElementById("card-duration").textContent = `${Math.round((distanciaTotal/85)*60 + puntosParada.length)} min`;
        
        actualizarETAReal();
        actualizarBadgeTrafico();
        
        // --- AUTO-SELECCIÓN DE PARADA CERCANA ---
        if (userLocationCoords) {
          seleccionarParadaMasCercana(puntosParada);
        }

        card.classList.remove("hidden");
        const btnRestore = document.getElementById("btn-restore-card");
        if (btnRestore) btnRestore.classList.add("hidden");
        
        // Ocultar sección de bus por defecto al cargar nueva ruta
        const busSec = document.getElementById("bus-details-section");
        if (busSec) busSec.classList.add("hidden");

        setTimeout(() => card.classList.add("show"), 10);
      });
  }

  function seleccionarParadaMasCercana(paradasDisponibles = null) {
    if (!userLocationCoords) return;
    
    // Si no nos pasan las paradas, no podemos hacer mucho aquí sin refactorizar
    // pero podemos intentar obtenerlas de la ruta actual si está cargada
    let paradas = paradasDisponibles;
    
    if (!paradas) {
        // Podríamos buscarlas en el DOM o re-fetch, pero lo ideal es hacerlo al cargar la tarjeta
        return;
    }

    let paradaCercana = null;
    let distMin = Infinity;

    paradas.forEach(p => {
      const dist = calcularDistanciaHaversine(userLocationCoords, p.ubicacion.coordinates);
      if (dist < distMin) {
        distMin = dist;
        paradaCercana = p;
      }
    });

    if (paradaCercana) {
      selectedStopCoords = paradaCercana.ubicacion.coordinates;
      selectedStopName = paradaCercana.nombre || "Parada Cercana";
      
      // Actualizar visualmente los marcadores
      stopMarkers.forEach(m => {
        const inner = m.getElement().querySelector('.stop-marker-inner');
        if (inner) inner.style.backgroundColor = '#ffc107';
        
        // Si las coordenadas coinciden, marcar como seleccionada
        const mCoords = m.getLngLat();
        if (mCoords.lng === selectedStopCoords[0] && mCoords.lat === selectedStopCoords[1]) {
           if (inner) inner.style.backgroundColor = 'var(--color-acento)';
        }
      });

      actualizarETAReal();
      console.log(`🤖 Auto-seleccionada: ${selectedStopName}`);
    }
  }

  function actualizarETAReal() {
    const etaEl = document.getElementById("card-eta");
    if (!selectedStopCoords) {
      etaEl.textContent = "Selecciona Parada";
      return;
    }
    
    // No forzamos fontSize por JS, dejamos que el CSS compacto mande


    // Buscar el bus más cercano de ESTA ruta
    let busMasCercano = null;
    let distanciaMinima = Infinity;

    Object.values(busMarkers).forEach(marker => {
      if (marker.rutaId === currentRouteId) {
        const busCoords = marker.getLngLat();
        const dist = calcularDistanciaHaversine([busCoords.lng, busCoords.lat], selectedStopCoords);
        if (dist < distanciaMinima) {
          distanciaMinima = dist;
          busMasCercano = marker;
        }
      }
    });

    if (busMasCercano) {
      // Velocidad urbana estimando tráfico y semáforos: 35 km/h
      const tiempoEstimado = Math.round((distanciaMinima / 35) * 60);
      etaEl.textContent = `${tiempoEstimado} min`;
      
      // --- NOTIFICACIÓN DE PROXIMIDAD ---
      if (distanciaMinima < 0.5 && !notificadoHoy) {
        enviarNotificacionProximidad(distanciaMinima);
      }
    } else {
      etaEl.textContent = "Sin autobuses";
    }
  }

  // Lógica del botón favoritos
  const btnFavRoute = document.getElementById("btn-fav-route");
  if (btnFavRoute) {
    btnFavRoute.addEventListener("click", () => {
      if (!currentRouteId) return;
      let favs = JSON.parse(localStorage.getItem("tecbus_fav_routes") || "[]");
      const icon = btnFavRoute.querySelector("i");
      
      if (favs.includes(currentRouteId)) {
        favs = favs.filter(id => id !== currentRouteId);
        btnFavRoute.classList.remove("active");
        icon.className = "far fa-star";
      } else {
        favs.push(currentRouteId);
        btnFavRoute.classList.add("active");
        icon.className = "fas fa-star";
      }
      
      localStorage.setItem("tecbus_fav_routes", JSON.stringify(favs));
      // Forzar recarga del selector para mostrar favoritos arriba
      const mapRutaSelector = document.getElementById("ruta-selector");
      if (mapRutaSelector) {
        mapRutaSelector.options.length = 1; // Resetear
        cargarRutasEnSelector(mapRutaSelector);
      }
    });
  }

  function actualizarBadgeTrafico() {
    const badge = document.getElementById("traffic-badge");
    if (!badge) return;
    
    const now = new Date();
    const hours = now.getHours();
    
    // Simulación de horas pico: 7-9, 13-15, 17-19
    const isPeak = (hours >= 7 && hours <= 9) || (hours >= 13 && hours <= 15) || (hours >= 17 && hours <= 19);
    
    if (isPeak) {
      badge.classList.add("busy");
      badge.querySelector("span").textContent = "Hora Pico";
      badge.querySelector("i").className = "fas fa-clock";
    } else {
      badge.classList.remove("busy");
      badge.querySelector("span").textContent = "Fluido";
      badge.querySelector("i").className = "fas fa-bolt";
    }
  }

  let notificadoHoy = false; // Simple flag para evitar spam
  async function enviarNotificacionProximidad(dist) {
    if (Notification.permission === "granted") {
        new Notification("🚍 SmartBus está cerca!", {
            body: `Tu autobús está a unos ${(dist*1000).toFixed(0)} metros. ¡Prepárate!`,
            icon: '/assets/img/icons/icon-192x192.png'
        });
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        notificadoHoy = true;
        // Resetear flag tras 5 min
        setTimeout(() => notificadoHoy = false, 300000);
    } else if (Notification.permission !== "denied") {
        const p = await Notification.requestPermission();
        if (p === "granted") enviarNotificacionProximidad(dist);
    }
  }

  // --- BIENVENIDA PERSONALIZADA ---
  const headerTitle = document.querySelector(".header-title h1");
  if (headerTitle && user.nombre) {
    const firstName = user.nombre.split(" ")[0];
    headerTitle.innerHTML = `Hola, ${firstName} <span style="color:var(--color-primario)">•</span>`;
  }

  // --- CLIMA ---
  async function actualizarClima() {
    try {
      // Usamos wttr.in que es gratuito y no requiere API Key
      const res = await fetch("https://wttr.in/Guasave?format=j1");
      const data = await res.json();
      const temp = data.current_condition[0].temp_C;
      const weatherDesc = data.current_condition[0].weatherDesc[0].value.toLowerCase();
      
      const tempEl = document.getElementById("weather-temp");
      const iconEl = document.querySelector("#weather-widget i");
      
      if (tempEl) tempEl.textContent = `${temp}°C`;
      
      // Actualizar icono según el clima
      if (iconEl) {
        if (weatherDesc.includes("cloud")) iconEl.className = "fas fa-cloud";
        else if (weatherDesc.includes("rain")) iconEl.className = "fas fa-cloud-showers-heavy";
        else iconEl.className = "fas fa-sun";
      }
    } catch (err) {
      console.log("Error al obtener clima:", err);
      // Fallback a un valor fijo si falla
      const tempEl = document.getElementById("weather-temp");
      if (tempEl) tempEl.textContent = "32°C";
    }
  }
  actualizarClima();

  async function dibujarRuta(rutaId) {
    try {
      if (map.getLayer("ruta-layer")) map.removeLayer("ruta-layer");
      if (map.getSource("ruta-source")) map.removeSource("ruta-source");
      stopMarkers.forEach(m => m.remove());
      stopMarkers = [];
      
      if (!rutaId) return;

      const response = await fetch(`${BACKEND_URL}/api/rutas/${rutaId}`, { headers: { Authorization: `Bearer ${token}` } });
      const ruta = await response.json();
      if (!ruta.paradas || ruta.paradas.length === 0) return;

      const puntosTrazo = ruta.paradas.filter(p => p.tipo === 'trazo');
      const puntosParada = ruta.paradas.filter(p => p.tipo === 'parada_oficial' || !p.tipo);
      
      let coordsForBounds = [];

      if (puntosTrazo.length > 0) {
        const coords = puntosTrazo.map((p) => [p.ubicacion.coordinates[0], p.ubicacion.coordinates[1]]);
        coordsForBounds = coords;
        
        map.addSource('ruta-source', {
          'type': 'geojson',
          'data': { 'type': 'Feature', 'properties': {}, 'geometry': { 'type': 'LineString', 'coordinates': coords } }
        });

        map.addLayer({
          'id': 'ruta-layer',
          'type': 'line',
          'source': 'ruta-source',
          'layout': { 'line-join': 'round', 'line-cap': 'round' },
          'paint': { 'line-color': '#007bff', 'line-width': 6, 'line-opacity': 0.8 }
        });
      } else {
        const coordsString = puntosParada.map(p => `${p.ubicacion.coordinates[0]},${p.ubicacion.coordinates[1]}`).join(';');
        const osrmRes = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`);
        const osrmData = await osrmRes.json();
        if(osrmData.routes && osrmData.routes.length > 0) {
            const routeGeometry = osrmData.routes[0].geometry;
            coordsForBounds = routeGeometry.coordinates;
            map.addSource('ruta-source', {
              'type': 'geojson',
              'data': { 'type': 'Feature', 'properties': {}, 'geometry': routeGeometry }
            });
            map.addLayer({
              'id': 'ruta-layer',
              'type': 'line',
              'source': 'ruta-source',
              'layout': { 'line-join': 'round', 'line-cap': 'round' },
              'paint': { 'line-color': '#007bff', 'line-width': 6, 'line-opacity': 0.8 }
            });
        }
      }

      puntosParada.forEach(p => {
          const container = document.createElement('div');
          container.className = 'stop-marker-container';
          
          const stopEl = document.createElement('div');
          stopEl.className = 'stop-marker-inner';
          stopEl.style.cssText = 'background-color:#ffc107; border:2px solid white; width:16px; height:16px; border-radius:50%; box-shadow:0 0 10px rgba(0,0,0,0.5); cursor:pointer; transition: all 0.2s ease;';
          
          container.appendChild(stopEl);

          // Escalar el elemento interno, no el contenedor (para no romper la posición del mapa)
          container.addEventListener('mouseenter', () => stopEl.style.transform = 'scale(1.4)');
          container.addEventListener('mouseleave', () => stopEl.style.transform = 'scale(1)');

          const popup = new maplibregl.Popup({ offset: 10 }).setHTML(`🚏 <strong>${p.nombre || "Parada"}</strong><br><small>Haz clic para esperar aquí</small>`);
          const marker = new maplibregl.Marker({ element: container })
              .setLngLat([p.ubicacion.coordinates[0], p.ubicacion.coordinates[1]])
              .setPopup(popup)
              .addTo(map);

          // Lógica al seleccionar la parada
          container.addEventListener('click', () => {
            selectedStopCoords = p.ubicacion.coordinates;
            selectedStopName = p.nombre || "Parada seleccionada";
            actualizarETAReal();
            
            // Efecto visual de selección en el elemento interno
            stopMarkers.forEach(m => {
              const inner = m.getElement().querySelector('.stop-marker-inner');
              if (inner) inner.style.backgroundColor = '#ffc107';
            });
            stopEl.style.backgroundColor = 'var(--color-acento)';
            
            // No alertar cada vez, mejor actualizar la tarjeta
          });

          stopMarkers.push(marker);
      });
      
      if (coordsForBounds.length > 0) {
        const bounds = coordsForBounds.reduce(function(b, coord) {
          return b.extend(coord);
        }, new maplibregl.LngLatBounds(coordsForBounds[0], coordsForBounds[0]));
        map.fitBounds(bounds, { padding: 50 });
      }
    } catch (error) { console.error(error); }
  }

  async function fetchAndUpdateBuses() {
    try {
      // Si hay ruta seleccionada, se piden solo sus camiones.
      // La fuente es la asignación del camión, NO el horario.
      const url = currentRouteId
        ? `${BACKEND_URL}/api/camiones/por-ruta/${currentRouteId}`
        : `${BACKEND_URL}/api/camiones`;

      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Error");
      const camiones = await response.json();

      camiones.forEach((camion) => {
        const estadosVisibles = ["activo", "En Servicio", "Abordando"];
    
        if (!estadosVisibles.includes(camion.estado) || !camion.ubicacionActual) {
            return;
        }
        const rutaId = camion.rutaAsignada
          ? camion.rutaAsignada._id || camion.rutaAsignada
          : null;

        if (busMarkers[camion._id]) {
          busMarkers[camion._id].setLngLat([camion.ubicacionActual.coordinates[0], camion.ubicacionActual.coordinates[1]]);
          busMarkers[camion._id].rutaId = rutaId;
        } else {
          const nombreRuta = camion.rutaAsignada ? camion.rutaAsignada.nombre : "Sin asignar";
          const nombreConductor = camion.conductorActual?.nombre || "Conductor SmartBus";
          const popup = new maplibregl.Popup({ offset: 15 })
            .setHTML(`🚍 **${camion.numeroUnidad}**<br>Ruta: ${nombreRuta}<br>Conductor: ${nombreConductor}`);
          const marker = new maplibregl.Marker({ element: createBusElement(camion._id) })
            .setLngLat([camion.ubicacionActual.coordinates[0], camion.ubicacionActual.coordinates[1]])
            .setPopup(popup);
            
          marker.rutaId = rutaId;
          busMarkers[camion._id] = marker;
        }
      });
      filtrarCamionesEnMapa();
    } catch (error) { console.error(error); }
  }

  function filtrarCamionesEnMapa() {
    Object.values(busMarkers).forEach((marker) => {
      if (!currentRouteId) { marker.remove(); return; }
      if (marker.rutaId === currentRouteId) {
        marker.addTo(map);
      } else {
        marker.remove();
      }
    });
  }

  // --- SOCKETS ---
  socket.on("locationUpdate", (data) => {
    const marker = busMarkers[data.camionId];
    if (marker) {
      marker.setLngLat([data.location.lng, data.location.lat]);
      // Si el bus que se movió es de la ruta actual, refrescar el ETA
      if (marker.rutaId === currentRouteId) {
        actualizarETAReal();
      }
    } else {
      fetchAndUpdateBuses();
    }
  });

  socket.on("studentWaiting", (data) => {
      console.log("🙋‍♂️ Estudiante esperando:", data);
      
      const popup = new maplibregl.Popup({ offset: 15 }).setHTML("<strong>¡Pasajero Aquí!</strong>");
      const marker = new maplibregl.Marker({ element: createStudentElement() })
          .setLngLat([data.location.lng, data.location.lat])
          .setPopup(popup)
          .addTo(map);
          
      marker.togglePopup();
      
      if (data.userId === user.id || data.userId === user._id) {
          map.jumpTo({ center: [data.location.lng, data.location.lat], zoom: 16 });
      }
      setTimeout(() => marker.remove(), 300000); 
  });

  socket.on("smartAlert", (data) => alert(`🤖 ALERTA: ${data.mensaje}`));

  // --- ALERTA DE INCIDENTE ENVIADA POR EL CONDUCTOR ---
  function escaparHTML(valor) {
    return String(valor == null ? "" : valor)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const ICONOS_INCIDENTE = {
    Trafico: "fa-car",
    Accidente: "fa-car-crash",
    Bloqueo: "fa-ban",
    Flla: "fa-wrench",
    Otro: "fa-exclamation-triangle",
  };

  // Mismas etiquetas que muestra el select del panel del conductor
  const ETIQUETAS_INCIDENTE = {
    Trafico: "Tráfico Pesado",
    Accidente: "Accidente en Vía",
    Bloqueo: "Calle Bloqueada",
    Flla: "Falla Mecánica",
    Otro: "Otro Incidente",
  };

  function mostrarToastIncidente({ titulo, mensaje, tipo }) {
    const contenedor = document.getElementById("toast-container");
    if (!contenedor) return;

    // Máximo 3 avisos a la vez: si hay más, cerramos el más viejo
    while (contenedor.children.length >= 3) {
      contenedor.removeChild(contenedor.firstElementChild);
    }

    const icono = ICONOS_INCIDENTE[tipo] || "fa-exclamation-triangle";
    const toast = document.createElement("div");
    toast.className = "toast-alerta";
    toast.innerHTML =
      `<i class="fas ${icono} toast-icono"></i>` +
      `<div class="toast-cuerpo">` +
      `<p class="toast-titulo">${titulo}</p>` +
      `<p class="toast-mensaje">${mensaje}</p>` +
      `</div>` +
      `<button class="toast-cerrar" type="button" aria-label="Cerrar aviso">&times;</button>`;

    const cerrar = () => {
      if (toast.classList.contains("toast-out")) return;
      toast.classList.add("toast-out");
      setTimeout(() => toast.remove(), 320);
    };

    toast.querySelector(".toast-cerrar").addEventListener("click", cerrar);
    contenedor.appendChild(toast);
    setTimeout(cerrar, 7000);
  }

  socket.on("newIncidentAlert", (data) => {
    // Si el camión no tiene ruta asignada no sabemos a quién avisar
    if (!data.rutaId) return;

    // Solo avisamos de la ruta que el pasajero está viendo en este momento.
    // (Si no tiene ninguna ruta elegida, sí mostramos el aviso.)
    if (currentRouteId && String(data.rutaId) !== String(currentRouteId)) return;

    const unidad = data.numeroUnidad || data.camionId || "Unidad";
    const titulo = `⚠️ Alerta en ${escaparHTML(unidad)}`;

    const partes = [];
    if (data.rutaNombre) partes.push(`Ruta ${escaparHTML(data.rutaNombre)}`);
    if (data.detalles) partes.push(escaparHTML(data.detalles));

    const mensaje =
      escaparHTML(ETIQUETAS_INCIDENTE[data.tipo] || data.tipo || "Incidente") +
      (partes.length ? ` — ${partes.join(" · ")}` : "");

    mostrarToastIncidente({ titulo, mensaje, tipo: data.tipo });
  });

  // Actualizar saldo en tiempo real cuando ocurre un cobro
  socket.on("nuevaTransaccion", (data) => {
    if (!data.usuarioId?._id && !data.usuarioId?.nombre) {
      const uid = user._id || user.id;
      if (String(data.usuarioId) !== String(uid)) return;
    }
    // Recargar saldo automáticamente
    fetch(`${BACKEND_URL}/api/transacciones/saldo`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(d => {
      const el = document.getElementById("perfil-saldo");
      if (el && el.closest(".modal.show")) {
        el.textContent = `$${parseFloat(d.saldo || 0).toFixed(2)}`;
      }
    })
    .catch(() => {});
  });

  // --- BOTÓN ESTOY AQUÍ ---
  const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  
  const notificarParada = (btn) => {
      // 1. Validaciones de la Versión 2 (Más limpias)
      if (!window.isSecureContext && location.hostname !== "localhost") {
        alert("⚠️ GPS requiere HTTPS o localhost."); 
        return;
      }
      if (!("geolocation" in navigator)) { 
        alert("❌ Sin soporte GPS."); 
        return; 
      }

      // UI de carga
      const textoOriginal = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      btn.disabled = true;

      navigator.geolocation.getCurrentPosition(
        // --- CASO DE ÉXITO (Versión 2) ---
        (position) => {
          const myPos = { lat: position.coords.latitude, lng: position.coords.longitude };
          
          socket.emit("studentAtStop", {
            userId: user.id || user._id,
            rutaId: currentRouteId || "SIN_RUTA",
            location: myPos,
          });

          alert(`✅ Ubicación enviada al conductor.`);
          
          // Restaurar botón
          btn.innerHTML = textoOriginal;
          btn.disabled = false;
        },
        
        // --- MANEJO DE ERRORES (Traído de la Versión 1) ---
        (error) => {
          console.warn("Error GPS:", error);
          let mensajeError = "No se pudo obtener la ubicación.";

          switch (error.code) {
            case error.PERMISSION_DENIED:
              mensajeError = "⛔ Permiso denegado. Debes habilitar la ubicación en el icono del candado 🔒 de la barra de dirección.";
              break;
            case error.POSITION_UNAVAILABLE:
              mensajeError = "📡 La señal GPS es débil o no está disponible (¿Estás bajo techo?).";
              break;
            case error.TIMEOUT:
              mensajeError = "⏳ Se agotó el tiempo de espera para obtener el GPS.";
              break;
          }

          alert(`❌ Error: ${mensajeError}`);

          // Restaurar botón (Importante: mantener esto para que no se quede pegado)
          btn.innerHTML = textoOriginal;
          btn.disabled = false;
        },
        
        // Opciones de GPS
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
  };

  if (btnEstoyAqui) btnEstoyAqui.addEventListener("click", () => notificarParada(btnEstoyAqui));
  const btnEstoyAquiCard = document.getElementById("btn-estoy-aqui-card");
  if (btnEstoyAquiCard) btnEstoyAquiCard.addEventListener("click", () => notificarParada(btnEstoyAquiCard));


  // --- NOTIFICACIONES PUSH ---
  async function activarNotificaciones() {
    const deseaActivar = confirm(
      "¿Quieres recibir notificaciones cuando tu camión esté cerca?"
    );

    if (!deseaActivar) {
      console.log("🚫 Activación cancelada por el usuario.");
      return; // Se detiene aquí si dice que no
    }
    console.log("🚀 Iniciando activación de notificaciones...");

    // 1. Diagnóstico de Seguridad
    if (
      window.location.protocol === "http:" &&
      window.location.hostname !== "localhost" &&
      window.location.hostname !== "127.0.0.1"
    ) {
      alert(
        "⚠️ ERROR CRÍTICO DE SEGURIDAD:\n\nLas notificaciones NO funcionan en direcciones IP (http://192.168...). \n\nDebes usar 'localhost' o subirlo a un servidor seguro (https)."
      );
      return;
    }

    // 2. Diagnóstico de Soporte
    if (!("serviceWorker" in navigator)) {
      alert("❌ Tu navegador no soporta Service Workers.");
      return;
    }

    try {
      // 3. Solicitar Permiso
      const permission = await Notification.requestPermission();
      console.log("Permiso:", permission);

      if (permission !== "granted") {
        alert(
          "⛔ Permiso denegado. Tienes que habilitar las notificaciones manualmente en la configuración del sitio (candado 🔒)."
        );
        return;
      }

      // 4. Registrar Service Worker
      // INTENTO ROBUSTO: Probamos rutas comunes por si sw.js no está en la raíz
      let register;
      try {
        register = await navigator.serviceWorker.register("sw.js");
      } catch (e) {
        console.warn("Fallo ruta raíz, probando ../sw.js");
        register = await navigator.serviceWorker.register("../sw.js");
      }

      console.log("✅ Service Worker registrado:", register);
      await navigator.serviceWorker.ready;

      // 5. Suscribirse
      const subscription = await register.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
      });

      console.log("✅ Suscripción generada:", subscription);

      // 6. Guardar en Backend
      const token = localStorage.getItem("tecbus_token");
      const response = await fetch(
        `${BACKEND_URL}/api/notificaciones/suscribir`,
        {
          method: "POST",
          body: JSON.stringify(subscription),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok)
        throw new Error(`Error del Servidor: ${response.status}`);

      alert(
        "🎉 ¡ÉXITO! Notificaciones activadas.\n\nEn unos segundos deberías recibir una notificación de confirmación de la activación."
      );

      // 7. Prueba Inmediata
      await fetch(`${BACKEND_URL}/api/notificaciones/mi-prediccion-prueba`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (error) {
      console.error("❌ ERROR TÉCNICO DETALLADO:", error);
      // Esta alerta te dirá exactamente qué pasó
      alert(
        `❌ ERROR TÉCNICO:\n${error.name}: ${error.message}\n\n(Revisa la consola con F12 para más detalles)`
      );
    }
  }

  // Ayuda / Instrucciones
  const btnAyuda = document.getElementById("btn-abrir-ayuda");
  const modalInstrucciones = document.getElementById("fullscreen-instrucciones");
  const btnCerrarAyuda = document.getElementById("btn-cerrar-instrucciones");
  if (btnAyuda) btnAyuda.addEventListener("click", () => modalInstrucciones.classList.add("active"));
  if (btnCerrarAyuda) btnCerrarAyuda.addEventListener("click", () => modalInstrucciones.classList.remove("active"));

  // --- CERRAR / RESTAURAR TARJETA ---
  const btnCloseCard = document.getElementById("btn-close-card");
  const btnRestoreCard = document.getElementById("btn-restore-card");
  const routeCard = document.getElementById("route-info-card");

  if (btnCloseCard) {
    btnCloseCard.addEventListener("click", () => {
      routeCard.classList.remove("show");
      // Mantenemos actionPanel oculto porque la ruta sigue activa
      if (actionPanel) actionPanel.style.display = "none"; 
      
      setTimeout(() => {
        routeCard.classList.add("hidden");
        btnRestoreCard.classList.remove("hidden");
      }, 500);
    });
  }

  if (btnRestoreCard) {
    btnRestoreCard.addEventListener("click", () => {
      btnRestoreCard.classList.add("hidden");
      // Aseguramos que el panel global esté oculto al restaurar
      if (actionPanel) actionPanel.style.display = "none";
      routeCard.classList.remove("hidden");
      setTimeout(() => routeCard.classList.add("show"), 10);
    });
  }

  // Polling inicial
  fetchAndUpdateBuses();
  setInterval(fetchAndUpdateBuses, 10000);

  // ============================================================
  // 10. LÓGICA DE MI MONEDERO (VISUAL E HISTORIAL)
  // ============================================================
  const modalMonedero = document.getElementById("fullscreen-monedero");
  const btnOpenMonedero = document.getElementById("btn-open-monedero");
  const btnCerrarMonedero = document.getElementById("btn-cerrar-monedero");

  function abrirMonedero() {
      sidebar.classList.remove("active");
      modalMonedero.classList.add("active");
      cargarHistorialMonedero();
  }

  function cargarHistorialMonedero() {
      // 1. Cargar el saldo grande
      fetch(`${BACKEND_URL}/api/transacciones/saldo`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(data => {
          document.getElementById("monedero-saldo-vista").textContent = `$${parseFloat(data.saldo || 0).toFixed(2)}`;
      }).catch(() => document.getElementById("monedero-saldo-vista").textContent = "$--");

      // 2. Cargar las transacciones
      fetch(`${BACKEND_URL}/api/transacciones/mias`, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.json())
      .then(transacciones => {
          const container = document.getElementById("monedero-transacciones");
          if (transacciones.length === 0) {
              container.innerHTML = '<p style="color: #666; text-align: center; margin: 10px 0;">Sin transacciones recientes</p>';
              return;
          }
          container.innerHTML = transacciones.map(t => {
              const fecha = new Date(t.timestamp).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
              const hora = new Date(t.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
              const esRecarga = t.tipo === 'recarga';
              
              // Montos: Verde para ingresos, Rojo para pagos
              const colorMonto = esRecarga ? '#3DDC84' : 'var(--color-error)';
              const signo = esRecarga ? '+' : '-';
              const concepto = esRecarga ? 'Recarga de Monedero' : (t.rutaId?.nombre || "Pago de Pasaje");
              
              // Íconos: Verde para recargas, Blanco/Gris para el camión
              const iconClass = esRecarga ? 'fas fa-arrow-down' : 'fas fa-bus';
              const iconBg = esRecarga ? 'rgba(61, 220, 132, 0.15)' : 'rgba(255, 255, 255, 0.1)';
              const iconColor = esRecarga ? '#3DDC84' : '#ffffff';

              return `
              <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 0; border-bottom:1px solid rgba(255,255,255,0.08);">
                <div style="display:flex; align-items:center; gap: 15px;">
                  
                  <!-- Ícono Circular -->
                  <div style="width: 45px; height: 45px; border-radius: 50%; background: ${iconBg}; color: ${iconColor}; display: flex; justify-content: center; align-items: center; font-size: 1.1rem; flex-shrink: 0;">
                    <i class="${iconClass}"></i>
                  </div>

                  <!-- Textos Centrales -->
                  <div style="display:flex; flex-direction:column; gap: 4px; text-align: left;">
                    <span style="color:#fff; font-size:1rem; font-weight: 600; letter-spacing: 0.3px;">${concepto}</span>
                    <span style="color:#aaa; font-size:0.85rem;">${fecha} • ${hora}</span>
                  </div>

                </div>
                
                <!-- Monto a la derecha -->
                <span style="color:${colorMonto}; font-weight:700; font-size:1.2rem; letter-spacing: 0.5px; margin-right: 15px;">
                  ${signo}$${parseFloat(t.monto).toFixed(2)}
                </span>
              </div>`;
          }).join("");
      }).catch(() => container.innerHTML = '<p style="color: #ff6b6b; text-align: center;">Error al cargar historial</p>');
  }

  if (btnOpenMonedero) btnOpenMonedero.addEventListener("click", (e) => { e.preventDefault(); abrirMonedero(); });
  if (btnCerrarMonedero) btnCerrarMonedero.addEventListener("click", () => modalMonedero.classList.remove("active"));

});

// ============================================================
// 8. DETECTOR DE CIERRE DE PESTAÑA (GLOBAL)
// ============================================================
// Esto debe estar fuera del DOMContentLoaded para garantizar que window exista
window.addEventListener("beforeunload", () => {
    const token = localStorage.getItem("tecbus_token");
    const userString = localStorage.getItem("tecbus_user");

    if (token && userString) {
        const user = JSON.parse(userString);
        if (user.tipo === "estudiante") {
            const userId = user._id || user.id;
            fetch(`${BACKEND_URL}/api/users/${userId}`, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ estado: "inactivo" }),
                keepalive: true, 
            });
        }
    }
});

// ==========================================
// 9. LÓGICA DEL MODAL DE AYUDA (GLOBAL)
// ==========================================
function abrirModalAyuda(event) {
    if(event) event.preventDefault();
    const modalAyuda = document.getElementById('modalAyuda');
    // Usamos 'active' al igual que en las instrucciones para que sea pantalla completa
    if(modalAyuda) modalAyuda.classList.add('active'); 
}

function cerrarModalAyuda() {
    const modalAyuda = document.getElementById('modalAyuda');
    if(modalAyuda) modalAyuda.classList.remove('active');
}

function toggleFaq(btn) {
    const content = btn.nextElementSibling;
    const icon = btn.querySelector('.fa-chevron-down');

    // Lógica para expandir/contraer suavemente el acordeón
    if (content.style.maxHeight && content.style.maxHeight !== '0px') {
        content.style.maxHeight = '0px';
        icon.style.transform = 'rotate(0deg)';
    } else {
        content.style.maxHeight = content.scrollHeight + "px";
        icon.style.transform = 'rotate(180deg)';
    }
}



// ==========================================================================
//   MÓDULO DE RECARGA DE SALDO (PASAJERO - SIMULACIÓN)
// ==========================================================================

window.mostrarModalRecarga = function() {
    Swal.fire({
        title: 'Recargar Monedero',
        html: `
            <p style="color: #aaa; font-size: 0.9rem; margin-bottom: 15px;">Selecciona un monto rápido o escribe uno:</p>
            <div class="opciones-recarga">
                <button class="btn-monto" onclick="document.getElementById('monto-recarga').value = 50">$50</button>
                <button class="btn-monto" onclick="document.getElementById('monto-recarga').value = 100">$100</button>
                <button class="btn-monto" onclick="document.getElementById('monto-recarga').value = 200">$200</button>
            </div>
            <div class="form-group mt-3" style="text-align: center;">
                <input type="number" id="monto-recarga" class="form-control" 
                       style="text-align: center; font-size: 1.5rem; font-weight: bold; width: 100%; max-width: 250px; margin: 0 auto; background: rgba(0,0,0,0.3); color: white; border: 1px solid #0ea5e9; border-radius: 8px; padding: 10px;" 
                       placeholder="$0.00" min="10">
            </div>
        `,
        background: 'rgba(30, 30, 45, 0.95)',
        color: '#ffffff',
        showCancelButton: true,
        showDenyButton: false,
        confirmButtonText: '<i class="fas fa-credit-card"></i> Pagar ahora',
        cancelButtonText: 'Cancelar',
        buttonsStyling: false,
        customClass: {
            popup: 'swal-recharge-popup', // Usamos una clase limpia nueva para evitar el lag
            confirmButton: 'btn btn-primary-lg',
            cancelButton: 'btn btn-secondary-sm',
            actions: 'modal-actions-center'
        },
        // preConfirm detiene el cierre de la ventana y nos permite procesar la carga adentro
        preConfirm: () => {
            const input = document.getElementById('monto-recarga').value;
            if (!input || input < 10) {
                Swal.showValidationMessage('Ingresa un monto mínimo de $10 MXN');
                return false;
            }
            
            // 1. Mostrar ruedita de carga y cambiar el título suavemente
            Swal.showLoading();
            const title = Swal.getTitle();
            if(title) title.textContent = "Procesando pago...";

            // 2. Hacer la simulación/petición sin cerrar el modal
            return new Promise((resolve) => {
                setTimeout(async () => {
                    try {
                        const token = localStorage.getItem("tecbus_token");
                        const res = await fetch(`${BACKEND_URL}/api/transacciones/recargar`, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${token}`
                            },
                            body: JSON.stringify({ monto: parseFloat(input) })
                        });

                        const data = await res.json();
                        if (!res.ok) throw new Error(data.message || "Error en el pago");
                        
                        resolve({ success: true, monto: input, nuevoSaldo: data.nuevoSaldo });
                    } catch (error) {
                        resolve({ success: false, error: error.message });
                    }
                }, 2000);
            });
        }
    }).then((result) => {
        // 3. Cuando termina la carga, mostramos el modal final de éxito o error
        if (result.isConfirmed) {
            const response = result.value;
            
            if (response.success) {
                Swal.fire({
                    icon: 'success',
                    title: '¡Recarga Exitosa!',
                    text: `Tu pago fue aprobado. Se han añadido $${parseFloat(response.monto).toFixed(2)} MXN.`,
                    background: 'rgba(30, 30, 45, 0.95)',
                    color: '#ffffff',
                    confirmButtonText: 'Genial',
                    buttonsStyling: false,
                    customClass: { 
                        popup: 'swal-recharge-popup',
                        confirmButton: 'btn btn-primary-lg' 
                    }
                });

                // Actualizar UI
                const saldoVisual = document.getElementById("monedero-saldo-vista");
                if (saldoVisual && response.nuevoSaldo) {
                    saldoVisual.textContent = `$${parseFloat(response.nuevoSaldo).toFixed(2)}`;
                }
                if (typeof cargarHistorialMonedero === 'function') {
                    cargarHistorialMonedero();
                }
            } else {
                Swal.fire({
                    icon: 'error',
                    title: 'Pago Rechazado',
                    text: 'Hubo un error. ' + response.error,
                    background: 'rgba(30, 30, 45, 0.95)',
                    color: '#ffffff',
                    confirmButtonText: 'Entendido',
                    buttonsStyling: false,
                    customClass: { 
                        popup: 'swal-recharge-popup',
                        confirmButton: 'btn btn-error-lg' 
                    }
                });
            }
        }
    });
};