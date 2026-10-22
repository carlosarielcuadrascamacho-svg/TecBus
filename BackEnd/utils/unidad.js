// Reglas compartidas para saber si un usuario puede operar una unidad.
// Se usan tanto en Socket.io como en las rutas HTTP para no duplicar criterios.

const mongoose = require("mongoose");
const Camion = require("../models/Camion");
const Horario = require("../models/Horario");

async function buscarCamion(referencia) {
  if (!referencia) return null;
  if (mongoose.Types.ObjectId.isValid(referencia)) {
    return Camion.findById(referencia);
  }
  return Camion.findOne({
    $or: [{ numeroUnidad: referencia }, { placa: referencia }],
  });
}

async function puedeOperarUnidad(user, camion) {
  if (!user || !camion) return false;
  if (user.tipo === "administrador") return true;
  if (user.tipo !== "conductor") return false;

  if (camion.conductorActual) {
    return camion.conductorActual.toString() === user._id.toString();
  }

  // Algunos camiones se asignan solo desde el horario y no tienen
  // conductorActual en su ficha. En ese caso validamos que la MISMA salida
  // tenga la unidad y el conductor; dos salidas distintas no deben combinarse.
  const horario = await Horario.exists({
    salidas: {
      $elemMatch: {
        camionAsignado: camion._id,
        conductorAsignado: user._id,
      },
    },
  });

  return Boolean(horario);
}

module.exports = { buscarCamion, puedeOperarUnidad };
