// Interacciones de la página de inicio.
// Navbar con fondo al hacer scroll
window.addEventListener("scroll", () => {
  const nav = document.querySelector(".navbar");
  if (nav) nav.classList.toggle("scrolled", window.scrollY > 20);
});

// Scroll Spy: actualiza el menú activo según la sección visible
const seccionesLanding = document.querySelectorAll("header, section");
const enlacesLanding = document.querySelectorAll(".nav-menu .nav-link");

window.addEventListener("scroll", () => {
  let actual = "";

  seccionesLanding.forEach((seccion) => {
    const top = seccion.offsetTop;
    if (window.scrollY >= top - 100) {
      actual = seccion.getAttribute("id");
    }
  });

  enlacesLanding.forEach((link) => {
    link.classList.remove("active");
    if (actual && link.getAttribute("href").includes(actual)) {
      link.classList.add("active");
    }
  });
});

// Acordeón de preguntas frecuentes
document.querySelectorAll(".accordion-header").forEach((button) => {
  button.addEventListener("click", () => {
    const item = button.parentElement;
    document.querySelectorAll(".accordion-item").forEach((other) => {
      if (other !== item) other.classList.remove("active");
    });
    item.classList.toggle("active");
  });
});

// Menú móvil
const mobileToggle = document.getElementById("mobile-toggle");
const navMenu = document.getElementById("nav-menu");
const navLinks = document.querySelectorAll(".nav-link");

if (mobileToggle && navMenu) {
  mobileToggle.addEventListener("click", () => {
    navMenu.classList.toggle("active");

    const icon = mobileToggle.querySelector("i");
    if (icon) {
      if (navMenu.classList.contains("active")) {
        icon.classList.remove("fa-bars");
        icon.classList.add("fa-times");
      } else {
        icon.classList.remove("fa-times");
        icon.classList.add("fa-bars");
      }
    }
  });
}

navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    if (!navMenu) return;
    navMenu.classList.remove("active");

    const icon = mobileToggle && mobileToggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-times");
      icon.classList.add("fa-bars");
    }
  });
});
