// FrontEnd/assets/js/pwa-install.js - PWA Install Prompt Handler

(function () {
  'use strict';

  let deferredPrompt = null;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  // No mostrar nada si ya está instalada
  if (isStandalone) {
    console.log('[PWA] App ya instalada, omitiendo prompt de instalación.');
    return;
  }

  // ─── Chrome/Edge/Android: Capturar evento beforeinstallprompt ───
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log('[PWA] Install prompt disponible.');
    showInstallBanner();
  });

  // ─── Crear banner de instalación ───
  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-icon">
          <i class="fas fa-download"></i>
        </div>
        <div class="pwa-banner-text">
          <strong>Instala SmartBus</strong>
          <span>Accede más rápido desde tu pantalla de inicio</span>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-install-btn" class="pwa-banner-btn">Instalar</button>
          <button id="pwa-dismiss-btn" class="pwa-banner-btn-dismiss">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('pwa-install-btn').addEventListener('click', handleInstall);
    document.getElementById('pwa-dismiss-btn').addEventListener('click', dismissBanner);

    // Auto-dismiss después de 15 segundos
    setTimeout(() => {
      if (document.getElementById('pwa-install-banner')) {
        dismissBanner();
      }
    }, 15000);
  }

  // ─── Manejar instalación ───
  async function handleInstall() {
    if (!deferredPrompt) {
      console.log('[PWA] No hay prompt disponible.');
      return;
    }

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Resultado de instalación:', outcome);

    if (outcome === 'accepted') {
      console.log('[PWA] Usuario aceptó la instalación.');
    }

    deferredPrompt = null;
    dismissBanner();
  }

  // ─── Cerrar banner ───
  function dismissBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (banner) {
      banner.classList.add('pwa-banner-hiding');
      setTimeout(() => banner.remove(), 300);
    }
    try {
      localStorage.setItem('pwa-banner-dismissed', Date.now().toString());
    } catch (e) {}
  }

  // ─── iOS: Mostrar instrucciones manuales ───
  function showIOSInstructions() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.classList.add('pwa-ios-banner');
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-icon" style="color: #fff; background: #333;">
          <i class="fab fa-apple"></i>
        </div>
        <div class="pwa-banner-text">
          <strong>Agregar a Inicio</strong>
          <span>Toca <i class="fas fa-share-square"></i> y luego "Agregar a pantalla de inicio"</span>
        </div>
        <div class="pwa-banner-actions">
          <button id="pwa-dismiss-btn" class="pwa-banner-btn-dismiss">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);
    document.getElementById('pwa-dismiss-btn').addEventListener('click', dismissBanner);
  }

  // ─── Detectar si es iOS sin Safari standalone ───
  if (isIOS && !isStandalone) {
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
    if (isSafari) {
      // Solo mostrar en la landing page
      if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        showIOSInstructions();
      }
    }
  }

  // ─── Exponer función global para botón manual de instalación ───
  window.triggerPWAInstall = function () {
    if (deferredPrompt) {
      handleInstall();
    } else if (isIOS) {
      showIOSInstructions();
    } else {
      console.log('[PWA] La instalación no está disponible en este navegador.');
    }
  };

  // ─── Escuchar instalación exitosa ───
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] App instalada exitosamente.');
    dismissBanner();
    deferredPrompt = null;
  });

})();
