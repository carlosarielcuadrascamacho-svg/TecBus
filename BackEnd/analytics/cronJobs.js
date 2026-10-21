// backend/analytics/cronJobs.js

const cron = require("node-cron");
const mongoose = require("mongoose");

// Importamos los modelos
const HistorialUbicacion = require("../models/HistorialUbicacion");
const HistorialViaje = require("../models/HistorialBusqueda");
const User = require("../models/User");     // <--- NUEVO: Importar User
const Horario = require("../models/Horario"); // <--- NUEVO: Importar Horario
const AnaliticaPrediccion = require("../models/AnaliticaPrediccion"); // <--- NUEVO IMPORT

// --- Utilidad de Hora (Reutilizable) ---
const obtenerHoraGuasave = () => {
    const fechaActual = new Date();
    const formateador = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Mazatlan",
        hour12: false,
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric'
    });
    
    const partes = formateador.formatToParts(fechaActual);
    const getVal = (k) => partes.find(p => p.type === k).value;

    const horas = getVal('hour').padStart(2, '0');
    const minutos = getVal('minute').padStart(2, '0');
    
    return {
        diaIngles: getVal('weekday'),
        horaTexto: `${horas}:${minutos}`, // Ejemplo: "07:30"
        fechaObjeto: fechaActual
    };
};

