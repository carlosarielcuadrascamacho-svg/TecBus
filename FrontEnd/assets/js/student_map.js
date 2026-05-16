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

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [initialLng, initialLat],
    zoom: initialZoom,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  // Funciones creadoras de elementos para los marcadores
  function createBusElement() {
    const el = document.createElement('div');
    el.className = "custom-bus-icon";
    el.innerHTML = `<div style="background-color:var(--color-primario); border-radius: 50%; width: 30px; height: 30px; display: flex; justify-content: center; align-items: center; color: white; border: 2px solid white; font-size: 14px; box-shadow: 0 0 15px var(--color-primario); transition: all 0.3s ease;"><i class="fas fa-bus"></i></div>`;
    return el;
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
    
    // Función auxiliar para verificar si un dato es válido (no nulo, no vacío y no "PENDIENTE")
    const esValido = (texto) => texto && texto !== "PENDIENTE" && texto.trim() !== "";

    // 1. Buscamos matrícula en el objeto anidado 'estudiante'
    if (user.estudiante && esValido(user.estudiante.matricula)) {
        idMostrar = user.estudiante.matricula;
    } 
    // 2. Buscamos matrícula en la raíz del usuario
    else if (esValido(user.matricula)) {
        idMostrar = user.matricula; 
    } 
    // 3. Si no hay matrícula válida, usamos el ID interno de MongoDB (el código largo)
    else if (user._id || user.id) {
        idMostrar = (user._id || user.id); // Lo cortamos para que se vea bien
    }

    document.getElementById("perfil-id").textContent = idMostrar;

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

  function handleLogout(e) {
    e.preventDefault();
    if (confirm("¿Cerrar sesión?")) {
      // Intentar marcar como inactivo antes de borrar token
      const userId = user._id || user.id;
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
    }
  }

  const logoutBtn = document.getElementById("logout-button");
  const sidebarLogout = document.getElementById("sidebar-logout");
  if (logoutBtn) logoutBtn.addEventListener("click", handleLogout);
  if (sidebarLogout) sidebarLogout.addEventListener("click", handleLogout);

  // ============================================================
  // 5. MENÚ LATERAL Y UI GENERAL
  // ============================================================
  const sidebar = document.getElementById("sidebar");
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

  if (btnVerHistorial) {
    btnVerHistorial.addEventListener("click", async (e) => {
      e.preventDefault();
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
    });
  }

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
        dibujarCalendario(horarios);
      } catch (error) {
        calendarGrid.innerHTML = '<p class="placeholder-text" style="color:red">Error al cargar calendario.</p>';
      }
    });
  }

  function dibujarCalendario(horarios) {
    const diasOrdenados = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
    const grupos = {};
    diasOrdenados.forEach((d) => (grupos[d] = []));
    horarios.forEach((h) => { if (grupos[h.diaSemana]) grupos[h.diaSemana].push(h); });

    calendarGrid.innerHTML = "";
    diasOrdenados.forEach((dia) => {
      const viajes = grupos[dia];
      let contenido = viajes.length === 0 ? '<div class="no-service">Sin servicio</div>' : "";
      viajes.forEach((v) => {
        contenido += `<div class="cal-item"><span class="cal-time">${v.hora}</span><span class="cal-bus"><i class="fas fa-bus"></i> ${v.camionUnidad || "?"}</span></div>`;
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
      selectorElement.innerHTML = '<option value="">-- Selecciona una ruta --</option>';
      rutas.forEach((ruta) => {
        if (ruta.activa) selectorElement.innerHTML += `<option value="${ruta._id}">${ruta.nombre}</option>`;
      });
    } catch (error) { console.error(error); }
  }

  const mapRutaSelector = document.getElementById("ruta-selector");
  if (mapRutaSelector) {
    cargarRutasEnSelector(mapRutaSelector);
    mapRutaSelector.addEventListener("change", (e) => {
      currentRouteId = e.target.value;
      registrarBusqueda(currentRouteId);
      dibujarRuta(currentRouteId);
      filtrarCamionesEnMapa();
    });
  }

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
          const stopEl = document.createElement('div');
          stopEl.className = 'stop-marker-icon';
          stopEl.style.cssText = 'background-color:#ffc107; border:2px solid white; width:12px; height:12px; border-radius:50%; box-shadow:0 0 4px black;';
          const popup = new maplibregl.Popup({ offset: 10 }).setHTML(`🚏 <strong>${p.nombre || "Parada"}</strong>`);
          const marker = new maplibregl.Marker({ element: stopEl })
              .setLngLat([p.ubicacion.coordinates[0], p.ubicacion.coordinates[1]])
              .setPopup(popup)
              .addTo(map);
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
      const response = await fetch(`${BACKEND_URL}/api/camiones`, { headers: { Authorization: `Bearer ${token}` } });
      const camiones = await response.json();

      camiones.forEach((camion) => {
        const estadosVisibles = ["activo", "En Servicio", "Abordando"];
    
        if (!estadosVisibles.includes(camion.estado) || !camion.ubicacionActual) {
            return;
        }
        const rutaId = camion.rutaAsignada ? camion.rutaAsignada._id : null;

        if (busMarkers[camion._id]) {
          busMarkers[camion._id].setLngLat([camion.ubicacionActual.coordinates[0], camion.ubicacionActual.coordinates[1]]);
          busMarkers[camion._id].rutaId = rutaId;
        } else {
          const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`🚍 **${camion.numeroUnidad}**<br>Ruta: ${camion.rutaAsignada ? camion.rutaAsignada.nombre : "Sin asignar"}`);
          const marker = new maplibregl.Marker({ element: createBusElement() })
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
    if (marker) marker.setLngLat([data.location.lng, data.location.lat]);
    else fetchAndUpdateBuses();
  });

  socket.on("studentWaiting", (data) => {
      console.log("🙋‍♂️ Estudiante esperando:", data);
      
      const popup = new maplibregl.Popup({ offset: 15 }).setHTML("<strong>¡Estudiante Aquí!</strong>");
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

  // --- BOTÓN ESTOY AQUÍ ---
  const btnEstoyAqui = document.getElementById("btn-estoy-aqui");
  
  if (btnEstoyAqui) {
    btnEstoyAqui.addEventListener("click", () => {
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
      const textoOriginal = btnEstoyAqui.innerHTML;
      btnEstoyAqui.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Obteniendo ubicación...';
      btnEstoyAqui.disabled = true;

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
          btnEstoyAqui.innerHTML = textoOriginal;
          btnEstoyAqui.disabled = false;
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
          btnEstoyAqui.innerHTML = textoOriginal;
          btnEstoyAqui.disabled = false;
        },
        
        // Opciones de GPS
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

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

  // Polling inicial
  fetchAndUpdateBuses();
  setInterval(fetchAndUpdateBuses, 10000);
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