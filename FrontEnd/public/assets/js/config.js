// Configuración compartida de la aplicación con soporte para Vite (.env)
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL)
  ? import.meta.env.VITE_BACKEND_URL
  : "https://tecbus-api.onrender.com";

const SOCKET_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOCKET_URL)
  ? import.meta.env.VITE_SOCKET_URL
  : "https://tecbus-api.onrender.com";

window.BACKEND_URL = BACKEND_URL;
window.SOCKET_URL = SOCKET_URL;