// --- ¡NUEVO! Lógica de la Consulta 3 extraída a su propia función ---
const ejecutarAnalisisVelocidad = async () => {
  console.log("--- 🏃‍♂️ Ejecutando Job: Análisis de Velocidad ---");
  try {
    const treintaDiasAtras = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await HistorialUbicacion.aggregate([
      { $match: { timestamp: { $gte: treintaDiasAtras } } },
      {
        $group: {
          _id: "$camionId",
          velocidadPromedio: { $avg: "$velocidad" },
          totalPings: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "camions",
          localField: "_id",
          foreignField: "_id",
          as: "infoCamion",
        },
      },
      {
        $project: {
          _id: "$_id",
          unidad: { $arrayElemAt: ["$infoCamion.numeroUnidad", 0] },
          velocidadPromedio: { $round: ["$velocidadPromedio", 2] },
          totalPings: "$totalPings",
        },
      },
      {
        $merge: {
          into: "analiticapromedios",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      },
    ]);
    console.log("--- ✅ Job: Análisis de Velocidad Completado ---");
  } catch (error) {
    console.error("--- ❌ Error en Job de Análisis de Velocidad:", error);
  }
};

const ejecutarAnalisisHabitos = async () => {
  console.log("--- 🏃‍♂️ Ejecutando Job: Análisis de Hábitos ---");
  try {
    await HistorialViaje.aggregate([
      {
        $group: {
          // 1. CORRECCIÓN: Usar nombres reales del modelo HistorialBusqueda
          _id: {
            usuario: "$usuario",        // Antes: $estudianteId (Incorrecto)
            ruta: "$ruta",              // Correcto
            hora: "$horaBusqueda",      // Antes: $horaProgramada (Incorrecto)
          },
          conteo: { $sum: 1 },
        },
      },
      { $sort: { conteo: -1 } },
      {
        $group: {
          _id: "$_id.usuario", // Agrupamos por usuario para sacar su top 1
          rutaPreferida: { $first: "$_id.ruta" },
          horaPreferida: { $first: "$_id.hora" },
          viajesContados: { $first: "$conteo" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id", // Al agrupar arriba por usuario, ahora _id SÍ es el ID del usuario
          foreignField: "_id",
          as: "infoEstudiante",
        },
      },
      {
        $project: {
          _id: "$_id", // Conservamos el ID del usuario como ID del documento de analítica
          nombreEstudiante: { $arrayElemAt: ["$infoEstudiante.nombre", 0] },
          prediccion: {
            ruta: "$rutaPreferida",
            hora: "$horaPreferida",
          },
          viajesAnalizados: "$viajesContados",
        },
      },
      {
        $merge: {
          into: "analiticaprediccions",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert",
        },
      },
    ]);
    console.log("--- ✅ Job: Análisis de Hábitos Completado ---");
  } catch (error) {
    console.error("--- ❌ Error en Job de Análisis de Hábitos:", error);
  }
};

// --- 🕒 ACTUALIZACIÓN DE ESTADO DE CONDUCTORES ---
const actualizarEstadoConductores = async () => {
  console.log("--- 🔄 Actualizando estados (Hora Sinaloa: America/Mazatlan) ---");
  
  try {
    // 1. OBTENER HORA REAL DE SINALOA
    // Usamos Intl para garantizar que sea la hora de Guasave
    const fechaActual = new Date();
    const formateador = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Mazatlan", // <--- ESTO ARREGLA EL ERROR DE LA HORA
        hour12: false,
        weekday: 'long',
        hour: 'numeric',
        minute: 'numeric'
    });

    const partes = formateador.formatToParts(fechaActual);
    const getVal = (k) => partes.find(p => p.type === k).value;

    // Mapeo de días Inglés -> Español (Backend guarda en Español)
    const traduccionDias = {
        "Monday": "Lunes", "Tuesday": "Martes", "Wednesday": "Miércoles",
        "Thursday": "Jueves", "Friday": "Viernes", "Saturday": "Sábado", "Sunday": "Domingo"
    };

    const diaIngles = getVal('weekday');
    const diaHoy = traduccionDias[diaIngles];
    
    // Convertimos la hora actual de Sinaloa a minutos totales (ej: 07:30 = 450)
    const horaActual = parseInt(getVal('hour'));
    const minutoActual = parseInt(getVal('minute'));
    const minutosActuales = (horaActual * 60) + minutoActual;

    console.log(`--- 📍 Tiempo Guasave: ${diaHoy} ${horaActual}:${minutoActual} (Minutos: ${minutosActuales}) ---`);

    // 2. OBTENER HORARIOS DE HOY
    const horariosHoy = await Horario.find({
      $or: [
        { diaSemana: diaHoy },
        { diaSemana: "Diario" },
        // Lógica para Lunes-Viernes
        { diaSemana: "Lunes-Viernes", $expr: { 
            $and: [
               // En JS Sunday=0, Monday=1... Friday=5. 
               // Si hoy es domingo (0) o sábado (6), no entra aquí.
               { $ne: [new Date().getDay(), 0] }, 
               { $ne: [new Date().getDay(), 6] }
            ]
        }} 
      ]
    });

    // 3. AGRUPAR HORARIOS POR CONDUCTOR
    const agenda = {}; 

    horariosHoy.forEach(h => {
        if (h.conductorAsignado) {
            const id = h.conductorAsignado.toString();
            if (!agenda[id]) agenda[id] = [];
            
            const [hh, mm] = h.hora.split(':').map(Number);
            const minutosSalida = hh * 60 + mm;
            agenda[id].push(minutosSalida);
        }
    });

    // 4. EVALUAR CADA CONDUCTOR
    const conductores = await User.find({ tipo: "conductor" });
    const bulkOps = [];

    conductores.forEach(conductor => {
        const id = conductor._id.toString();
        const tiempos = agenda[id];
        
        let nuevoEstado = "Fuera de Servicio"; // Por defecto si no tiene agenda

        if (tiempos && tiempos.length > 0) {
            // Ordenar cronológicamente (primero la mañana, luego la tarde)
            tiempos.sort((a, b) => a - b);
            
            const primerHorario = tiempos[0];
            const ultimoHorario = tiempos[tiempos.length - 1];
            
            // Regla de Negocio:
            // Se considera ruta activa 10 minutos después de la última salida.
            const finServicio = ultimoHorario + 10; 

            if (minutosActuales < primerHorario) {
                // Antes de que empiece su primer viaje
                nuevoEstado = "Inicio de Recorridos";
            } else if (minutosActuales >= primerHorario && minutosActuales <= finServicio) {
                // Entre el primer viaje y 10 min después del último
                nuevoEstado = "En Servicio";
            } else {
                // Ya pasó su hora de salida + 10 min
                nuevoEstado = "Fuera de Servicio";
            }
        }

        // Solo mandamos actualizar a la BD si el estado cambió
        if (conductor.estado !== nuevoEstado) {
            console.log(`👉 Conductor ${conductor.nombre}: ${conductor.estado} -> ${nuevoEstado}`);
            bulkOps.push({
                updateOne: {
                    filter: { _id: conductor._id },
                    update: { $set: { estado: nuevoEstado } }
                }
            });
        }
    });

    if (bulkOps.length > 0) {
        await User.bulkWrite(bulkOps);
        console.log(`--- ✅ Se actualizaron ${bulkOps.length} estados de conductores. ---`);
    } else {
        console.log("--- 💤 Todos los estados están al día. ---");
    }

  } catch (error) {
    console.error("--- ❌ Error en Job de Estado:", error);
  }
};

