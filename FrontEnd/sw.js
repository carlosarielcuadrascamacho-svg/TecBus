// FrontEnd/sw.js - SmartBus PWA Service Worker

// Subir la versión cuando cambie un asset: el fetch de nuestros JS/CSS es
// cache-first, así que sin bump los navegadores siguen usando el archivo viejo.
const CACHE_NAME = 'tecbus-v17';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/registro.html',
  '/pasajero.html',
  '/conductor.html',
  '/admin.html',
  '/politica_privacidad.html',
  '/terminos_condiciones.html',
  '/manifest.webmanifest',
  '/assets/css/base.css?v=2026.2',
  '/assets/css/landing_style.css',
  '/assets/css/passenger.css?v=2026.4',
  '/assets/css/driver.css',
  '/assets/css/admin.css',
  '/assets/css/sostenibilidad.css?v=2.1',
  '/assets/js/config.js?v=2',
  '/assets/js/api_client.js?v=1',
  '/assets/js/pwa.js?v=2',
  '/assets/js/password_toggle.js?v=1',
  '/assets/js/landing.js?v=3',
  '/assets/js/login.js?v=2026.2',
  '/assets/js/registro.js?v=2026.2',
  '/assets/js/smooth_marker.js?v=1',
  '/assets/js/passenger_map.js?v=2026.4',
  '/assets/js/driver_map.js?v=4',
  '/assets/js/admin_dashboard.js?v=4',
  '/assets/js/admin_sidebar.js?v=3',
  '/assets/js/simulador_roi.js?v=3',
  '/assets/js/pwa-install.js?v=2',
  '/assets/img/icons/icon-192x192.png',
  '/assets/img/icons/icon-512x512.png',
  '/assets/img/icons/icon-512x512-maskable.png',
  '/assets/img/icons/apple-touch-icon.png',
];

const API_BASE = 'https://tecbus-api.onrender.com';

// ─── INSTALL: Precachear assets estáticos ───
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando SmartBus PWA...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Precacheando assets estáticos');
      return cache.addAll(STATIC_ASSETS);
    }).catch((err) => {
      console.warn('[SW] Error en precache (algunos assets pueden fallar):', err);
    })
  );
  self.skipWaiting();
});

// ─── ACTIVATE: Limpiar cachés viejos ───
self.addEventListener('activate', (event) => {
  console.log('[SW] Activando nuevo Service Worker...');
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] Eliminando caché viejo:', key);
            return caches.delete(key);
          })
      );
    })
  );
  self.clients.claim();
});

// ─── FETCH: Estrategias de caché ───
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar peticiones que no sean GET (POST, PUT, DELETE, etc.) o que no sean HTTP/HTTPS
  // ya que la API de Caché solo soporta peticiones GET de protocolo HTTP/HTTPS
  if (request.method !== 'GET' || !request.url.startsWith('http')) {
    return;
  }

  // Los recursos de otros orígenes (CDNs y la API cuando el frontend vive en
  // otro dominio) los maneja directamente el navegador. Así una falla de red
  // del service worker no bloquea scripts/CSS externos y las respuestas
  // autenticadas de la API nunca pasan por la caché.
  if (url.origin !== self.location.origin) {
    return;
  }

  // API calls → Network-first SIN guardar en caché. Las respuestas están
  // autenticadas por cookie y no deben quedar disponibles para otro usuario
  // del mismo navegador después de cerrar sesión.
  if (url.href.startsWith(API_BASE)) {
    event.respondWith(
      networkFirst(request, false)
    );
    return;
  }

  // HTML pages → Network-first
  if (request.destination === 'document' || url.pathname.endsWith('.html')) {
    event.respondWith(
      networkFirst(request)
    );
    return;
  }

  // Assets estáticos propios (CSS, JS, imágenes, manifest) → Cache-first
  event.respondWith(
    cacheFirst(request)
  );
});

// ─── Estrategia: Cache-First (para assets estáticos propios) ───
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.warn('[SW] Cache-first falló para:', request.url);
    return new Response('', { status: 408, statusText: 'Request Timeout' });
  }
}

// ─── Estrategia: Network-First (para HTML y API) ───
// cacheable=false se usa para respuestas autenticadas de la API.
async function networkFirst(request, cacheable = true) {
  try {
    const networkResponse = await fetch(request);
    if (cacheable && networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    if (!cacheable) {
      console.warn('[SW] API sin conexión:', request.url);
      return new Response('', { status: 408, statusText: 'Request Timeout' });
    }

    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    console.warn('[SW] Network-first falló para:', request.url);
    return new Response('', { status: 408, statusText: 'Request Timeout' });
  }
}

// ─── PUSH: Notificaciones push del servidor ───
self.addEventListener('push', (event) => {
  let data = { title: 'SmartBus', body: 'Nueva notificación', url: '/' };

  if (event.data) {
    try {
      data = event.data.json();
      console.log('[SW] Notificación recibida:', data);
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/assets/img/icons/icon-192x192.png',
    badge: '/assets/img/icons/icon-192x192.png',
    vibrate: [100, 50, 100],
    data: { url: data.url || '/' },
    actions: [
      { action: 'explore', title: 'Ver Mapa' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ─── NOTIFICATION CLICK: Abrir ventana al hacer click ───
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      const urlToOpen = event.notification.data.url;
      for (const client of clientList) {
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});
