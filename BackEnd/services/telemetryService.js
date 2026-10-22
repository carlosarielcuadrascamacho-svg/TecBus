// backend/services/telemetryService.js
//
// Lógica compartida para procesar un punto de telemetría GPS.
// La usan tanto la ruta HTTP existente (PUT /api/camiones/update-location)
// como el canal WebSocket de telemetría. Así evitamos duplicar reglas de
// negocio, estadísticas y notificaciones predictivas.

const Camion = require("../models/Camion");
const HistorialBusqueda = require("../models/HistorialBusqueda");
const Notificacion = require("../models/Notificacion");
const UbicacionEnVivo = require("../models/UbicacionEnVivo");
const HistorialUbicacion = require("../models/HistorialUbicacion");
const EstadisticaDiaria = require("../models/EstadisticaDiaria");

const OFFSET_MEXICO_MS = 7 * 60 * 60 * 1000; // UTC-7 (igual que la ruta original)

function aNumero(valor, defecto = 0) {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : defecto;
}

function fechaDelPunto(timestamp) {
  const numero = Number(timestamp);
  if (!Number.isFinite(numero) || numero <= 0) return new Date();

  // Acepta segundos Unix (GPS) o milisegundos.
  const milisegundos = numero > 1e12 ? numero : numero * 1000;
  const fecha = new Date(milisegundos);
  if (Number.isNaN(fecha.getTime())) return new Date();

  // Si el reloj del GPS viene muy desfasado, usamos la hora del servidor.
  if (Math.abs(Date.now() - fecha.getTime()) > 24 * 60 * 60 * 1000) {
    return new Date();
  }
  return fecha;
}