// --- 🤖 NUEVO: NOTIFICADOR INTELIGENTE ---
const notificarPredicciones = async (io) => {
    if (!io) {
        console.warn("--- ⚠️ Notificador inteligente omitido: Socket.io no está disponible ---");
        return;
    }
    const { horaTexto } = obtenerHoraGuasave();
    console.log(`--- 🤖 Verificando predicciones para la hora: ${horaTexto} ---`);

    try {
        // 1. Buscamos estudiantes cuya hora habitual sea AHORA MISMO
        // Nota: En un sistema real, podrías buscar 15 minutos antes (horaTexto + 15min)
        const predicciones = await AnaliticaPrediccion.find({
            "prediccion.hora": horaTexto
        }).populate("prediccion.ruta");

        if (predicciones.length === 0) return;

        console.log(`💡 Se encontraron ${predicciones.length} coincidencias de hábito.`);

        // 2. Enviamos la notificación a cada uno
        predicciones.forEach(p => {
            if (p.prediccion && p.prediccion.ruta) {
                const nombreRuta = p.prediccion.ruta.nombre;
                
                // Emitimos evento global, pero con el ID del usuario objetivo
                // El frontend filtrará si el mensaje es para él.
                io.emit("smartAlert", {
                    userId: p._id.toString(), // ID del estudiante
                    mensaje: `Hola ${p.nombreEstudiante}, el camión de la ruta "${nombreRuta}" de esta hora esta por llegar. ¡Preparate para abordar el camión!`,
                    rutaId: p.prediccion.ruta._id
                });
                
                console.log(`📨 Alerta enviada a ${p.nombreEstudiante} sobre ruta ${nombreRuta}`);
            }
        });

    } catch (error) {
        console.error("❌ Error en Notificador Inteligente:", error);
    }
};

// --- Tareas Programadas (cron) ---
// Se programan únicamente desde startAnalyticsJobs() para evitar jobs duplicados.

// --- Función de Inicio ---

const startAnalyticsJobs = (io) => {
  console.log("⏰ Iniciando programador de tareas nocturnas...");

  // 1. Análisis Pesados (Madrugada)
  cron.schedule("0 3 * * *", ejecutarAnalisisVelocidad).start();
  cron.schedule("0 4 * * *", ejecutarAnalisisHabitos).start();

  // 2. Control de Estado Conductores (cada 10 minutos)
  cron.schedule("*/10 * * * *", actualizarEstadoConductores).start();

  // 3. 🤖 Notificaciones Inteligentes (cada minuto)
  // Revisa si la hora actual coincide con la hora favorita de alguien
  cron.schedule("* * * * *", () => notificarPredicciones(io)).start();
};

module.exports = { startAnalyticsJobs };
