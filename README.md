# 🚌 TecBus – Sistema Inteligente de Transporte Universitario

<!-- Banner (agregar cuando esté disponible) -->
<!-- ![TecBus Banner](FrontEnd/assets/img/TecBus.png) -->

![Estado](https://img.shields.io/badge/Estado-En_Desarrollo-green)
![Versión](https://img.shields.io/badge/Versión-1.0.0-blue)

## 📌 Descripción

**TecBus** es una plataforma inteligente diseñada para **optimizar, monitorear y analizar el servicio de transporte universitario en tiempo real**.

Conecta a **estudiantes, conductores y administradores** en una sola plataforma, permitiendo el rastreo en vivo de las unidades, la gestión eficiente de rutas y horarios, y el análisis de datos para apoyar la toma de decisiones.

---

## ✨ Características Principales

### 🎓 Estudiantes
- 📍 Rastreo de autobuses en tiempo real  
- 🗺️ Consulta de rutas y horarios oficiales  
- 🔔 Notificaciones sobre el estado del servicio  

### 🚍 Conductores
- 📡 Envío automático de ubicación GPS  
- 🛣️ Visualización de rutas y turnos asignados  
- 💬 Comunicación constante con el sistema  

### 📊 Administradores
- 📈 Dashboard de analítica  
- 🔮 Predicción de demanda y tiempos de llegada  
- 🧠 Módulo de analítica (`AnaliticaPrediccion.js`)  
- 🗂️ Gestión de flota, rutas y usuarios  
- 🧪 Simulación de recorridos  

---

## 🛠️ Tecnologías Utilizadas

### Backend
- Node.js  
- Express.js  
- MongoDB (Mongoose)  
- Autenticación JWT  

### Frontend
- HTML5  
- CSS3  
- JavaScript (Vanilla)  
- APIs de mapas (Leaflet)  
- Progressive Web App (PWA)  
- Service Workers  

---

## 🚀 Instalación y Puesta en Marcha

### 📋 Requisitos
- Node.js v18 o superior
- MongoDB (local o MongoDB Atlas)

---

### ⚙️ Configuración del Backend

```bash
cd BackEnd
npm install
```

Crear el archivo .env (puedes partir de `BackEnd/.env.example`):
```env
PORT=5000
NODE_ENV=development
MONGO_URI=tu_cadena_de_conexion
JWT_SECRET=tu_secreto_largo_y_aleatorio
API_KEY_ESP32=la_misma_clave_que_usa_el_esp32_control

# Dominios autorizados para CORS y Socket.io, separados por coma.
CORS_ORIGINS=http://localhost:5500,http://127.0.0.1:5500

# Web Push (opcional si no vas a enviar notificaciones)
MAILTO=mailto:admin@example.com
PUBLIC_VAPID_KEY=
PRIVATE_VAPID_KEY=
```

`API_KEY_ESP32` debe coincidir exactamente con la `API_KEY` de
`esp32_smartbus_control/secrets.h`; si no coincide, la telemetría del ESP32
responde `401`. `JWT_SECRET` es obligatorio: sin él el servidor no arranca.

Ejecutar el servidor:
```Terminal
npm start
```

Modo desarrollo:
```Terminal
nodemon server.js
```

---

## 🌐 Frontend

El frontend es estático y puede ejecutarse:
Con Live Server en VS Code desde la carpeta FrontEnd
O directamente desde el backend

---
## 📸 Capturas de Pantalla

(Se agregarán próximamente)
Landing Page · Vista Estudiante · Panel Administrativo

---

👥 Equipo de Desarrollo

Danna Paola Buenrostro Lugo - DBA

Carlos Ariel Cuadras Camacho - Desarrollador Backend y Frontend

Fernanda Garcia Felix — Desarrollador Backend

Luis Angel Gutierrez Peñuelas — Tester
