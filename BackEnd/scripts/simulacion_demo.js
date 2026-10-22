// BackEnd/scripts/simulacion_demo.js
//
// Simulación manual de un recorrido. Requiere:
//   SIM_TOKEN=<JWT de un administrador o del conductor asignado>
//   MONGO_URI=...
//
// Opcional:
//   SIM_CAMION_ID=<ObjectId del camión>
//   SIM_RUTA_1_ID=<ObjectId de la ruta de ida>
//   SIM_RUTA_2_ID=<ObjectId de la ruta de vuelta>
//   SOCKET_URL=http://localhost:5000
//
// Si no se pasan los IDs de las rutas, se buscan por los nombres de abajo.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });

const mongoose = require("mongoose");
const { io } = require("socket.io-client");
const Ruta = require("../models/Ruta");
const Camion = require("../models/Camion");

const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:5000";
const TICK_RATE = 800;

const NOMBRE_RUTA_1 = process.env.SIM_RUTA_1_NOMBRE || "Ruta Rochin-Tec";
const NOMBRE_RUTA_2 = process.env.SIM_RUTA_2_NOMBRE || "Ruta Tec-La Brecha";

let ID_CAMION = process.env.SIM_CAMION_ID || null;

let socket = null;

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function conectarSocket() {
  return new Promise((resolve, reject) => {
    if (!socket) {
      reject(new Error("Socket no inicializado."));
      return;
    }
    socket.once("connect", resolve);
    socket.once("connect_error", (error) => {
      reject(new Error(`No se pudo conectar al servidor: ${error.message}`));
    });
  });
}

async function buscarRuta(id, nombre) {
  if (id) return Ruta.findById(id);
  return Ruta.findOne({ nombre });
}

async function iniciarSimulacion() {
  if (!process.env.SIM_TOKEN) {
    throw new Error(
      "Falta SIM_TOKEN. Inicia sesión en la app y copia el JWT en la variable SIM_TOKEN."
    );
  }

  console.log("🎬 --- INICIANDO DEMOSTRACIÓN SmartBus ---");
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ BD Conectada.");

  try {
    socket = io(SOCKET_URL, {
      auth: { token: process.env.SIM_TOKEN || "" },
      transports: ["websocket"],
    });

    const r1 = await buscarRuta(process.env.SIM_RUTA_1_ID, NOMBRE_RUTA_1);
    const r2 = await buscarRuta(process.env.SIM_RUTA_2_ID, NOMBRE_RUTA_2);

    if (!r1 || !r2) {
      throw new Error(
        "No se encontraron las rutas. Define SIM_RUTA_1_ID y SIM_RUTA_2_ID."
      );
    }

    if (!ID_CAMION) {
      const camion = await Camion.findOne().select("_id numeroUnidad");
      if (!camion) throw new Error("No hay camiones en la base de datos.");
      ID_CAMION = camion._id.toString();
      console.log(`🚌 Usando camión ${camion.numeroUnidad} (${ID_CAMION})`);
    }

    const puntosR1 = extraerPuntos(r1);
    const puntosR2 = extraerPuntos(r2);

    if (puntosR1.length < 2 || puntosR2.length < 2) {
      throw new Error("Las rutas necesitan al menos dos paradas con coordenadas.");
    }

    await conectarSocket();
    console.log("🔌 Socket conectado con autenticación.");

    console.log("\n🚍 FASE 1: Iniciando Ruta 1 [En Servicio]");
    await recorrerRuta(puntosR1, "En Servicio", r1._id.toString(), 50);

    console.log("\n🛑 FASE 2: Llegada al TEC [Abordando] (10s)");
    const ultimoPuntoR1 = puntosR1[puntosR1.length - 1];
    socket.emit("driverLocationUpdate", {
      camionId: ID_CAMION,
      location: ultimoPuntoR1,
      heading: 0,
      estado: "Abordando",
      velocidad: 0,
      rutaId: r1._id.toString(),
    });

    await esperar(10000);

    console.log("\n🚍 FASE 3: Iniciando Ruta 2 [En Servicio]");
    await recorrerRuta(puntosR2, "En Servicio", r2._id.toString(), 50);

    console.log("\n🏁 FASE 4: Fin del trayecto [Fuera de Servicio]");
    const ultimoPuntoR2 = puntosR2[puntosR2.length - 1];

    socket.emit("driverLocationUpdate", {
      camionId: ID_CAMION,
      location: ultimoPuntoR2,
      heading: 0,
      estado: "Fuera de Servicio",
      velocidad: 0,
      rutaId: r2._id.toString(),
    });

    console.log("\n✅ DEMOSTRACIÓN FINALIZADA.");
  } finally {
    if (socket) socket.close();
    await mongoose.disconnect();
  }
}

function recorrerRuta(puntos, estado, rutaId, pasosObjetivo) {
  return new Promise((resolve) => {
    let i = 0;
    const salto = Math.max(1, Math.floor(puntos.length / pasosObjetivo));

    const intervalo = setInterval(() => {
      if (i >= puntos.length) {
        clearInterval(intervalo);
        resolve();
        return;
      }

      const punto = puntos[i];
      const velocidad = Math.floor(Math.random() * (50 - 20) + 20);

      socket.emit("driverLocationUpdate", {
        camionId: ID_CAMION,
        location: punto,
        heading: 0,
        estado,
        velocidad,
        rutaId,
      });

      process.stdout.write(".");
      i += salto;
    }, TICK_RATE);
  });
}

function extraerPuntos(rutaDoc) {
  return rutaDoc.paradas
    .filter((p) => p.ubicacion && Array.isArray(p.ubicacion.coordinates))
    .map((p) => ({
      lat: p.ubicacion.coordinates[1],
      lng: p.ubicacion.coordinates[0],
    }));
}

iniciarSimulacion().catch((error) => {
  console.error("❌", error.message);
  process.exitCode = 1;
});
