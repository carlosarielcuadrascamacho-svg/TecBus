// frontend/assets/js/resenas.js
//
// Reseñas de pasajeros: landing pública + modal de captura (landing y app).
// Toda la información del API se renderiza con textContent para evitar XSS.

(function () {
  "use strict";

  const TOKEN_KEY = "tecbus_token";
  const USER_KEY = "tecbus_user";
  const PAGE_SIZE = 9;

  const state = {
    page: 1,
    pages: 1,
    rutaId: "",
    total: 0,
    promedio: 0,
    rutas: [],
    user: null,
    calificacion: 0,
    editing: false,
    googleReady: false,
    listController: null,
    myReviewController: null,
    formLoadId: 0,
  };

  function apiBase() {
    return window.BACKEND_URL || "https://tecbus-api.onrender.com";
  }

  function $(id) {
    return document.getElementById(id);
  }

  function token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function storedUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function guardarSesion(nuevoToken, user) {
    try {
      if (nuevoToken) localStorage.setItem(TOKEN_KEY, nuevoToken);
      if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  function limpiarSesion() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* almacenamiento no disponible */
    }
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const t = token();
    if (t) headers.set("Authorization", `Bearer ${t}`);

    const res = await fetch(apiBase() + path, {
      credentials: "include",
      ...options,
      headers,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      const error = new Error(
        data?.message || "No se pudo completar la solicitud."
      );
      error.status = res.status;
      error.data = data;
      throw error;
    }

    return data;
  }

  function crearIcono(clase) {
    const icon = document.createElement("i");
    icon.className = clase;
    icon.setAttribute("aria-hidden", "true");
    return icon;
  }

  function esUsuarioGoogle(user) {
    if (!user) return false;
    return (
      user.authProvider === "google" ||
      String(user.avatar || "").includes("googleusercontent.com")
    );
  }

  function renderBadgeVerificacion(el, esGoogle) {
    if (!el) return;
    el.textContent = "";
    el.appendChild(
      crearIcono(esGoogle ? "fas fa-circle-check" : "fas fa-user-check")
    );
    el.appendChild(
      document.createTextNode(
        esGoogle ? " Verificado con Google" : " Pasajero registrado"
      )
    );
  }

  function formatearFecha(iso) {
    if (!iso) return "";
    try {
      return new Intl.DateTimeFormat("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  // ─── Listado público ───────────────────────────────────────────────

  function crearAvatarFallback(nombre) {
    const span = document.createElement("span");
    span.className = "resena-avatar resena-avatar-fallback";
    span.textContent = String(nombre || "P").trim().charAt(0).toUpperCase() || "P";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function crearEstrellasCard(calificacion) {
    const wrap = document.createElement("span");
    wrap.className = "resena-card-stars";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", `${calificacion} de 5 estrellas`);

    for (let i = 1; i <= 5; i += 1) {
      wrap.appendChild(
        crearIcono("fas fa-star" + (i > calificacion ? " is-off" : ""))
      );
    }

    return wrap;
  }

  function crearTarjeta(item) {
    const card = document.createElement("article");
    card.className = "resena-card" + (item.destacada ? " is-destacada" : "");

    const head = document.createElement("div");
    head.className = "resena-card-head";

    if (item.avatar) {
      const img = document.createElement("img");
      img.className = "resena-avatar";
      img.src = item.avatar;
      img.alt = `Foto de ${item.nombre || "pasajero"}`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.replaceWith(crearAvatarFallback(item.nombre));
      });
      head.appendChild(img);
    } else {
      head.appendChild(crearAvatarFallback(item.nombre));
    }

    const autor = document.createElement("div");
    autor.className = "resena-autor";

    const nombre = document.createElement("strong");
    nombre.textContent = item.nombre || "Pasajero";

    const verificado = document.createElement("span");
    renderBadgeVerificacion(verificado, Boolean(item.verificadoGoogle));

    autor.append(nombre, verificado);
    head.append(autor, crearEstrellasCard(item.calificacion));

    card.appendChild(head);

    if (item.destacada) {
      const badge = document.createElement("span");
      badge.className = "resena-badge";
      badge.appendChild(crearIcono("fas fa-thumbtack"));
      badge.appendChild(document.createTextNode(" Destacada"));
      card.appendChild(badge);
    }

    const comentario = document.createElement("p");
    comentario.className = "resena-comentario";
    comentario.textContent = item.comentario;

    const foot = document.createElement("div");
    foot.className = "resena-card-foot";

    const ruta = document.createElement("span");
    ruta.className = "resena-ruta-tag";
    ruta.appendChild(crearIcono("fas fa-route"));
    ruta.appendChild(
      document.createTextNode(" " + (item.rutaNombre || "Servicio general"))
    );

    const fecha = document.createElement("span");
    fecha.className = "resena-fecha";
    fecha.textContent = formatearFecha(item.createdAt);
    if (item.updatedAt && item.updatedAt !== item.createdAt) {
      fecha.title = "Reseña actualizada";
    }

    foot.append(ruta, fecha);
    card.append(comentario, foot);

    return card;
  }

  function renderSkeletons(grid) {
    grid.hidden = false;
    grid.innerHTML = "";
    grid.setAttribute("aria-busy", "true");

    const vacio = $("resenas-vacio");
    if (vacio) vacio.hidden = true;

    for (let i = 0; i < 3; i += 1) {
      const card = document.createElement("div");
      card.className = "resena-card resena-skeleton";
      card.innerHTML = `
        <div class="resena-card-head">
          <div class="resena-skeleton-line is-avatar"></div>
          <div style="flex:1">
            <div class="resena-skeleton-line" style="width:45%;margin-bottom:8px"></div>
            <div class="resena-skeleton-line" style="width:30%"></div>
          </div>
        </div>
        <div class="resena-skeleton-line" style="width:92%;margin-top:6px"></div>
        <div class="resena-skeleton-line" style="width:100%;margin-top:8px"></div>
        <div class="resena-skeleton-line" style="width:68%;margin-top:8px"></div>
      `;
      grid.appendChild(card);
    }
  }

  function renderResenas(items) {
    const grid = $("resenas-grid");
    const vacio = $("resenas-vacio");
    if (!grid) return;

    grid.innerHTML = "";

    if (!items.length) {
      grid.hidden = true;
      if (vacio) vacio.hidden = false;
      return;
    }

    grid.hidden = false;
    if (vacio) vacio.hidden = true;

    items.forEach((item) => grid.appendChild(crearTarjeta(item)));
  }

  function renderErrorLista(grid, mensaje) {
    grid.hidden = false;
    grid.innerHTML = "";

    const box = document.createElement("div");
    box.className = "resenas-vacio";
    box.style.gridColumn = "1 / -1";

    const icon = document.createElement("span");
    icon.className = "resenas-vacio-icon";
    icon.appendChild(crearIcono("fas fa-triangle-exclamation"));

    const titulo = document.createElement("h3");
    titulo.textContent = "No pudimos cargar las reseñas";

    const texto = document.createElement("p");
    texto.textContent = mensaje || "Revisa tu conexión e inténtalo de nuevo.";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = "Reintentar";
    btn.addEventListener("click", () => cargarResenas());

    box.append(icon, titulo, texto, btn);
    grid.appendChild(box);
  }

  function renderPaginacion() {
    const pag = $("resenas-paginacion");
    const info = $("resenas-page-info");
    const prev = $("resenas-prev");
    const next = $("resenas-next");

    if (!pag) return;

    if (state.pages <= 1) {
      pag.hidden = true;
      return;
    }

    pag.hidden = false;
    if (info) info.textContent = `${state.page} / ${state.pages}`;
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= state.pages;
  }

  async function cargarResenas() {
    const grid = $("resenas-grid");
    if (!grid) return;

    if (state.listController) state.listController.abort();
    state.listController = new AbortController();
    const { signal } = state.listController;

    renderSkeletons(grid);

    const params = new URLSearchParams();
    params.set("page", String(state.page));
    params.set("limit", String(PAGE_SIZE));
    if (state.rutaId) params.set("rutaId", state.rutaId);

    try {
      const data = await api(`/api/resenas?${params.toString()}`, { signal });
      if (signal.aborted) return;

      const pages = data.pages || 1;

      if (pages > 0 && state.page > pages) {
        state.page = pages;
        return cargarResenas();
      }

      state.total = data.total || 0;
      state.pages = pages;

      renderResenas(data.items || []);
      renderPaginacion();
      grid.setAttribute("aria-busy", "false");
    } catch (error) {
      if (error.name === "AbortError" || signal.aborted) return;
      renderErrorLista(grid, error.message);
      const pag = $("resenas-paginacion");
      if (pag) pag.hidden = true;
      grid.setAttribute("aria-busy", "false");
    }
  }

  function renderPromedioEstrellas(promedio, total) {
    const cont = $("resenas-promedio-estrellas");
    if (!cont) return;

    cont.innerHTML = "";

    const base = document.createElement("div");
    base.className = "resenas-stars-row";

    const fill = document.createElement("div");
    fill.className = "resenas-stars-row resenas-stars-fill";
    const pct = total > 0 ? (Math.max(0, Math.min(5, promedio)) / 5) * 100 : 0;
    fill.style.width = `${pct}%`;

    for (let i = 0; i < 5; i += 1) {
      base.appendChild(crearIcono("fas fa-star"));
      fill.appendChild(crearIcono("fas fa-star"));
    }

    cont.append(base, fill);
    cont.setAttribute(
      "aria-label",
      total > 0
        ? `Calificación promedio ${promedio.toFixed(1)} de 5`
        : "Sin calificaciones todavía"
    );
  }

  function renderDistribucion(resumen) {
    const cont = $("resenas-distribucion");
    if (!cont) return;

    cont.innerHTML = "";

    const total = resumen.total || 0;

    for (let estrella = 5; estrella >= 1; estrella -= 1) {
      const cantidad = resumen.distribucion?.[estrella] || 0;
      const pct = total > 0 ? (cantidad / total) * 100 : 0;

      const row = document.createElement("div");
      row.className = "resenas-dist-row";

      const label = document.createElement("span");
      label.className = "resenas-dist-label";
      label.textContent = String(estrella);

      const track = document.createElement("span");
      track.className = "resenas-dist-track";

      const barra = document.createElement("span");
      barra.className = "resenas-dist-fill";
      barra.style.width = `${pct}%`;
      track.appendChild(barra);

      const count = document.createElement("span");
      count.className = "resenas-dist-count";
      count.textContent = String(cantidad);

      row.append(label, track, count);
      cont.appendChild(row);
    }
  }

  function renderChips(resumen) {
    const cont = $("resenas-rutas-chips");
    if (!cont) return;

    cont.innerHTML = "";

    const opciones = [{ id: "", nombre: "Todas" }];
    (resumen.rutas || []).forEach((r) => {
      opciones.push({
        id: r.rutaId || "general",
        nombre: r.rutaNombre || "Servicio general",
        promedio: r.promedio,
        total: r.total,
      });
    });

    opciones.forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "resenas-chip" + (state.rutaId === op.id ? " is-active" : "");
      btn.dataset.rutaId = op.id;
      btn.textContent = op.nombre;
      if (op.total) {
        btn.title = `${op.promedio} de 5 · ${op.total} reseña${
          op.total === 1 ? "" : "s"
        }`;
      }
      cont.appendChild(btn);
    });
  }

  async function cargarResumen() {
    const promedioEl = $("resenas-promedio");
    const totalEl = $("resenas-total");

    try {
      const resumen = await api("/api/resenas/resumen");
      state.total = resumen.total || 0;
      state.promedio = resumen.promedio || 0;

      if (promedioEl) {
        promedioEl.textContent =
          state.total > 0 ? state.promedio.toFixed(1) : "—";
      }

      if (totalEl) {
        totalEl.textContent =
          state.total > 0
            ? `${state.total} reseña${state.total === 1 ? "" : "s"} de pasajeros`
            : "Aún sin calificaciones";
      }

      renderPromedioEstrellas(state.promedio, state.total);
      renderDistribucion(resumen);
      renderChips(resumen);
    } catch {
      if (promedioEl) promedioEl.textContent = "—";
      if (totalEl) totalEl.textContent = "No se pudo cargar el resumen";
    }
  }

  // ─── Formulario y modal ────────────────────────────────────────────

  async function cargarRutas() {
    const select = $("review-ruta");
    if (!select) return;

    try {
      const rutas = await api("/api/rutas");
      state.rutas = Array.isArray(rutas)
        ? rutas.filter((r) => r.activa !== false)
        : [];

      const valorActual = select.value;
      select.innerHTML = "";

      const general = document.createElement("option");
      general.value = "";
      general.textContent = "Servicio general";
      select.appendChild(general);

      state.rutas.forEach((r) => {
        const opt = document.createElement("option");
        opt.value = r._id;
        opt.textContent = r.nombre;
        select.appendChild(opt);
      });

      if (valorActual && state.rutas.some((r) => r._id === valorActual)) {
        select.value = valorActual;
      }
    } catch {
      // Si falla, el select conserva la opción "Servicio general".
    }
  }

  function actualizarEstrellasInput(valor) {
    document.querySelectorAll("#review-stars .review-star").forEach((btn) => {
      btn.classList.toggle("is-filled", Number(btn.dataset.value) <= valor);
    });
  }

  function setRating(valor, { focus = false } = {}) {
    state.calificacion = valor;
    actualizarEstrellasInput(valor);

    const hint = $("review-stars-hint");
    if (hint) {
      hint.classList.remove("is-error");
      hint.textContent =
        valor > 0
          ? `${valor} estrella${valor === 1 ? "" : "s"}`
          : "Selecciona una calificación";
    }

    const botones = Array.from(
      document.querySelectorAll("#review-stars .review-star")
    );

    botones.forEach((btn, idx) => {
      const activo = Number(btn.dataset.value) === valor;
      btn.setAttribute("aria-checked", activo ? "true" : "false");
      btn.tabIndex = (valor === 0 && idx === 0) || activo ? 0 : -1;
    });

    if (focus) {
      const target = botones.find(
        (b) => Number(b.dataset.value) === valor
      );
      if (target) target.focus();
    }
  }

  function manejarTeclasEstrellas(event) {
    const teclas = [
      "ArrowRight",
      "ArrowUp",
      "ArrowLeft",
      "ArrowDown",
      "Home",
      "End",
    ];

    if (!teclas.includes(event.key)) return;
    event.preventDefault();

    let valor = state.calificacion || 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      valor = Math.min(5, valor + 1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      valor = Math.max(1, valor - 1);
    }
    if (event.key === "Home") valor = 1;
    if (event.key === "End") valor = 5;

    setRating(valor, { focus: true });
  }

  function renderStarInput() {
    const cont = $("review-stars");
    if (!cont) return;

    if (cont.childElementCount) {
      actualizarEstrellasInput(state.calificacion);
      return;
    }

    for (let i = 1; i <= 5; i += 1) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "review-star";
      btn.dataset.value = String(i);
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-checked", "false");
      btn.setAttribute("aria-label", `${i} estrella${i === 1 ? "" : "s"}`);
      btn.tabIndex = i === 1 ? 0 : -1;
      btn.appendChild(crearIcono("fas fa-star"));

      btn.addEventListener("click", () => setRating(i));
      btn.addEventListener("focus", () => actualizarEstrellasInput(i));
      btn.addEventListener("blur", () =>
        actualizarEstrellasInput(state.calificacion)
      );
      btn.addEventListener("keydown", manejarTeclasEstrellas);

      cont.appendChild(btn);
    }

    actualizarEstrellasInput(state.calificacion);
  }

  function actualizarContador() {
    const textarea = $("review-comentario");
    const contador = $("review-counter");
    if (!textarea || !contador) return;

    const len = textarea.value.length;
    contador.textContent = String(len);
    if (contador.parentElement) {
      contador.parentElement.classList.toggle("is-near-limit", len >= 560);
    }
  }

  function aplicarResenaExistente(item) {
    state.editing = true;
    setRating(item.calificacion);

    const textarea = $("review-comentario");
    if (textarea) textarea.value = item.comentario || "";
    actualizarContador();

    const btn = $("review-submit");
    const span = btn ? btn.querySelector("span") : null;
    if (span) span.textContent = "Actualizar reseña";

    const subtitle = $("review-modal-subtitle");
    if (subtitle) {
      subtitle.textContent =
        "Ya tienes una reseña aquí. Puedes actualizarla cuando quieras.";
    }
  }

  function resetFormulario() {
    state.editing = false;
    setRating(0);

    const textarea = $("review-comentario");
    if (textarea) textarea.value = "";
    actualizarContador();

    const btn = $("review-submit");
    const span = btn ? btn.querySelector("span") : null;
    if (span) span.textContent = "Publicar reseña";

    const subtitle = $("review-modal-subtitle");
    if (subtitle) {
      subtitle.textContent =
        "Tu opinión ayuda a que más personas viajen con confianza.";
    }

    const error = $("review-error");
    if (error) error.textContent = "";
  }

  function setFormLoading(loading) {
    const form = $("review-form");
    if (!form) return;
    form.querySelectorAll("select, textarea, button").forEach((el) => {
      el.disabled = loading;
    });
  }

  async function cargarMisResenas(loadId = ++state.formLoadId) {
    if (!state.user || !token()) return;

    if (state.myReviewController) state.myReviewController.abort();
    state.myReviewController = new AbortController();
    const { signal } = state.myReviewController;

    setFormLoading(true);
    const subtitle = $("review-modal-subtitle");
    if (subtitle) subtitle.textContent = "Cargando tu historial de reseñas…";

    const select = $("review-ruta");
    const rutaId = select ? select.value : "";
    const query = rutaId
      ? `?rutaId=${encodeURIComponent(rutaId)}`
      : "?rutaId=general";

    try {
      const data = await api(`/api/resenas/mia${query}`, { signal });
      if (signal.aborted || state.formLoadId !== loadId) return;

      const item = data.items?.[0];
      if (item) aplicarResenaExistente(item);
      else resetFormulario();
    } catch (error) {
      if (error.name === "AbortError" || signal.aborted || state.formLoadId !== loadId) {
        return;
      }
      if (error.status === 401) {
        limpiarSesion();
        state.user = null;
        mostrarAuth(
          "Tu sesión expiró. Vuelve a verificar tu cuenta con Google."
        );
      } else {
        resetFormulario();
      }
    } finally {
      if (!signal.aborted && state.formLoadId === loadId) {
        setFormLoading(false);
      }
    }
  }

  function mostrarAuth(mensaje = "") {
    state.formLoadId += 1;
    if (state.myReviewController) {
      state.myReviewController.abort();
      state.myReviewController = null;
    }
    setFormLoading(false);

    const auth = $("review-auth");
    const form = $("review-form");
    const success = $("review-success");

    if (auth) auth.hidden = false;
    if (form) form.hidden = true;
    if (success) success.hidden = true;

    const msg = $("review-auth-message");
    if (msg) msg.textContent = mensaje;

    initGoogleButton();
  }

  function mostrarFormulario(user) {
    state.user = user || storedUser();
    const loadId = ++state.formLoadId;
    if (state.myReviewController) {
      state.myReviewController.abort();
      state.myReviewController = null;
    }

    const auth = $("review-auth");
    const form = $("review-form");
    const success = $("review-success");

    if (auth) auth.hidden = true;
    if (form) form.hidden = false;
    if (success) success.hidden = true;

    const nombre = $("review-user-name");
    const avatar = $("review-user-avatar");

    if (nombre) nombre.textContent = state.user?.nombre || "Pasajero";
    renderBadgeVerificacion($("review-user-badge"), esUsuarioGoogle(state.user));

    if (avatar) {
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "assets/img/icons/icon-192x192.png";
        avatar.alt = "";
      };
      if (state.user?.avatar) {
        avatar.src = state.user.avatar;
        avatar.alt = `Foto de ${state.user.nombre || "pasajero"}`;
        avatar.referrerPolicy = "no-referrer";
      } else {
        avatar.src = "assets/img/icons/icon-192x192.png";
        avatar.alt = "";
      }
    }

    resetFormulario();
    setFormLoading(true);
    const subtitle = $("review-modal-subtitle");
    if (subtitle) subtitle.textContent = "Cargando tu historial de reseñas…";

    renderStarInput();
    cargarRutas().then(() => {
      if (state.formLoadId !== loadId || !$("review-modal")?.open) return;
      cargarMisResenas(loadId);
    });
  }

  function mostrarExito(mensaje) {
    state.formLoadId += 1;
    if (state.myReviewController) {
      state.myReviewController.abort();
      state.myReviewController = null;
    }
    setFormLoading(false);

    const auth = $("review-auth");
    const form = $("review-form");
    const success = $("review-success");

    if (auth) auth.hidden = true;
    if (form) form.hidden = true;
    if (success) success.hidden = false;

    const text = $("review-success-text");
    if (text) text.textContent = mensaje || "Tu opinión ya está publicada.";
  }

  function limpiarEstadoModal() {
    state.formLoadId += 1;
    if (state.myReviewController) {
      state.myReviewController.abort();
      state.myReviewController = null;
    }
    setFormLoading(false);

    const msg = $("review-auth-message");
    if (msg) msg.textContent = "";
  }

  function abrirModal() {
    const modal = $("review-modal");
    if (!modal) return;

    const sidebar = $("sidebar");
    if (sidebar) sidebar.classList.remove("active");

    const user = storedUser();
    state.user = user && token() ? user : null;

    if (!modal.open) modal.showModal();

    if (state.user) mostrarFormulario(state.user);
    else mostrarAuth();

    const closeBtn = $("review-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function cerrarModal() {
    const modal = $("review-modal");
    if (!modal) return;

    if (modal.open) {
      modal.close();
    } else {
      limpiarEstadoModal();
    }
  }

  async function manejarEnvio(event) {
    event.preventDefault();

    const boton = $("review-submit");
    if (boton?.disabled) return;

    const errorEl = $("review-error");
    const hint = $("review-stars-hint");
    if (errorEl) errorEl.textContent = "";

    if (!state.calificacion) {
      if (hint) {
        hint.textContent = "Elige una calificación de 1 a 5 estrellas.";
        hint.classList.add("is-error");
      }
      return;
    }

    const textarea = $("review-comentario");
    const comentario = (textarea?.value || "").trim();

    if (comentario.length < 10) {
      if (errorEl) {
        errorEl.textContent =
          "El comentario debe tener al menos 10 caracteres.";
      }
      if (textarea) textarea.focus();
      return;
    }

    if (comentario.length > 600) {
      if (errorEl) {
        errorEl.textContent =
          "El comentario no puede superar los 600 caracteres.";
      }
      return;
    }

    const select = $("review-ruta");
    if (boton) {
      boton.disabled = true;
      const span = boton.querySelector("span");
      if (span) span.textContent = "Publicando…";
    }

    try {
      const data = await api("/api/resenas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calificacion: state.calificacion,
          comentario,
          rutaId: select && select.value ? select.value : null,
        }),
      });

      mostrarExito(data?.message);

      if ($("resenas-grid")) {
        cargarResumen();
        cargarResenas();
      }
    } catch (error) {
      if (error.status === 401) {
        limpiarSesion();
        state.user = null;
        mostrarAuth(
          "Tu sesión expiró. Vuelve a verificar tu cuenta con Google."
        );
      } else if (errorEl) {
        errorEl.textContent = error.message;
      }
    } finally {
      if (boton) {
        boton.disabled = false;
        const span = boton.querySelector("span");
        if (span) {
          span.textContent = state.editing
            ? "Actualizar reseña"
            : "Publicar reseña";
        }
      }
    }
  }

  // ─── Google Identity Services ──────────────────────────────────────

  function cargarGoogleScript() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.id) {
        resolve();
        return;
      }

      const existente = document.querySelector("script[data-tecbus-gsi]");
      if (existente) {
        existente.addEventListener("load", () => resolve(), { once: true });
        existente.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      script.dataset.tecbusGsi = "true";
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  }

  async function iniciarGoogleNativo(btn) {
    const msg = $("review-auth-message");
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = "Conectando con Google…";

    try {
      if (!window.SocialLogin) {
        throw new Error("El acceso nativo con Google no está disponible.");
      }

      await window.SocialLogin.initialize({
        google: {
          webClientId: window.GOOGLE_CLIENT_ID,
          mode: "online",
        },
      });

      const res = await window.SocialLogin.login({
        provider: "google",
        options: {},
      });

      const idToken = res?.result?.idToken || res?.idToken;
      if (!idToken) {
        throw new Error("Google no devolvió una credencial válida.");
      }

      await manejarCredencialGoogle({ credential: idToken });
    } catch (error) {
      if (msg) {
        msg.textContent =
          error?.message || "No se pudo completar el acceso con Google.";
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function initGoogleButton() {
    const cont = $("review-google-btn");
    if (!cont || state.googleReady) return;

    if (window.Capacitor?.isNativePlatform?.()) {
      cont.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "review-google-native-btn";
      btn.appendChild(crearIcono("fab fa-google"));
      btn.appendChild(document.createTextNode("Continuar con Google"));
      btn.addEventListener("click", () => iniciarGoogleNativo(btn));
      cont.appendChild(btn);
      state.googleReady = true;
      return;
    }

    try {
      await cargarGoogleScript();

      if (!window.google?.accounts?.id) {
        throw new Error("Google no está disponible.");
      }

      window.google.accounts.id.initialize({
        client_id: window.GOOGLE_CLIENT_ID,
        callback: manejarCredencialGoogle,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      const availableWidth = cont.clientWidth || window.innerWidth - 64;
      const btnWidth = Math.max(200, Math.min(300, Math.floor(availableWidth)));

      cont.innerHTML = "";
      window.google.accounts.id.renderButton(cont, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "continue_with",
        locale: "es",
        width: btnWidth,
      });

      state.googleReady = true;
    } catch {
      cont.innerHTML = "";
      const p = document.createElement("p");
      p.className = "review-error";
      p.textContent =
        "No se pudo cargar el acceso con Google. Revisa tu conexión e inténtalo de nuevo.";
      cont.appendChild(p);
    }
  }

  async function manejarCredencialGoogle(response) {
    if (!response?.credential) return;

    const msg = $("review-auth-message");
    if (msg) msg.textContent = "Verificando tu cuenta con Google…";

    try {
      const res = await fetch(apiBase() + "/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ credential: response.credential }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || "No se pudo verificar tu cuenta.");
      }

      guardarSesion(data.token, data.user);
      mostrarFormulario(data.user);
    } catch (error) {
      if (msg) msg.textContent = error.message;
    }
  }

  // ─── Inicialización ────────────────────────────────────────────────

  function initLanding() {
    const grid = $("resenas-grid");
    if (!grid) return;

    const chips = $("resenas-rutas-chips");
    if (chips) {
      chips.addEventListener("click", (event) => {
        const chip = event.target.closest(".resenas-chip");
        if (!chip) return;

        state.rutaId = chip.dataset.rutaId || "";
        state.page = 1;

        chips.querySelectorAll(".resenas-chip").forEach((c) => {
          c.classList.toggle("is-active", c === chip);
        });

        cargarResenas();
      });
    }

    const prev = $("resenas-prev");
    const next = $("resenas-next");

    if (prev) {
      prev.addEventListener("click", () => {
        if (state.page <= 1) return;
        state.page -= 1;
        cargarResenas();
      });
    }

    if (next) {
      next.addEventListener("click", () => {
        if (state.page >= state.pages) return;
        state.page += 1;
        cargarResenas();
      });
    }

    cargarResumen();
    cargarResenas();
  }

  function initModal() {
    const modal = $("review-modal");
    if (!modal) return;

    document
      .querySelectorAll(
        "#btn-abrir-resena, [data-abrir-resena], #btn-open-resenas"
      )
      .forEach((btn) => {
        btn.addEventListener("click", (event) => {
          event.preventDefault();
          abrirModal();
        });
      });

    const close = $("review-modal-close");
    if (close) close.addEventListener("click", cerrarModal);

    modal.querySelectorAll("[data-cerrar-resena]").forEach((el) => {
      el.addEventListener("click", cerrarModal);
    });

    modal.addEventListener("close", limpiarEstadoModal);

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      let backdropPointerDown = false;
      const estaFuera = (event) => {
        if (event.target !== modal) return false;
        const rect = modal.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };

      modal.addEventListener("pointerdown", (event) => {
        backdropPointerDown = estaFuera(event);
      });
      modal.addEventListener("pointerup", (event) => {
        if (backdropPointerDown && estaFuera(event)) {
          cerrarModal();
        }
        backdropPointerDown = false;
      });
    }

    const form = $("review-form");
    if (form) form.addEventListener("submit", manejarEnvio);

    const textarea = $("review-comentario");
    if (textarea) {
      textarea.addEventListener("input", actualizarContador);
      textarea.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          form?.requestSubmit();
        }
      });
    }

    const select = $("review-ruta");
    if (select) select.addEventListener("change", () => cargarMisResenas());

    const stars = $("review-stars");
    if (stars) {
      stars.addEventListener("mouseover", (event) => {
        const btn = event.target.closest(".review-star");
        if (btn) actualizarEstrellasInput(Number(btn.dataset.value));
      });
      stars.addEventListener("mouseleave", () =>
        actualizarEstrellasInput(state.calificacion)
      );
    }
  }

  function init() {
    initLanding();
    initModal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
