// frontend/assets/js/driver_map.js

document.addEventListener("DOMContentLoaded", () => {
  // 1. VERIFICACIÓN DE SESIÓN
  const token = localStorage.getItem("tecbus_token");
  const userString = localStorage.getItem("tecbus_user");

  if (!token || !userString) {
    window.location.href = "login.html";
    return;
  }

  const user = JSON.parse(userString);

  if (user.tipo !== "conductor") {
    alert("Acceso denegado. No eres conductor.");
    window.location.href = "login.html";
    return;
  }

  // 2. CONSTANTES Y VARIABLES GLOBALES
  const initialLat = 25.567;
  const initialLng = -108.473;
  const initialZoom = 13;

  // Variables de Estado
  let MI_CAMION_ID = null;
  let MI_RUTA_NOMBRE = "";
  let MIS_VIAJES_HOY = []; // Lista de todos los viajes del día ordenados
  let INDICE_VIAJE_ACTUAL = -1; // En qué viaje voy (0, 1, 2...)

  // Variables de Geofencing (Detección de Llegada)
  let DESTINO_ACTUAL = null; // { lat: ..., lng: ... } del punto final
  let LLEGADA_DETECTADA = false; // Para evitar que la alerta suene 50 veces
  let RADIO_DETECCION_METROS = 150; // Distancia para considerar que "Llegó"

  // --- CORRECCIÓN 1: Definir la variable faltante ---
  let rutaPolyline = null;

  // Elementos UI de la NUEVA CONSOLA COMPACTA
  const consoleSpeed = document.getElementById("console-speed");
  const consolePassengers = document.getElementById("console-passengers");
  const consoleNextStop = document.getElementById("console-next-stop");
  const consoleDistStop = document.getElementById("console-dist-stop");
  const hudContainer = document.getElementById("hud-alerts-container");
  const routeDisplay = document.getElementById("driver-route-display");
  const headerDisplay = document.getElementById("header-bus-display");
  const busDisplay = document.getElementById("driver-bus-display"); // Podría ser null ahora

  // Elementos del Menú Lateral
  const sidebar = document.getElementById("sidebar");
  const btnMenuToggle = document.getElementById("btn-menu-toggle");
  const btnMenuClose = document.getElementById("btn-menu-close");

  // 3. CONFIGURACIÓN DEL MAPA
  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [initialLng, initialLat],
    zoom: initialZoom,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

  const driverEl = document.createElement('div');
  driverEl.className = 'custom-driver-icon';
  driverEl.innerHTML = '<div style="background-color: var(--color-primario); border-radius: 50%; width: 35px; height: 35px; display: flex; justify-content: center; align-items: center; color: white; border: 3px solid white; font-size: 20px; box-shadow: 0 0 15px var(--color-primario); transition: all 0.3s ease;">🚌</div>';
  
  const popup = new maplibregl.Popup({ offset: 25, closeButton: false }).setText("Ubicación Guardada");
  const driverMarker = new maplibregl.Marker({ element: driverEl })
    .setLngLat([initialLng, initialLat])
    .setPopup(popup)
    .addTo(map);
  
  driverMarker.togglePopup();

  // ============================================================
  // CONEXIÓN SOCKET.IO Y LÓGICA DE ESCUCHA (ESP32)
  // ============================================================
  const socket = io(SOCKET_URL);
  let geoWatchId = null;

  socket.on("connect", () => {
    console.log("🔌 Conectado al servidor de sockets con ID:", socket.id);
  });

  // --- CORRECCIÓN 2: Escuchar al Servidor (ESP32) ---
  // Esta es la parte mágica que mueve el mapa cuando el ESP32 manda datos
  // --- CORRECCIÓN FINAL: ESCUCHAR, PERO CONSULTAR BD ---
  // --- VERSIÓN DE DIAGNÓSTICO PARA SOCKETS ---
  // --- LÓGICA CORREGIDA: Consultar TODOS los camiones (Igual que Estudiante/Admin) ---
  socket.on("locationUpdate", async (data) => {
    // 1. Verificamos si la señal es relevante para nosotros
    const esMiID =
      MI_CAMION_ID && String(data.camionId) === String(MI_CAMION_ID);
    let esMiUnidad = false;
    if (headerDisplay && data.numeroUnidad) {
      esMiUnidad = headerDisplay.textContent.includes(data.numeroUnidad);
    }

    if (esMiID || esMiUnidad) {
      console.log("🔔 Señal recibida. Sincronizando con Base de Datos...");

      try {
        // 2. CORRECCIÓN: Pedimos la lista COMPLETA de camiones (esta ruta SI existe y funciona)
        const response = await fetch(`${BACKEND_URL}/api/camiones`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (response.ok) {
          const listaCamiones = await response.json();

          // 3. Buscamos NUESTRO camión en la lista
          const camionDB = listaCamiones.find(
            (c) => c._id === MI_CAMION_ID || c.id === MI_CAMION_ID
          );

          if (
            camionDB &&
            camionDB.ubicacionActual &&
            camionDB.ubicacionActual.coordinates
          ) {
            // MongoDB GeoJSON: coordinates [longitud, latitud]
            const lngDB = camionDB.ubicacionActual.coordinates[0];
            const latDB = camionDB.ubicacionActual.coordinates[1];
            const velocidadDB = camionDB.velocidad || 0;

            console.log(`✅ Ubicación sincronizada: [${latDB}, ${lngDB}]`);

            // 4. Mover el marcador
            driverMarker.setLngLat([lngDB, latDB]);
            driverMarker.getPopup().setHTML(`📍 Ubicación Real (BD)<br>🚀 ${Math.round(velocidadDB)} km/h`);
            if(!driverMarker.getPopup().isOpen()) driverMarker.togglePopup();

            // Actualizar Consola
            if (consoleSpeed) consoleSpeed.innerHTML = `${Math.round(velocidadDB)} <small>km/h</small>`;
            
            map.panTo([lngDB, latDB]);
            verificarLlegadaDestino(latDB, lngDB);
            actualizarProximaParada(latDB, lngDB);
          } else {
            console.warn(
              "⚠️ Mi camión fue encontrado pero no tiene coordenadas en BD."
            );
          }
        } else {
          console.error(
            "❌ Error al obtener lista de camiones:",
            response.status
          );
        }
      } catch (error) {
        console.error("❌ Error de red consultando BD:", error);
      }
    }
  });

  // ============================================================
  // 4. LÓGICA DE GEOFENCING (DETECTAR LLEGADA)
  // ============================================================

  // Fórmula de Haversine para calcular metros entre dos coordenadas
  function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Radio de la tierra en metros
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distancia en metros
  }

  function verificarLlegadaDestino(latActual, lngActual) {
    if (!DESTINO_ACTUAL || LLEGADA_DETECTADA) return;

    const distancia = calcularDistanciaMetros(
      latActual,
      lngActual,
      DESTINO_ACTUAL.lat,
      DESTINO_ACTUAL.lng
    );

    if (distancia < RADIO_DETECCION_METROS) {
      console.log("✅ ¡Llegada detectada por GPS Físico!");
      LLEGADA_DETECTADA = true; // Bloquear para no disparar múltiples veces
      avanzarSiguienteTurno();
    }
  }

  function avanzarSiguienteTurno() {
    // 1. Verificar si hay más viajes hoy
    if (INDICE_VIAJE_ACTUAL >= MIS_VIAJES_HOY.length - 1) {
      // SE ACABARON LOS VIAJES
      finDelServicio();
    } else {
      // 2. Cargar el siguiente
      INDICE_VIAJE_ACTUAL++;
      const siguienteViaje = MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL];

      // Notificación Visual y Sonora
      if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
      alert(
        `🏁 LLegada a destino detectada.\n\n🔄 Iniciando siguiente ruta: ${siguienteViaje.rutaNombre}\n⏰ Horario: ${siguienteViaje.hora}`
      );

      // Cargar la nueva ruta
      cargarRutaActiva(siguienteViaje);
    }
  }

  function finDelServicio() {
    if (routeDisplay) routeDisplay.textContent = "Jornada Finalizada";
    
    DESTINO_ACTUAL = null;
    if (map.getLayer("ruta-layer")) map.removeLayer("ruta-layer");
    if (map.getSource("ruta-source")) map.removeSource("ruta-source");
    if (window.stopMarkersArray) {
      window.stopMarkersArray.forEach(m => m.remove());
      window.stopMarkersArray = [];
    }

    alert(
      "🏁 Has llegado al destino final de hoy.\nTu estado ahora es: Fuera de Servicio."
    );
  }

  // --- NUEVA LÓGICA: ACTUALIZAR PRÓXIMA PARADA ---
  function actualizarProximaParada(latBus, lngBus) {
    if (!window.stopMarkersArray || window.stopMarkersArray.length === 0) return;
    
    // Buscar la parada más cercana que esté ADELANTE (simplificado)
    // Por ahora solo mostramos la más cercana de todas
    let paradaMasCercana = null;
    let distMin = Infinity;
    
    window.stopMarkersArray.forEach(marker => {
        const coords = marker.getLngLat();
        const dist = calcularDistanciaMetros(latBus, lngBus, coords.lat, coords.lng);
        if (dist < distMin) {
            distMin = dist;
            paradaMasCercana = marker;
        }
    });

    if (paradaMasCercana) {
        const nombre = paradaMasCercana.getPopup().getContent().replace(/<[^>]*>?/gm, '');
        if (consoleNextStop) consoleNextStop.textContent = nombre;
        if (consoleDistStop) consoleDistStop.textContent = Math.round(distMin);
    }
  }


  // ============================================================
  // 5. CARGA DE DATOS Y RUTAS
  // ============================================================
  // Variable global para guardar el control de ruta y poder borrarlo después
  let routingControl = null;

  async function cargarRutaActiva(viaje) {
    // 1. Actualizar Textos UI
    if (routeDisplay) routeDisplay.textContent = viaje.rutaNombre;

    try {
      // 2. Limpiar mapa anterior
      if (map.getLayer("ruta-layer")) map.removeLayer("ruta-layer");
      if (map.getSource("ruta-source")) map.removeSource("ruta-source");
      if (window.stopMarkersArray) {
        window.stopMarkersArray.forEach(m => m.remove());
      }
      window.stopMarkersArray = [];

      // 3. Obtener datos de la ruta
      const response = await fetch(`${BACKEND_URL}/api/rutas/${viaje.rutaId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const ruta = await response.json();

      if (ruta.paradas && ruta.paradas.length > 0) {
        // Separar trazo de paradas
        const puntosTrazo = ruta.paradas.filter((p) => p.tipo === "trazo");
        const puntosParada = ruta.paradas.filter(
          (p) => p.tipo === "parada_oficial" || !p.tipo
        );

        // Configurar arreglo para paradas
        if (!window.stopMarkersArray) window.stopMarkersArray = [];

        let coordsForBounds = [];

        // --- CASO A: RUTA CON DISEÑO MANUAL (TRAZO) ---
        if (puntosTrazo.length > 0) {
          console.log("🎨 Cargando ruta con diseño manual vectorial...");

          const coords = puntosTrazo.map((p) => [
            p.ubicacion.coordinates[0], // lng
            p.ubicacion.coordinates[1], // lat
          ]);
          coordsForBounds = coords;

          map.addSource('ruta-source', {
            'type': 'geojson',
            'data': {
              'type': 'Feature',
              'properties': {},
              'geometry': { 'type': 'LineString', 'coordinates': coords }
            }
          });

          map.addLayer({
            'id': 'ruta-layer',
            'type': 'line',
            'source': 'ruta-source',
            'layout': { 'line-join': 'round', 'line-cap': 'round' },
            'paint': { 'line-color': '#007bff', 'line-width': 6, 'line-opacity': 0.8 }
          });

          // Las paradas se marcan visualmente más abajo (fuera del if)

          // Establecer destino (último punto del trazo)
          const ultimo = coords[coords.length - 1];
          DESTINO_ACTUAL = { lat: ultimo[1], lng: ultimo[0] };
        }
        // --- CASO B: RUTA ANTIGUA (SIN TRAZO, SOLO PARADAS) ---
        else {
          console.log("🗺️ Cargando ruta automática (OSRM) vía API Rest...");
          const coordsString = puntosParada.map(p => `${p.ubicacion.coordinates[0]},${p.ubicacion.coordinates[1]}`).join(';');
          
          try {
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

                  const ultimoPunto = puntosParada[puntosParada.length - 1];
                  DESTINO_ACTUAL = { lat: ultimoPunto.ubicacion.coordinates[1], lng: ultimoPunto.ubicacion.coordinates[0] };
              }
          } catch(err) {
              console.error("Error obteniendo ruta OSRM", err);
          }
        }

        // Marcar las paradas visualmente para ambos casos
        puntosParada.forEach((p) => {
          const stopEl = document.createElement('div');
          stopEl.style.cssText = 'background-color:#ffc107; border:2px solid white; width:12px; height:12px; border-radius:50%; box-shadow:0 0 4px black;';
          const m = new maplibregl.Marker({ element: stopEl })
            .setLngLat([p.ubicacion.coordinates[0], p.ubicacion.coordinates[1]])
            .setPopup(new maplibregl.Popup({ offset: 10 }).setText(p.nombre))
            .addTo(map);
          window.stopMarkersArray.push(m);
        });

        if (coordsForBounds.length > 0) {
          const bounds = coordsForBounds.reduce(function(b, coord) {
            return b.extend(coord);
          }, new maplibregl.LngLatBounds(coordsForBounds[0], coordsForBounds[0]));
          map.fitBounds(bounds, { padding: 50 });
        }

        LLEGADA_DETECTADA = false;
        console.log("🚩 Destino fijado:", DESTINO_ACTUAL);
      }
    } catch (error) {
      console.error("Error cargando ruta:", error);
    }
  }

  async function inicializarSistema() {
    try {
      // --- DEFINICIÓN PREVIA PARA EVITAR EL CRASH ---
      let dataCamion = null;

      // A. Obtener Camión (Ruta Dinámica)
      const resCamion = await fetch(BACKEND_URL + "/api/camiones/mi-unidad", {
        headers: { Authorization: `Bearer ${token}` },
      });

      // --- MANEJO DEL ESTADO ---
      if (resCamion.status === 404) {
        console.log(
          "ℹ️ Conductor logueado, pero sin horario activo en este momento."
        );
        MI_CAMION_ID = null;

        if (headerDisplay) headerDisplay.textContent = "Sin Turno Activo";
        if (busDisplay) busDisplay.textContent = "Sin Turno Activo";
        if (routeDisplay) routeDisplay.textContent = "--";
      } else if (!resCamion.ok) {
        console.warn("⚠️ Error desconocido al pedir camión:", resCamion.status);
        return;
      } else {
        // Si encontró camión (Status 200)
        dataCamion = await resCamion.json(); // ASIGNAMOS LA VARIABLE AQUÍ
        let textoCamion = "Sin Unidad";
        let unidad = null;

        if (dataCamion.camionId) {
          MI_CAMION_ID = dataCamion.camionId;
          unidad = dataCamion.numeroUnidad;
          textoCamion =
            `Unidad ${unidad}` +
            (dataCamion.placa ? ` (${dataCamion.placa})` : "");
        }

        if (headerDisplay) headerDisplay.textContent = textoCamion;
        if (busDisplay) busDisplay.textContent = textoCamion;

        if (
          dataCamion.ubicacionActual &&
          dataCamion.ubicacionActual.coordinates
        ) {
          const [lng, lat] = dataCamion.ubicacionActual.coordinates;
          driverMarker.setLngLat([lng, lat]);
          map.jumpTo({ center: [lng, lat], zoom: 15 });
        }
      }

      // B. Obtener TODOS los horarios del día
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const todosHorarios = await resHorarios.json();

      const dias = [
        "domingo",
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
      ];
      const hoyBackend = {
        lunes: "Lunes",
        martes: "Martes",
        miercoles: "Miércoles",
        jueves: "Jueves",
        viernes: "Viernes",
        sabado: "Sábado",
        domingo: "Domingo",
      }[dias[new Date().getDay()]];

      // Filtrar mis viajes de hoy
      MIS_VIAJES_HOY = todosHorarios.filter((h) => {
        const esHoy = h.diaSemana === hoyBackend;
        const soyYo =
          h.infoConductor && h.infoConductor[0]?._id === (user._id || user.id);

        // --- CORRECCIÓN DEL CRASH AQUÍ ---
        // Verificamos si dataCamion existe antes de leer sus propiedades
        const esMiCamion =
          dataCamion &&
          String(h.camionUnidad) === String(dataCamion.numeroUnidad);

        return esHoy && (soyYo || esMiCamion);
      });

      // Ordenar por hora
      const horaAInt = (h) =>
        parseInt(h.split(":")[0]) * 60 + parseInt(h.split(":")[1]);
      MIS_VIAJES_HOY.sort((a, b) => horaAInt(a.hora) - horaAInt(b.hora));

      if (MIS_VIAJES_HOY.length === 0) {
        if (routeDisplay) routeDisplay.textContent = "Día Libre";
        return;
      }

      // C. Determinar en qué viaje vamos
      const now = new Date();
      const horaActual = now.getHours() * 60 + now.getMinutes();
      let indiceEncontrado = 0;

      for (let i = 0; i < MIS_VIAJES_HOY.length; i++) {
        const horaViaje = horaAInt(MIS_VIAJES_HOY[i].hora);
        if (horaActual < horaViaje + 30) {
          indiceEncontrado = i;
          break;
        }
        if (i === MIS_VIAJES_HOY.length - 1) indiceEncontrado = i;
      }

      const ultimoViaje = MIS_VIAJES_HOY[MIS_VIAJES_HOY.length - 1];
      if (horaActual > horaAInt(ultimoViaje.hora) + 120) {
        finDelServicio();
        iniciarGeolocalizacion();
        return;
      }

      INDICE_VIAJE_ACTUAL = indiceEncontrado;
      cargarRutaActiva(MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL]);
      iniciarGeolocalizacion();
    } catch (error) {
      console.error("Error inicializando:", error);
    }
  }

  function iniciarGeolocalizacion() {
    console.log("📡 Sistema en modo: Escuchando Sockets + Fetch BD");
  }

  // ============================================================
  // 6. INICIAR MODO DE SEGUIMIENTO
  // ============================================================

  // function iniciarGeolocalizacion() {
  //   // --- CORRECCIÓN 3: MODO PASIVO ---
  //   // Ya no llamamos a navigator.geolocation.watchPosition
  //   console.log("📡 Sistema iniciado en modo RECEPTOR DE DATOS (ESP32).");
  //   console.log("   Esperando eventos 'locationUpdate' del servidor...");

  //   if (driverMarker) {
  //     // Si no se cargó la posición inicial de la BD, mostramos esto
  //     if (driverMarker.getPopup().getContent() === "Tu ubicación") {
  //       driverMarker.bindPopup("Esperando señal del ESP32...").openPopup();
  //     }
  //   }
  // 4. LÓGICA DEL MENÚ LATERAL Y MODALES

  // Toggle Sidebar
  if (btnMenuToggle) {
    btnMenuToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      sidebar.classList.add("active");
    });
  }

  if (btnMenuClose) {
    btnMenuClose.addEventListener("click", () =>
      sidebar.classList.remove("active")
    );
  }

  // Cerrar sidebar al hacer click fuera
  document.addEventListener("click", (e) => {
    if (
      sidebar.classList.contains("active") &&
      !sidebar.contains(e.target) &&
      !e.target.closest(".menu-icon")
    ) {
      sidebar.classList.remove("active");
    }
  });

  // --- MODAL PERFIL ---
  const modalPerfil = document.getElementById("modal-perfil");
  const btnOpenPerfilHeader = document.getElementById("btn-open-perfil-header");
  const btnOpenPerfilSidebar = document.getElementById(
    "btn-open-perfil-sidebar"
  );

  function abrirPerfil() {
    sidebar.classList.remove("active");

    document.getElementById("perfil-nombre").textContent =
      user.nombre || "Conductor";
    document.getElementById("perfil-email").textContent =
      user.email || "Sin correo";
    document.getElementById("perfil-id").textContent =
      user._id || user.id || "N/A";

    // --- MODIFICACIÓN INICIO ---
    // Verificamos si existe datos de conductor y si hay algo en 'licencia'
    let textoLicencia = "No registrada";

    if (user.conductor && user.conductor.licencia) {
      // Si hay una licencia (o pusiste "Si"), mostramos "Registrada"
      textoLicencia = "Registrada";
    }

    const elLicencia = document.getElementById("perfil-licencia");
    if (elLicencia) elLicencia.textContent = textoLicencia;
    // --- MODIFICACIÓN FIN ---

    modalPerfil.classList.add("modal-visible");
  }

  if (btnOpenPerfilHeader)
    btnOpenPerfilHeader.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });
  if (btnOpenPerfilSidebar)
    btnOpenPerfilSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirPerfil();
    });

  // --- MODAL HORARIOS ---
  const fullscreenHorarios = document.getElementById("fullscreen-horarios");
  const btnOpenHorarioSidebar = document.getElementById(
    "btn-open-horario-sidebar"
  );
  const btnCerrarHorarios = document.getElementById("btn-cerrar-horarios");
  const calendarGrid = document.getElementById("calendario-semanal");

  async function abrirMisHorarios() {
    if (sidebar) sidebar.classList.remove("active");
    fullscreenHorarios.classList.add("active");

    calendarGrid.innerHTML =
      '<p class="placeholder-text"><i class="fas fa-spinner fa-spin"></i> Cargando tu agenda...</p>';

    try {
      const res = await fetch(`${BACKEND_URL}/api/horarios`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("No se pudo descargar la agenda");
      const todosLosHorarios = await res.json();

      const misHorarios = todosLosHorarios.filter((h) => {
        const info = h.infoConductor && h.infoConductor[0];
        if (info) return info._id === (user._id || user.id);
        return h.conductorNombre === user.nombre;
      });

      const diasOrdenados = [
        "Lunes",
        "Martes",
        "Miércoles",
        "Jueves",
        "Viernes",
        "Sábado",
        "Domingo",
      ];
      const grupos = {};

      diasOrdenados.forEach((d) => (grupos[d] = []));

      misHorarios.forEach((h) => {
        let dia = h.diaSemana;
        if (dia === "Miercoles") dia = "Miércoles";
        if (dia === "Sabado") dia = "Sábado";

        if (grupos[dia]) {
          grupos[dia].push(h);
        }
      });

      calendarGrid.innerHTML = "";

      diasOrdenados.forEach((dia) => {
        const viajes = grupos[dia];
        viajes.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));

        let contenidoHTML = "";

        if (viajes.length === 0) {
          contenidoHTML = `
                    <div class="no-service">
                        <i class="fas fa-coffee" style="font-size:1.5rem; margin-bottom:10px; display:block;"></i>
                        Descanso
                    </div>`;
        } else {
          viajes.forEach((v) => {
            contenidoHTML += `
                        <div class="cal-item">
                            <div class="cal-time-box">
                                <span class="cal-time">${v.hora}</span>
                            </div>
                            <div class="cal-info-box">
                                <span class="cal-route">${v.rutaNombre}</span>
                                <span class="cal-bus-badge">
                                    <i class="fas fa-bus"></i> ${
                                      v.camionUnidad || "S/N"
                                    }
                                </span>
                            </div>
                        </div>
                      `;
          });
        }

        calendarGrid.innerHTML += `
                <div class="day-card">
                    <div class="day-header">
                        <h3>${dia}</h3>
                        ${
                          viajes.length > 0
                            ? `<span class="badge-count">${viajes.length} Viajes</span>`
                            : ""
                        }
                    </div>
                    <div class="day-body">
                        ${contenidoHTML}
                    </div>
                </div>
              `;
      });
    } catch (error) {
      console.error(error);
      calendarGrid.innerHTML =
        '<p class="placeholder-text" style="color:var(--color-error)">Error de conexión al cargar horarios.</p>';
    }
  }

  if (btnOpenHorarioSidebar) {
    btnOpenHorarioSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirMisHorarios();
    });
  }
  if (btnCerrarHorarios) {
    btnCerrarHorarios.addEventListener("click", () => {
      fullscreenHorarios.classList.remove("active");
    });
  }

  // 5. LÓGICA DEL ESTADO DEL CONDUCTOR (Principal)

  function obtenerDiaSemana() {
    const dias = [
      "domingo",
      "lunes",
      "martes",
      "miercoles",
      "jueves",
      "viernes",
      "sabado",
    ];
    return dias[new Date().getDay()];
  }
  const mapaDiasBackend = {
    lunes: "Lunes",
    martes: "Martes",
    miercoles: "Miércoles",
    jueves: "Jueves",
    viernes: "Viernes",
    sabado: "Sábado",
    domingo: "Domingo",
  };
  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(":");
    return parseInt(h) * 60 + parseInt(m);
  }

  // Variables globales para evitar spam al servidor
  let ULTIMO_ESTADO_REPORTADO = "";

  // Función auxiliar: Convertir "06:30" a minutos (390)
  function horaAEntero(horaStr) {
    if (!horaStr) return 0;
    const [h, m] = horaStr.split(":");
    return parseInt(h) * 60 + parseInt(m);
  }

  // Función auxiliar: Convertir minutos (405) a "06:45"
  function minutosAHora(minutos) {
    let h = Math.floor(minutos / 60);
    const m = minutos % 60;
    h = h % 24;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }

  async function actualizarEstadoConductor() {
    try {
      const statusMsgBox = document.querySelector(".students-count");

      // Variable para guardar el número de unidad si la API /mi-unidad responde
      let unidadDetectada = null;

      // 1. INTENTO A: OBTENER CAMIÓN ASIGNADO DIRECTAMENTE
      const resCamion = await fetch(BACKEND_URL + "/api/camiones/mi-unidad", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (resCamion.ok) {
        const dataCamion = await resCamion.json();
        if (dataCamion.camionId) {
          MI_CAMION_ID = dataCamion.camionId;
          unidadDetectada = dataCamion.numeroUnidad;

          let textoCamion =
            `Unidad ${unidadDetectada}` +
            (dataCamion.placa ? ` (${dataCamion.placa})` : "");
          if (headerDisplay) headerDisplay.textContent = textoCamion;
          if (busDisplay) busDisplay.textContent = textoCamion;
        }
      } else {
        console.warn(
          "⚠️ API /mi-unidad dio 404. Usaremos el Horario para buscar el camión."
        );
      }

      // 2. OBTENER HORARIOS
      const resHorarios = await fetch(BACKEND_URL + "/api/horarios", {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resHorarios.ok) return;

      const todosHorarios = await resHorarios.json();

      // Filtrar horarios de HOY
      const diasArr = [
        "domingo",
        "lunes",
        "martes",
        "miercoles",
        "jueves",
        "viernes",
        "sabado",
      ];
      const hoyIndex = new Date().getDay();
      const mapaDiasBackend = {
        lunes: "Lunes",
        martes: "Martes",
        miercoles: "Miércoles",
        jueves: "Jueves",
        viernes: "Viernes",
        sabado: "Sábado",
        domingo: "Domingo",
      };
      const hoyFormatted = mapaDiasBackend[diasArr[hoyIndex]];

      const salidasHoy = todosHorarios.filter((h) => {
        const esDia = h.diaSemana === hoyFormatted;
        const infoCond = h.infoConductor && h.infoConductor[0];
        const soyYo = infoCond && infoCond._id === (user._id || user.id);
        const nombreCoincide = h.conductorNombre === user.nombre;
        const esMiCamion = unidadDetectada
          ? String(h.camionUnidad) === String(unidadDetectada)
          : false;

        return esDia && (soyYo || esMiCamion || nombreCoincide);
      });

      // Ordenar por hora
      salidasHoy.sort((a, b) => horaAEntero(a.hora) - horaAEntero(b.hora));

      // 3. DETERMINAR VIAJE ACTIVO
      const now = new Date();
      const minutosActuales = now.getHours() * 60 + now.getMinutes();

      let viajeActivo = null;
      let viajeSiguiente = null;
      let estadoActual = "Fuera de Servicio";
      let esPreparacion = false;

      for (let i = 0; i < salidasHoy.length; i++) {
        const viaje = salidasHoy[i];
        const inicio = horaAEntero(viaje.hora);
        const duracion = viaje.rutaDuracion || 45;
        const fin = inicio + duracion;

        if (minutosActuales >= inicio - 15 && minutosActuales < inicio) {
          viajeActivo = viaje;
          viajeActivo.horaFin = minutosAHora(fin);
          esPreparacion = true;
          break;
        }
        if (minutosActuales >= inicio && minutosActuales <= fin) {
          viajeActivo = viaje;
          viajeActivo.horaFin = minutosAHora(fin);
          break;
        }
        if (minutosActuales < inicio && !viajeSiguiente) {
          viajeSiguiente = viaje;
        }
      }

      // --- 4. LÓGICA PRINCIPAL DE RECUPERACIÓN ---
      if (viajeActivo) {
        // >>>>> AQUÍ ESTÁ LA SOLUCIÓN <<<<<
        // Si no tenemos ID, usamos 'camionUnidad' ("TEC-01") para buscarlo en la BD
        if (!MI_CAMION_ID && viajeActivo.camionUnidad) {
          console.log(
            `🔎 Buscando ID para la unidad: ${viajeActivo.camionUnidad}...`
          );

          try {
            // Pedimos la lista de todos los camiones
            const resAllBus = await fetch(BACKEND_URL + "/api/camiones", {
              headers: { Authorization: `Bearer ${token}` },
            });

            if (resAllBus.ok) {
              const listaCamiones = await resAllBus.json();

              // Buscamos el camión que tenga ese numeroUnidad o placa
              const camionEncontrado = listaCamiones.find(
                (c) =>
                  String(c.numeroUnidad) === String(viajeActivo.camionUnidad) ||
                  c.placa === viajeActivo.camionUnidad
              );

              if (camionEncontrado) {
                MI_CAMION_ID = camionEncontrado._id || camionEncontrado.id;
                console.log(
                  "✅ ¡ID RECUPERADO POR NOMBRE DE UNIDAD!",
                  MI_CAMION_ID
                );

                // Forzamos actualización visual del nombre del camión
                const texto = `Unidad ${camionEncontrado.numeroUnidad} (${camionEncontrado.placa})`;
                if (headerDisplay) headerDisplay.textContent = texto;
                if (busDisplay) busDisplay.textContent = texto;
              } else {
                console.error(
                  "❌ No existe ningún camión en la BD con número:",
                  viajeActivo.camionUnidad
                );
              }
            }
          } catch (errBus) {
            console.error("Error buscando camión por nombre:", errBus);
          }
        }
        // >>>>> FIN SOLUCIÓN <<<<<

        // Actualizar UI
        const textoUnidadActiva = `Unidad ${
          viajeActivo.camionUnidad || "Asignada"
        }`;
        if (!MI_CAMION_ID) {
          // Solo si no lo encontramos arriba
          if (headerDisplay) headerDisplay.textContent = textoUnidadActiva;
          if (busDisplay) busDisplay.textContent = textoUnidadActiva;
        }

        routeDisplay.textContent = viajeActivo.rutaNombre;
        iniciarGeolocalizacion();

        if (MI_RUTA_NOMBRE !== viajeActivo.rutaNombre) {
          MI_RUTA_NOMBRE = viajeActivo.rutaNombre;
          cargarRutaActiva(viajeActivo);
        }

        if (esPreparacion) {
          estadoActual = "Inicio de Recorridos";
          if (consoleNextStop) consoleNextStop.textContent = "Abordando pasajeros...";
        } else {
          estadoActual = "En Servicio";
        }
      } else {
        // --- CASO: FUERA DE SERVICIO ---
        if (!resCamion.ok) {
          MI_CAMION_ID = null;
        }

        if (viajeSiguiente) {
          if (routeDisplay) routeDisplay.textContent = "En Espera";
          estadoActual = "En Espera";
        } else {
          if (routeDisplay) routeDisplay.textContent = "Jornada Finalizada";
          estadoActual = "Fuera de Servicio";
        }
      }

      gestionarEstadoBD(estadoActual);
    } catch (error) {
      console.error("Error estado conductor:", error);
    }
  }

  // Nueva función para no saturar el servidor con PUTs repetidos
  async function gestionarEstadoBD(nuevoEstado) {
    if (ULTIMO_ESTADO_REPORTADO !== nuevoEstado) {
      try {
        console.log(
          `🔄 Actualizando estado en BD: ${ULTIMO_ESTADO_REPORTADO} -> ${nuevoEstado}`
        );

        // Usamos el endpoint de usuarios existente
        const userId = user._id || user.id;
        await fetch(`${BACKEND_URL}/api/users/${userId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          // Solo actualizamos el estado, mantenemos el tipo conductor
          body: JSON.stringify({
            estado: nuevoEstado,
            tipo: "conductor",
          }),
        });

        ULTIMO_ESTADO_REPORTADO = nuevoEstado;
      } catch (e) {
        console.error("Error sincronizando estado con BD", e);
      }
    }
  }
  // 7. REPORTAR INCIDENTE
  const incidentModal = document.getElementById("incident-modal");
  const btnMainReporte = document.getElementById("btn-reporte-incidente");
  const btnSendIncident = document.getElementById("send-incident");

  console.log("🛠️ Inicializando botón de reporte:", btnMainReporte ? "Encontrado ✅" : "No encontrado ❌");

  const btnCloseIncident = incidentModal ? incidentModal.querySelector(".close-button") : null;
  if (btnCloseIncident) {
    btnCloseIncident.onclick = () =>
      incidentModal.classList.remove("modal-visible");
  }

  if (btnMainReporte && incidentModal) {
    btnMainReporte.addEventListener("click", (e) => {
      e.preventDefault();
      console.log("⚠️ Abriendo modal de incidente...");
      incidentModal.classList.add("modal-visible");
    });
  }

  window.onclick = (event) => {
    if (event.target.classList.contains("modal")) {
      event.target.classList.remove("modal-visible");
    }
  };

  if (btnSendIncident) {
    btnSendIncident.onclick = () => {
      const incidentType = document.getElementById("incident-type").value;
      const incidentDetails = document.getElementById("incident-details").value;

      if (incidentType && MI_CAMION_ID) {
        socket.emit("incidentReport", {
          camionId: MI_CAMION_ID,
          tipo: incidentType,
          detalles: incidentDetails,
          hora: new Date().toISOString(),
        });

        incidentModal.classList.remove("modal-visible");
        alert("⚠️ Incidente reportado a los estudiantes.");

        document.getElementById("incident-type").value = "";
        document.getElementById("incident-details").value = "";
      } else if (!MI_CAMION_ID) {
        alert("No tienes un camión asignado para reportar incidentes.");
      } else {
        alert("Por favor selecciona un tipo de incidente.");
      }
    };
  }

  // frontend/assets/js/driver_map.js

  // 2. Escuchar el evento cuando un estudiante dice "Estoy Aquí"
  socket.on("studentWaiting", (data) => {
    console.log("🔔 Estudiante solicitando parada:", data);
    
    // 1. Mostrar Alerta HUD
    const alertId = `alert-${Date.now()}`;
    const alertHtml = `
      <div class="hud-alert-item" id="${alertId}">
        <div class="hud-alert-icon"><i class="fas fa-hand-paper"></i></div>
        <div class="hud-alert-content">
          <b>¡Parada Solicitada!</b>
          <small>Un estudiante te espera en la ruta</small>
        </div>
      </div>
    `;
    if (hudContainer) {
      hudContainer.insertAdjacentHTML('beforeend', alertHtml);
      // Vibración opcional
      if ("vibrate" in navigator) navigator.vibrate([100, 50, 100]);
      
      // Auto-eliminar alerta HUD después de 8 segundos
      setTimeout(() => {
        const el = document.getElementById(alertId);
        if (el) {
          el.classList.add('removing');
          setTimeout(() => el.remove(), 400);
        }
      }, 8000);
    }

    // 2. Actualizar contador en consola
    if (consolePassengers) {
      let current = parseInt(consolePassengers.textContent) || 0;
      consolePassengers.innerHTML = `${current + 1} <small>est.</small>`;
    }

    // 3. Agregar marcador al mapa (Existente)
    const studentEl = document.createElement('div');
    studentEl.className = "student-marker";
    studentEl.innerHTML = `<div style="background-color: #ffc107; color: #000; width: 30px; height: 30px; border-radius: 50%; border: 2px solid white; display: flex; justify-content: center; align-items: center; box-shadow: 0 2px 5px rgba(0,0,0,0.5); font-size: 14px;"><i class="fas fa-hand-paper"></i></div>`;

    const popup = new maplibregl.Popup({ offset: 15 }).setHTML(`<b>¡Parada Solicitada!</b>`);
    const marker = new maplibregl.Marker({ element: studentEl })
      .setLngLat([data.location.lng, data.location.lat])
      .setPopup(popup)
      .addTo(map);

    marker.togglePopup();
    setTimeout(() => marker.remove(), 300000);
  });

  // 8. PANEL DE COBROS
  const fullscreenCobros = document.getElementById("fullscreen-cobros");
  const btnOpenCobrosSidebar = document.getElementById("btn-open-cobros-sidebar");
  const btnCerrarCobros = document.getElementById("btn-cerrar-cobros");
  const cobrosFeed = document.getElementById("cobros-feed");
  const cobrosTotalHoy = document.getElementById("cobros-total-hoy");
  const btnCobroManual = document.getElementById("btn-cobro-manual");
  const cobroOrigen = document.getElementById("cobro-origen");
  const cobroDestino = document.getElementById("cobro-destino");
  const cobroTipoTarifa = document.getElementById("cobro-tipo-tarifa");
  const cobroRuta = document.getElementById("cobro-ruta");
  let todasLasTransacciones = [];

  async function abrirCobros() {
    if (sidebar) sidebar.classList.remove("active");
    fullscreenCobros.classList.add("active");
    if (cobroRuta) cobroRuta.textContent = MI_RUTA_NOMBRE || "Sin ruta activa";
    await cargarOrigenDestino();
    await cargarTransaccionesCamion();
    // Precargar precios reales en el dropdown (prioridad: tarifa de ruta > global)
    if (cobroTipoTarifa) {
      try {
        const res = await fetch(`${BACKEND_URL}/api/taquilla/tarifas`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const tarifas = await res.json();
          // Buscar primero tarifa específica de la ruta del conductor
          const viajeActual = MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL];
          const rutaIdActual = viajeActual?.rutaId || viajeActual?.ruta?._id || null;
          let tarifaActiva = rutaIdActual ? tarifas.find(t => t.rutaId === rutaIdActual) : null;
          // Si no hay tarifa de ruta, usar la global
          if (!tarifaActiva) tarifaActiva = tarifas.find(t => !t.rutaId);
          if (tarifaActiva) {
            cobroTipoTarifa.options[0].text = `General — $${tarifaActiva.precioGeneral.toFixed(2)}`;
            cobroTipoTarifa.options[1].text = `Estudiante — $${tarifaActiva.precioEstudiante.toFixed(2)}`;
          }
        }
      } catch (_) { /* fallback silencioso a $-- */ }
    }
  }

  function cargarOrigenDestino() {
    if (!window.stopMarkersArray || window.stopMarkersArray.length === 0) {
      if (cobroOrigen) cobroOrigen.innerHTML = '<option value="">-- Sin paradas --</option>';
      if (cobroDestino) cobroDestino.innerHTML = '<option value="">-- Sin paradas --</option>';
      return;
    }
    let html = '<option value="">-- Seleccionar --</option>';
    window.stopMarkersArray.forEach((m, i) => {
      const raw = m.getPopup()?.getContent();
      const nombre = (typeof raw === 'string' ? raw.replace(/<[^>]*>?/gm, '') : '') || `Parada ${i+1}`;
      html += `<option value="${i}">${nombre}</option>`;
    });
    if (cobroOrigen) cobroOrigen.innerHTML = html;
    if (cobroDestino) cobroDestino.innerHTML = html;
  }

  async function cargarTransaccionesCamion() {
    if (!MI_CAMION_ID) return;
    try {
      const res = await fetch(`${BACKEND_URL}/api/transacciones/camion/${MI_CAMION_ID}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Error");
      todasLasTransacciones = await res.json();
      renderCobrosFeed(todasLasTransacciones);
    } catch (e) {
      console.error("Error cargando transacciones:", e);
    }
  }

  function renderCobrosFeed(transacciones) {
    if (!cobrosFeed) return;
    if (transacciones.length === 0) {
      cobrosFeed.innerHTML = '<p class="placeholder-text" style="font-size:0.9rem; margin:20px 0;">Sin transacciones hoy</p>';
      if (cobrosTotalHoy) cobrosTotalHoy.textContent = "$0.00";
      return;
    }

    let totalHoy = 0;
    const hoy = new Date().toDateString();

    cobrosFeed.innerHTML = transacciones.map(t => {
      const esHoy = new Date(t.timestamp).toDateString() === hoy;
      if (esHoy) totalHoy += parseFloat(t.monto || 0);
      const fecha = new Date(t.timestamp).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      const tipoClase = t.tipo_tarifa === "Estudiante" ? "estudiante" : "general";
      return `<div class="cobro-item">
        <div class="cobro-info">
          <span class="cobro-nombre">${t.usuarioId?._id === (user._id || user.id) ? "Efectivo (Manual)" : (t.usuarioId?.nombre || "Anónimo")}</span>
          <span class="cobro-detalle">${fecha} · ${t.rutaId?.nombre || "N/A"} · ${t.cantidad_boletos} boleto(s)</span>
        </div>
        <span class="cobro-monto ${tipoClase}">-$${parseFloat(t.monto).toFixed(2)}</span>
      </div>`;
    }).join("");

    if (cobrosTotalHoy) cobrosTotalHoy.textContent = `$${totalHoy.toFixed(2)}`;
  }

  // Escuchar nuevas transacciones en tiempo real
  socket.on("nuevaTransaccion", (data) => {
    if (String(data.camionId) === String(MI_CAMION_ID)) {
      todasLasTransacciones.unshift(data);
      renderCobrosFeed(todasLasTransacciones);
      // Mostrar notificación HUD
      const alertId = `cobro-${Date.now()}`;
      const alertHtml = `
        <div class="hud-alert-item" id="${alertId}" style="background:rgba(46,204,113,0.9);">
          <div class="hud-alert-icon"><i class="fas fa-check-circle"></i></div>
          <div class="hud-alert-content">
            <b>¡Cobro Registrado!</b>
            <small>${data.usuarioId?.nombre || "Pasajero"} · $${parseFloat(data.monto).toFixed(2)}</small>
          </div>
        </div>
      `;
      if (hudContainer) {
        hudContainer.insertAdjacentHTML('beforeend', alertHtml);
        setTimeout(() => {
          const el = document.getElementById(alertId);
          if (el) { el.classList.add('removing'); setTimeout(() => el.remove(), 400); }
        }, 5000);
      }
    }
  });

  // Cobro manual — servidor calcula el precio, frontend espera confirmación
  if (btnCobroManual) {
    btnCobroManual.addEventListener("click", async () => {
      if (!MI_CAMION_ID) {
        Swal.fire({ icon: "warning", title: "Sin camión", text: "No tienes un camión asignado", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
        return;
      }
      const tipo = cobroTipoTarifa?.value || "General";
      const viajeActual = MIS_VIAJES_HOY[INDICE_VIAJE_ACTUAL];
      const rutaId = viajeActual?.rutaId || viajeActual?.ruta?._id || null;

      btnCobroManual.disabled = true;
      btnCobroManual.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';

      const payload = {
        camionId: MI_CAMION_ID,
        conductorId: user._id || user.id,
        tipo_tarifa: tipo,
        rutaId,
        rutaNombre: MI_RUTA_NOMBRE,
        timestamp: new Date()
      };

      // Emitir con callback + timeout de seguridad (10 segundos)
      const TIMEOUT_MS = 10000;
      let timeoutId = null;
      let respondido = false;

      const promesaCobro = new Promise((resolve) => {
        timeoutId = setTimeout(() => {
          if (!respondido) {
            respondido = true;
            resolve({ ok: false, error: "El servidor no respondió en 10 segundos. Verifica tu conexión." });
          }
        }, TIMEOUT_MS);

        socket.emit("cobroManual", payload, (respuesta) => {
          if (!respondido) {
            respondido = true;
            clearTimeout(timeoutId);
            resolve(respuesta);
          }
        });
      });

      try {
        const resultado = await promesaCobro;

        if (resultado && resultado.ok) {
          // Éxito: mostrar precio REAL del servidor
          Swal.mixin({ toast: true, position: "top-end", showConfirmButton: false, timer: 3000, background: "#1e1e1e", color: "#fff" })
            .fire({ icon: "success", title: `Cobro registrado: $${parseFloat(resultado.monto).toFixed(2)} (${resultado.tipo_tarifa || tipo})` });
        } else {
          // Error: mostrar mensaje del servidor o timeout
          Swal.fire({
            icon: "error",
            title: "Error al cobrar",
            text: resultado?.error || "Error desconocido al registrar el cobro",
            background: "#1e1e1e",
            color: "#fff",
            confirmButtonColor: "#0ea5e9"
          });
        }
      } catch (e) {
        console.error("Error en cobro manual:", e);
        Swal.fire({ icon: "error", title: "Error", text: "Error inesperado al registrar cobro", background: "#1e1e1e", color: "#fff", confirmButtonColor: "#0ea5e9" });
      } finally {
        setTimeout(() => {
          btnCobroManual.disabled = false;
          btnCobroManual.innerHTML = '<i class="fas fa-check-circle"></i> Registrar Cobro Manual';
        }, 1500); // Prevenir múltiples clicks accidentales (debounce)
      }
    });
  }

  if (btnOpenCobrosSidebar) {
    btnOpenCobrosSidebar.addEventListener("click", (e) => {
      e.preventDefault();
      abrirCobros();
    });
  }

  if (btnCerrarCobros) {
    btnCerrarCobros.addEventListener("click", () => {
      fullscreenCobros.classList.remove("active");
    });
  }

  // 9. CERRAR SESIÓN
  const btnLogout = document.getElementById("logout-button");
  const btnSidebarLogout = document.getElementById("sidebar-logout");

  function logoutAction(e) {
    e.preventDefault();
    if (confirm("¿Estás seguro de que quieres cerrar sesión?")) {
      localStorage.removeItem("tecbus_token");
      localStorage.removeItem("tecbus_user");
      window.location.href = "login.html";
    }
  }

  if (btnLogout) btnLogout.addEventListener("click", logoutAction);
  if (btnSidebarLogout)
    btnSidebarLogout.addEventListener("click", logoutAction);

  // 9. DROPDOWN PERFIL
  const profileToggle = document.getElementById("profile-toggle");
  const profileMenu = document.getElementById("profile-menu");

  if (user && document.getElementById("user-name-display")) {
    document.getElementById("user-name-display").textContent =
      user.nombre.split(" ")[0];
  }

  if (profileToggle) {
    profileToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      profileMenu.classList.toggle("show");
    });
  }

  // 7. ARRANCAR EL SISTEMA
  inicializarSistema();
  actualizarEstadoConductor();
  setInterval(actualizarEstadoConductor, 60000);
});
