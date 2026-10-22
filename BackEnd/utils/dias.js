// Utilidades para normalizar los días de la semana.
// Los horarios nuevos se guardan en minúsculas y sin acentos, pero pueden
// existir documentos antiguos con "Miércoles" o variantes con tilde.

const DIAS_SEMANA = [
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
  "domingo",
];

function normalizarDia(dia) {
  return String(dia || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function expandirDia(dia) {
  const normalizado = normalizarDia(dia);
  if (normalizado === "diario") return [...DIAS_SEMANA];
  if (normalizado === "lunes-viernes") return DIAS_SEMANA.slice(0, 5);
  return DIAS_SEMANA.includes(normalizado) ? [normalizado] : [];
}

function minutosActualesGuasave(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mazatlan",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(fecha);

  const hora = Number(partes.find((parte) => parte.type === "hour")?.value);
  const minuto = Number(partes.find((parte) => parte.type === "minute")?.value);
  const horaNormalizada = hora === 24 ? 0 : hora;
  return horaNormalizada * 60 + minuto;
}

function diasBusquedaHoy(fecha = new Date()) {
  const dia = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mazatlan",
    weekday: "long",
  }).format(fecha);
  const diaIngles = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mazatlan",
    weekday: "long",
  }).format(fecha);

  const capitalizado = dia.charAt(0).toUpperCase() + dia.slice(1);
  const dias = [
    dia,
    capitalizado,
    dia.toLowerCase(),
    normalizarDia(dia),
    "Diario",
    "diario",
  ];

  if (diaIngles !== "Saturday" && diaIngles !== "Sunday") {
    dias.push("Lunes-Viernes", "lunes-viernes");
  }

  return [...new Set(dias)];
}

module.exports = {
  DIAS_SEMANA,
  normalizarDia,
  expandirDia,
  diasBusquedaHoy,
  minutosActualesGuasave,
};
