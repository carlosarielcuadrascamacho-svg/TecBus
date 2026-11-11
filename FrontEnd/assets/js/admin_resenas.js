// frontend/assets/js/admin_resenas.js
//
// Panel de administración de reseñas: métricas, filtros y moderación.
// Todo el contenido del API se inserta con textContent.

(function () {
  "use strict";

  const TOKEN_KEY = "tecbus_token";
  const PAGE_SIZE = 25;
  let resenas = [];
  let page = 1;
  let pages = 1;
  let listController = null;

  function apiBase() {
    return window.BACKEND_URL || "https://tecbus-api.onrender.com";
  }

  function token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  }

  function $(id) {
    return document.getElementById(id);
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
      throw error;
    }

    return data;
  }

  function icono(clase) {
    const i = document.createElement("i");
    i.className = clase;
    i.setAttribute("aria-hidden", "true");
    return i;
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

  function estrellas(calificacion) {
    const wrap = document.createElement("span");
    wrap.className = "resenas-admin-stars";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", `${calificacion} de 5 estrellas`);

    for (let i = 1; i <= 5; i += 1) {
      wrap.appendChild(
        icono("fas fa-star" + (i > calificacion ? " is-off" : ""))
      );
    }

    return wrap;
  }

  function avatarFallback(nombre) {
    const span = document.createElement("span");
    span.className =
      "resenas-admin-avatar resenas-admin-avatar-fallback";
    span.textContent =
      String(nombre || "P").trim().charAt(0).toUpperCase() || "P";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function crearAvatar(resena) {
    if (resena.avatar) {
      const img = document.createElement("img");
      img.className = "resenas-admin-avatar";
      img.src = resena.avatar;
      img.alt = `Foto de ${resena.nombre || "pasajero"}`;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => {
        img.replaceWith(avatarFallback(resena.nombre));
      });
      return img;
    }

    return avatarFallback(resena.nombre);
  }

  function crearFila(resena) {
    const tr = document.createElement("tr");

    // Pasajero
    const tdUsuario = document.createElement("td");
    const usuario = document.createElement("div");
    usuario.className = "resenas-admin-user";
    usuario.appendChild(crearAvatar(resena));

    const info = document.createElement("div");
    const nombre = document.createElement("strong");
    nombre.textContent = resena.nombre || "Pasajero";
    const email = document.createElement("small");
    email.textContent = resena.email || "Sin correo";
    info.append(nombre, email);
    usuario.appendChild(info);
    tdUsuario.appendChild(usuario);

    // Calificación
    const tdCalificacion = document.createElement("td");
    tdCalificacion.appendChild(estrellas(resena.calificacion));

    // Ruta
    const tdRuta = document.createElement("td");
    const ruta = document.createElement("span");
    ruta.className = "badge badge-estudiante";
    ruta.textContent = resena.rutaNombre || "General";
    tdRuta.appendChild(ruta);

    // Comentario
    const tdComentario = document.createElement("td");
    const comentario = document.createElement("div");
    comentario.className = "resenas-admin-comment";
    comentario.textContent = resena.comentario || "";
    comentario.title = resena.comentario || "";
    tdComentario.appendChild(comentario);

    // Fecha
    const tdFecha = document.createElement("td");
    tdFecha.textContent = formatearFecha(resena.createdAt);
    tdFecha.style.whiteSpace = "nowrap";
    tdFecha.style.fontSize = "0.8rem";
    tdFecha.style.color = "#94a3b8";

    // Estado
    const tdEstado = document.createElement("td");
    const badges = document.createElement("div");
    badges.className = "resenas-admin-badges";

    const badgeVisible = document.createElement("span");
    badgeVisible.className =
      "badge " + (resena.visible ? "badge-success" : "badge-danger");
    badgeVisible.textContent = resena.visible ? "Visible" : "Oculta";
    badges.appendChild(badgeVisible);

    if (resena.destacada) {
      const badgeDestacada = document.createElement("span");
      badgeDestacada.className = "badge badge-warning";
      badgeDestacada.textContent = "Destacada";
      badges.appendChild(badgeDestacada);
    }

    tdEstado.appendChild(badges);

    // Acciones
    const tdAcciones = document.createElement("td");
    const acciones = document.createElement("div");
    acciones.className = "resenas-admin-actions";

    const btnVisible = document.createElement("button");
    btnVisible.type = "button";
    btnVisible.className = "btn btn-secondary btn-sm btn-toggle-resena";
    btnVisible.dataset.id = resena._id;
    btnVisible.dataset.visible = String(resena.visible);
    btnVisible.title = resena.visible ? "Ocultar reseña" : "Mostrar reseña";
    btnVisible.appendChild(
      icono(resena.visible ? "fas fa-eye-slash" : "fas fa-eye")
    );

    const btnDestacar = document.createElement("button");
    btnDestacar.type = "button";
    btnDestacar.className = "btn btn-secondary btn-sm btn-destacar-resena";
    btnDestacar.dataset.id = resena._id;
    btnDestacar.dataset.destacada = String(resena.destacada);
    btnDestacar.title = resena.destacada
      ? "Quitar de destacadas"
      : "Destacar reseña";
    btnDestacar.appendChild(icono("fas fa-thumbtack"));

    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger btn-sm btn-delete-resena";
    btnEliminar.dataset.id = resena._id;
    btnEliminar.title = "Eliminar reseña";
    btnEliminar.appendChild(icono("fas fa-trash"));

    acciones.append(btnVisible, btnDestacar, btnEliminar);
    tdAcciones.appendChild(acciones);

    tr.append(
      tdUsuario,
      tdCalificacion,
      tdRuta,
      tdComentario,
      tdFecha,
      tdEstado,
      tdAcciones
    );

    return tr;
  }

  function renderVacio(mensaje) {
    const tbody = $("tabla-resenas-body");
    if (!tbody) return;

    tbody.innerHTML = "";

    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;

    const empty = document.createElement("div");
    empty.className = "resenas-admin-empty";

    const icon = icono("fas fa-comment-slash");
    const p = document.createElement("p");
    p.textContent = mensaje;

    empty.append(icon, p);
    td.appendChild(empty);
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function renderPaginacionAdmin() {
    const pag = $("admin-resenas-paginacion");
    if (!pag) return;

    const info = $("admin-resenas-page-info");
    const prev = $("admin-resenas-prev");
    const next = $("admin-resenas-next");

    if (!resenas.length || pages <= 1) {
      pag.hidden = true;
      return;
    }

    pag.hidden = false;
    if (info) info.textContent = `Página ${page} de ${pages}`;
    if (prev) prev.disabled = page <= 1;
    if (next) next.disabled = page >= pages;
  }

  async function cargarResumenAdmin() {
    try {
      const data = await api("/api/resenas/admin/resumen");

      const promedio = $("kpi-resenas-promedio");
      const total = $("kpi-resenas-total");
      const visibles = $("kpi-resenas-visibles");
      const destacadas = $("kpi-resenas-destacadas");

      if (promedio) {
        promedio.textContent =
          data.visibles > 0 ? Number(data.promedio).toFixed(1) : "—";
      }
      if (total) total.textContent = String(data.total ?? 0);
      if (visibles) visibles.textContent = String(data.visibles ?? 0);
      if (destacadas) destacadas.textContent = String(data.destacadas ?? 0);
    } catch (error) {
      console.warn("No se pudo cargar el resumen de reseñas:", error.message);
    }
  }

  async function cargarResenasAdmin() {
    const tbody = $("tabla-resenas-body");
    if (!tbody) return;

    if (listController) listController.abort();
    listController = new AbortController();
    const { signal } = listController;

    const pag = $("admin-resenas-paginacion");
    if (pag) pag.hidden = true;

    tbody.innerHTML = "";
    const loading = document.createElement("tr");
    const tdLoading = document.createElement("td");
    tdLoading.colSpan = 7;
    tdLoading.style.textAlign = "center";
    tdLoading.style.padding = "30px";
    tdLoading.textContent = "Cargando reseñas…";
    loading.appendChild(tdLoading);
    tbody.appendChild(loading);

    const estado = $("filtro-resenas-estado")?.value || "todas";

    try {
      const data = await api(
        `/api/resenas/admin?estado=${encodeURIComponent(estado)}&page=${page}&limit=${PAGE_SIZE}`,
        { signal }
      );
      if (signal.aborted) return;

      const totalPages = data.pages || 1;
      if (totalPages > 0 && page > totalPages) {
        page = totalPages;
        return cargarResenasAdmin();
      }

      pages = totalPages;
      resenas = data.items || [];

      if (!resenas.length) {
        renderVacio("No hay reseñas con este filtro.");
        renderPaginacionAdmin();
        return;
      }

      tbody.innerHTML = "";
      resenas.forEach((resena) => tbody.appendChild(crearFila(resena)));
      renderPaginacionAdmin();
    } catch (error) {
      if (error.name === "AbortError" || signal.aborted) return;
      pages = 1;
      resenas = [];
      renderVacio(error.message || "No se pudieron cargar las reseñas.");
      renderPaginacionAdmin();
    }
  }

  function notificar(icon, title) {
    if (window.Swal) {
      window.Swal.fire({
        toast: true,
        position: "top-end",
        icon,
        title,
        showConfirmButton: false,
        timer: 1800,
        timerProgressBar: true,
      });
    }
  }

  function mostrarError(titulo, mensaje) {
    if (window.Swal) {
      window.Swal.fire({ icon: "error", title: titulo, text: mensaje });
    } else {
      window.alert(`${titulo}\n${mensaje}`);
    }
  }

  async function actualizarResena(id, cambios) {
    try {
      await api(`/api/resenas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cambios),
      });

      notificar("success", "Reseña actualizada");
      await Promise.all([cargarResenasAdmin(), cargarResumenAdmin()]);
    } catch (error) {
      mostrarError("No se pudo actualizar la reseña", error.message);
    }
  }

  async function eliminarResena(id) {
    let confirmado = false;

    if (window.Swal) {
      const result = await window.Swal.fire({
        title: "¿Eliminar esta reseña?",
        text: "Esta acción no se puede deshacer.",
        icon: "warning",
        showCancelButton: true,
        confirmButtonText: "Sí, eliminar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "#ef4444",
      });
      confirmado = result.isConfirmed;
    } else {
      confirmado = window.confirm("¿Eliminar esta reseña?");
    }

    if (!confirmado) return;

    try {
      await api(`/api/resenas/${id}`, { method: "DELETE" });
      notificar("success", "Reseña eliminada");
      await Promise.all([cargarResenasAdmin(), cargarResumenAdmin()]);
    } catch (error) {
      mostrarError("No se pudo eliminar la reseña", error.message);
    }
  }

  function init() {
    const tbody = $("tabla-resenas-body");
    if (!tbody) return;

    tbody.addEventListener("click", (event) => {
      const toggle = event.target.closest(".btn-toggle-resena");
      if (toggle) {
        actualizarResena(toggle.dataset.id, {
          visible: toggle.dataset.visible !== "true",
        });
        return;
      }

      const destacar = event.target.closest(".btn-destacar-resena");
      if (destacar) {
        actualizarResena(destacar.dataset.id, {
          destacada: destacar.dataset.destacada !== "true",
        });
        return;
      }

      const eliminar = event.target.closest(".btn-delete-resena");
      if (eliminar) eliminarResena(eliminar.dataset.id);
    });

    const filtro = $("filtro-resenas-estado");
    if (filtro) {
      filtro.addEventListener("change", () => {
        page = 1;
        cargarResenasAdmin();
      });
    }

    const prev = $("admin-resenas-prev");
    if (prev) {
      prev.addEventListener("click", () => {
        if (page <= 1) return;
        page -= 1;
        cargarResenasAdmin();
      });
    }

    const next = $("admin-resenas-next");
    if (next) {
      next.addEventListener("click", () => {
        if (page >= pages) return;
        page += 1;
        cargarResenasAdmin();
      });
    }

    const recargar = $("btn-recargar-resenas");
    if (recargar) {
      recargar.addEventListener("click", () => {
        cargarResenasAdmin();
        cargarResumenAdmin();
      });
    }

    const navLink = document.querySelector('a.nav-item[href="#resenas"]');
    if (navLink) {
      navLink.addEventListener("click", () => {
        cargarResenasAdmin();
        cargarResumenAdmin();
      });
    }

    if (window.location.hash === "#resenas") {
      cargarResenasAdmin();
      cargarResumenAdmin();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
