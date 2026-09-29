/**
 * migración-asignaciones.js
 *
 * PROPOSITO
 * Antes, la ruta de un camión se guardaba DENTRO del horario y se borraba
 * sola si el camión no tenía horarios. Ahora la ruta vive en la ficha del
 * camión (camion.rutaAsignada) y en el conductor (camion.conductorActual).
 *
 * Este script copia los datos que YA existen en los horarios hacia cada
 * camión, para que no tengas que reasignar todo a mano.
 *
 * IMPORTANTE: es seguro de repetir. Solo rellena campos VACÍOS; nunca
 * sobrescribe una ruta o conductor que ya hayas asignado desde el panel.
 *
 * USO:
 *   1. cd BackEnd
 *   2. node migración-asignaciones.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const Camion = require("./models/Camion");
const Horario = require("./models/Horario");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("✅ Conectado a MongoDB\n");

  const camiones = await Camion.find();
  console.log(`🚛 Camiones encontrados: ${camiones.length}\n`);

  let actualizados = 0;
  let sinDatos = 0;

  for (const camion of camiones) {
    const update = {};

    // 1. Ruta: se toma del primer horario que lo mencione
    if (!camion.rutaAsignada) {
      const horario = await Horario.findOne({ "salidas.camionAsignado": camion._id });
      if (horario?.ruta) {
        update.rutaAsignada = horario.ruta;
      }
    }

    // 2. Conductor: se toma de la salida que lo tenga asignado
    if (!camion.conductorActual) {
      const horarios = await Horario.find({ "salidas.camionAsignado": camion._id });
      for (const h of horarios) {
        const salida = h.salidas.find(
          (s) => s.camionAsignado?.toString() === camion._id.toString()
        );
        if (salida?.conductorAsignado) {
          update.conductorActual = salida.conductorAsignado;
          break;
        }
      }
    }

    if (Object.keys(update).length === 0) {
      sinDatos++;
      console.log(`   - ${camion.numeroUnidad} (${camion.placa}): sin datos en horarios, se deja igual`);
      continue;
    }

    await Camion.findByIdAndUpdate(camion._id, { $set: update });
    actualizados++;

    const partes = [];
    if (update.rutaAsignada) partes.push("ruta");
    if (update.conductorActual) partes.push("conductor");
    console.log(`   ✓ ${camion.numeroUnidad} (${camion.placa}): ${partes.join(" y ")} asignados`);
  }

  console.log(`\n📊 RESUMEN`);
  console.log(`   Camiones actualizados: ${actualizados}`);
  console.log(`   Sin datos en horarios: ${sinDatos}`);

  // 3. Si un conductor quedó en dos camiones, se queda solo con el primero
  const duplicados = await Camion.aggregate([
    { $match: { conductorActual: { $ne: null } } },
    { $group: { _id: "$conductorActual", camiones: { $push: "$_id" }, total: { $sum: 1 } } },
    { $match: { total: { $gt: 1 } } },
  ]);

  if (duplicados.length > 0) {
    console.log(`\n⚠️  Conductores con más de un camión: ${duplicados.length}`);
    for (const d of duplicados) {
      const liberar = d.camiones.slice(1);
      await Camion.updateMany(
        { _id: { $in: liberar } },
        { $set: { conductorActual: null } }
      );
      console.log(`   → Se liberaron ${liberar.length} camión(es); se conserva el más antiguo.`);
    }
  }

  await mongoose.disconnect();
  console.log("\n👋 Migración terminada.");
}

main().catch(async (err) => {
  console.error("❌ Error en la migración:", err.message);
  await mongoose.disconnect();
  process.exit(1);
});