async function procesarPuntoTelemetria(datos, io, opciones = {}) {
  const {
    busId,
    lat,
    lng,
    speed,
    pasajeros_actuales,
    luces_perifericos_encendidos,
    minutos_ralenti,
    timestamp,
  } = datos || {};

  if (!busId || typeof busId !== "string" || lat === undefined || lng === undefined) {
    return { ok: false, code: 400, message: "Datos GPS incompletos" };
  }

  const unidad = busId.trim();
  const latNum = Number(lat);
  const lngNum = Number(lng);

  if (
    !unidad ||
    !Number.isFinite(latNum) ||
    !Number.isFinite(lngNum) ||
    latNum < -90 ||
    latNum > 90 ||
    lngNum < -180 ||
    lngNum > 180
  ) {
    return { ok: false, code: 400, message: "Coordenadas GPS inválidas" };
  }

  const ahora = fechaDelPunto(timestamp);
  const velocidad = aNumero(speed);
  const pasajerosActuales = aNumero(pasajeros_actuales);
  const luces = Boolean(luces_perifericos_encendidos);
  const ralenti = aNumero(minutos_ralenti);

  // 1. Actualizar los datos en tiempo real del camión en la colección principal.
  const camion = await Camion.findOneAndUpdate(
    { numeroUnidad: unidad },
    {
      $set: {
        ubicacionActual: {
          type: "Point",
          coordinates: [lngNum, latNum],
        },
        velocidad,
        ultimaActualizacion: ahora,
        estado: "activo",
      },
    },
    { new: true }
  ).populate("rutaAsignada");

  if (!camion) {
    return { ok: false, code: 404, message: "Camión no registrado en la flotilla" };
  }

  // 2. Ubicación anterior para calcular la distancia recorrida.
  const ubicacionAnterior = await UbicacionEnVivo.findOne({ numeroUnidad: unidad });
  let distanciaRecorrida = 0;

  if (ubicacionAnterior?.ubicacion?.coordinates?.length === 2) {
    const [lngAnt, latAnt] = ubicacionAnterior.ubicacion.coordinates;
    distanciaRecorrida = getDistanceFromLatLonInM(latAnt, lngAnt, latNum, lngNum);

    // Anti-ruido GPS: teletransportación (>1 km) o ruido estático (<3 m).
    if (distanciaRecorrida > 1000 || distanciaRecorrida < 3) {
      distanciaRecorrida = 0;
    }
  }

  // 3. Datos "calientes" que consume el mapa en tiempo real.
  await UbicacionEnVivo.findOneAndUpdate(
    { numeroUnidad: unidad },
    {
      $set: {
        camionId: camion._id,
        ubicacion: { type: "Point", coordinates: [lngNum, latNum] },
        velocidad,
        pasajeros_actuales: pasajerosActuales,
        luces_perifericos_encendidos: luces,
        minutos_ralenti: ralenti,
        ultimaActualizacion: ahora,
        numeroUnidad: unidad,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  // 4. Historial permanente (o hasta que el TTL lo borre).
  HistorialUbicacion.create({
    camionId: camion._id,
    numeroUnidad: unidad,
    ubicacion: { type: "Point", coordinates: [lngNum, latNum] },
    velocidad,
    pasajeros_actuales: pasajerosActuales,
    luces_perifericos_encendidos: luces,
    minutos_ralenti: ralenti,
    timestamp: ahora,
  }).catch((err) => console.error("⚠️ Error guardando historial:", err.message));

  // 5. Estadísticas diarias.
  const fechaLocal = new Date(ahora.getTime() - OFFSET_MEXICO_MS);
  const fechaString = fechaLocal.toISOString().split("T")[0];
  const claveStats = `${unidad}_${fechaString}`;

  await EstadisticaDiaria.updateOne(
    { claveDiaria: claveStats },
    {
      $setOnInsert: {
        numeroUnidad: unidad,
        fecha: new Date(fechaString),
      },
      $inc: {
        distanciaTotal: distanciaRecorrida,
        totalPuntosReportados: 1,
      },
      $max: { velocidadMaxima: velocidad },
      $set: { ultimaActualizacion: ahora },
    },
    { upsert: true }
  ).catch((err) => console.error("⚠️ Error guardando stats:", err.message));

  // 6. Notificar al frontend por Socket.io.
  const punto = {
    camionId: camion._id,
    numeroUnidad: unidad,
    location: { lat: latNum, lng: lngNum },
    velocidad,
    pasajeros_actuales: pasajerosActuales,
    luces_perifericos_encendidos: luces,
    minutos_ralenti: ralenti,
    timestamp: ahora,
  };

  if (io) io.emit("locationUpdate", punto);

  // 7. Análisis predictivo. En lotes solo se ejecuta para el último punto,
  // para no multiplicar consultas por cada muestra.
  if (opciones.prediccion !== false && camion.rutaAsignada) {
    try {
      const horaActual = ahora.getHours();

      const historialRelevante = await HistorialBusqueda.aggregate([
        { $match: { ruta: camion.rutaAsignada._id } },
        {
          $addFields: {
            horaNum: { $toInt: { $substr: ["$horaBusqueda", 0, 2] } },
          },
        },
        { $match: { horaNum: horaActual } },
        {
          $group: {
            _id: "$usuario",
            totalBusquedas: { $sum: 1 },
            ultimoOrigen: { $last: "$ubicacionOrigen" },
          },
        },
        { $match: { totalBusquedas: { $gte: 4 } } },
      ]);

      for (const patron of historialRelevante) {
        const userOrigen = patron.ultimoOrigen;
        if (!userOrigen?.lat || !userOrigen?.lng) continue;

        const distancia = getDistanceFromLatLonInM(
          latNum,
          lngNum,
          userOrigen.lat,
          userOrigen.lng
        );

        if (distancia > 200) continue;

        console.log(
          `✨ PREDICCIÓN: Camión cerca de usuario ${patron._id} (${Math.round(distancia)}m)`
        );

        await Notificacion.create({
          usuario: patron._id,
          mensaje: `El camión de la ruta ${camion.rutaAsignada.nombre} está a ${Math.round(
            distancia
          )}m.`,
          leida: false,
        });

        if (io) {
          // El socket se une a la sala "user:<id>" al autenticarse.
          io.to(`user:${patron._id}`).emit("smartAlert", {
            mensaje: `🚍 Tu ruta habitual (${camion.rutaAsignada.nombre}) está llegando.`,
          });
        }
      }
    } catch (error) {
      console.error("⚠️ Error en análisis predictivo:", error.message);
    }
  }

  return { ok: true, camion, punto };
}

function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c * 1000;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

module.exports = { procesarPuntoTelemetria, getDistanceFromLatLonInM };
