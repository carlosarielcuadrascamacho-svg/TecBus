// Configuración compartida de la aplicación con soporte para Vite (.env)
const BACKEND_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_BACKEND_URL)
  ? import.meta.env.VITE_BACKEND_URL
  : "https://tecbus-api.onrender.com";

const SOCKET_URL = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SOCKET_URL)
  ? import.meta.env.VITE_SOCKET_URL
  : "https://tecbus-api.onrender.com";

const GOOGLE_CLIENT_ID = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_GOOGLE_CLIENT_ID)
  ? import.meta.env.VITE_GOOGLE_CLIENT_ID
  : "935209953046-9uked6lm4ob8bkk6ek2653bj14a5ss4k.apps.googleusercontent.com";

window.BACKEND_URL = BACKEND_URL;
window.SOCKET_URL = SOCKET_URL;
window.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
