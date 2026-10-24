// Registro del service worker de la PWA.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => console.log("[PWA] Service Worker registrado:", reg.scope))
      .catch((err) => console.error("[PWA] Error registrando SW:", err));
  });
}
