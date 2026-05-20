/**
 * =========================================================
 * SIMULADOR GREEN ROI Y ECO-DASHBOARD
 * Lógica de cálculos interactivos y renderizado de Chart.js
 * =========================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log("🌱 Inicializando Simulador de Retorno Verde (Green ROI)...");

  // --- 1. REFERENCIAS DEL DOM ---
  const form = document.getElementById("roi-inputs-form");
  const inputFlotilla = document.getElementById("roi-flotilla");
  const inputDiesel = document.getElementById("roi-diesel-mensual");
  const inputInstalacion = document.getElementById("roi-costo-instalacion");

  const valInversion = document.getElementById("roi-val-inversion");
  const valAhorroMensual = document.getElementById("roi-val-ahorro-mensual");
  const valRetorno = document.getElementById("roi-val-retorno");

  const ecoValDiesel = document.getElementById("eco-val-diesel");
  const ecoValCO2 = document.getElementById("eco-val-co2");
  const ecoValArboles = document.getElementById("eco-val-arboles");

  const ctx = document.getElementById("roi-chart")?.getContext("2d");

  let roiChartInstance = null;

  // --- 2. CONSTANTES ECOLÓGICAS ---
  const PRECIO_DIESEL_LITRO = 24.50; // Costo promedio estimado del diésel en MXN
  const CO2_KG_POR_LITRO = 2.68;     // Emisión de CO2 por litro de diésel quemado
  const ARBOLES_POR_TON_CO2 = 50;    // Árboles necesarios por año para absorber 1 Tonelada de CO2

  // --- 3. FUNCIÓN DE CÁLCULO PRINCIPAL ---
  const calcularYActualizar = () => {
    // A. Obtener y limpiar entradas numéricas
    const flotilla = Math.max(0, parseInt(inputFlotilla.value) || 0);
    const dieselMensual = Math.max(0, parseFloat(inputDiesel.value) || 0);
    const costoInstalacion = Math.max(0, parseFloat(inputInstalacion.value) || 0);

    // B. Fórmulas de Retorno Financiero
    // Asunción: SmartBus ahorra el 8% mensual de consumo de combustible
    const inversionTotal = flotilla * costoInstalacion;
    const ahorroMensual = flotilla * dieselMensual * 0.08;
    const puntoEquilibrioMeses = ahorroMensual > 0 ? (inversionTotal / ahorroMensual) : 0;

    // C. Actualizar valores en barra de resumen
    if (valInversion) {
      valInversion.textContent = new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN"
      }).format(inversionTotal);
    }

    if (valAhorroMensual) {
      valAhorroMensual.textContent = new Intl.NumberFormat("es-MX", {
        style: "currency",
        currency: "MXN"
      }).format(ahorroMensual);
    }

    if (valRetorno) {
      if (inversionTotal === 0) {
        valRetorno.textContent = "Sin inversión";
      } else if (ahorroMensual === 0) {
        valRetorno.textContent = "Indefinido";
      } else {
        if (puntoEquilibrioMeses < 1) {
          const dias = Math.round(puntoEquilibrioMeses * 30);
          valRetorno.textContent = `${dias} ${dias === 1 ? 'día' : 'días'}`;
        } else {
          valRetorno.textContent = `${puntoEquilibrioMeses.toFixed(1)} meses`;
        }
      }
    }

    // D. Fórmulas Ecológicas (Impacto anual simulado)
    // Litros ahorrados al año
    const litrosAhorradosMes = (dieselMensual / PRECIO_DIESEL_LITRO) * 0.08 * flotilla;
    const litrosAhorradosAnual = litrosAhorradosMes * 12;

    // Toneladas de CO2 evitadas al año
    const co2EvitadoAnual = (litrosAhorradosAnual * CO2_KG_POR_LITRO) / 1000;

    // Árboles plantados equivalentes
    const arbolesEquivalentes = co2EvitadoAnual * ARBOLES_POR_TON_CO2;

    // E. Renderizar valores en Eco-Cards con animación simple
    if (ecoValDiesel) animarValorElemento(ecoValDiesel, litrosAhorradosAnual, 0);
    if (ecoValCO2) animarValorElemento(ecoValCO2, co2EvitadoAnual, 1);
    if (ecoValArboles) animarValorElemento(ecoValArboles, arbolesEquivalentes, 0);

    // F. Dibujar o refrescar la gráfica
    dibujarGrafica(inversionTotal, ahorroMensual);
  };

  // --- 4. FUNCIÓN ANIMACIÓN DE CONTADORES ---
  const animarValorElemento = (elemento, valorFinal, decimales = 0) => {
    const duracion = 500; // ms
    const pasos = 20;
    const incremento = valorFinal / pasos;
    let actual = 0;
    let pasoActual = 0;

    const timer = setInterval(() => {
      actual += incremento;
      pasoActual++;

      if (pasoActual >= pasos) {
        clearInterval(timer);
        elemento.textContent = valorFinal.toLocaleString("es-MX", {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales
        });
      } else {
        elemento.textContent = actual.toLocaleString("es-MX", {
          minimumFractionDigits: decimales,
          maximumFractionDigits: decimales
        });
      }
    }, duracion / pasos);
  };

  // --- 5. RENDERIZADO DE LA GRÁFICA DE CHART.JS ---
  const dibujarGrafica = (inversionTotal, ahorroMensual) => {
    if (!ctx) return;

    // A. Generar etiquetas de meses (0 a 12)
    const labels = Array.from({ length: 13 }, (_, i) => `Mes ${i}`);

    // B. Generar datos para las dos líneas
    const dataInversion = Array(13).fill(inversionTotal);
    const dataAhorros = Array.from({ length: 13 }, (_, i) => ahorroMensual * i);

    // C. Si la gráfica ya existe, la destruimos para evitar fantasmas
    if (roiChartInstance) {
      roiChartInstance.destroy();
    }

    // D. Crear gradientes visuales hermosos en el canvas
    const gradientAhorro = ctx.createLinearGradient(0, 0, 0, 300);
    gradientAhorro.addColorStop(0, "rgba(0, 230, 118, 0.35)");
    gradientAhorro.addColorStop(1, "rgba(0, 230, 118, 0.00)");

    // E. Instanciar nueva gráfica
    roiChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Ahorro Acumulado",
            data: dataAhorros,
            borderColor: "#00e676",
            borderWidth: 3,
            backgroundColor: gradientAhorro,
            fill: true,
            tension: 0.3,
            pointBackgroundColor: "#00e676",
            pointBorderColor: "#ffffff",
            pointBorderWidth: 1.5,
            pointRadius: 4,
            pointHoverRadius: 6,
          },
          {
            label: "Costo de Inversión",
            data: dataInversion,
            borderColor: "#ff4757",
            borderWidth: 2,
            borderDash: [6, 6],
            backgroundColor: "transparent",
            fill: false,
            pointRadius: 0, // No mostrar puntos en la constante
            pointHoverRadius: 0,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: "#adb5bd",
              font: {
                family: "Poppins",
                size: 11,
                weight: 500
              },
              padding: 15
            }
          },
          tooltip: {
            backgroundColor: "rgba(30, 30, 45, 0.95)",
            titleColor: "#ffffff",
            bodyColor: "#adb5bd",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            titleFont: { family: "Poppins", weight: 600 },
            bodyFont: { family: "Poppins" },
            padding: 12,
            displayColors: true,
            callbacks: {
              label: (context) => {
                let label = context.dataset.label || "";
                if (label) label += ": ";
                if (context.parsed.y !== null) {
                  label += new Intl.NumberFormat("es-MX", {
                    style: "currency",
                    currency: "MXN"
                  }).format(context.parsed.y);
                }
                return label;
              }
            }
          }
        },
        scales: {
          x: {
            grid: {
              color: "rgba(255, 255, 255, 0.04)"
            },
            ticks: {
              color: "#adb5bd",
              font: {
                family: "Poppins",
                size: 10
              }
            }
          },
          y: {
            grid: {
              color: "rgba(255, 255, 255, 0.04)"
            },
            ticks: {
              color: "#adb5bd",
              font: {
                family: "Poppins",
                size: 10
              },
              callback: (value) => {
                return new Intl.NumberFormat("es-MX", {
                  style: "currency",
                  currency: "MXN",
                  maximumFractionDigits: 0
                }).format(value);
              }
            }
          }
        }
      }
    });
  };

  // --- 6. REGISTRO DE EVENT LISTENERS ---
  const inputs = [inputFlotilla, inputDiesel, inputInstalacion];
  inputs.forEach(input => {
    if (input) {
      input.addEventListener("input", () => {
        // Validación en tiempo real para evitar valores absurdos/vacíos
        if (input.value !== "" && parseFloat(input.value) < 0) {
          input.value = 0;
        }
        calcularYActualizar();
      });
    }
  });

  // --- 7. AJUSTE DE TAMAÑO DEL CANVAS AL CAMBIAR DE PESTAÑA ---
  // Dado que el dashboard carga las secciones con display: none, al abrir la pestaña 
  // por primera vez el gráfico podría colapsar a 0px si no se redibuja.
  // Escuchamos los clics en los enlaces de la barra de navegación.
  const navLinks = document.querySelectorAll(".nav-item");
  navLinks.forEach(link => {
    link.addEventListener("click", () => {
      const targetId = link.getAttribute("href");
      if (targetId === "#sostenibilidad") {
        // Pequeño retardo de 50ms para esperar que la clase 'active' aplique el display block
        setTimeout(() => {
          if (roiChartInstance) {
            roiChartInstance.resize();
          } else {
            calcularYActualizar();
          }
        }, 80);
      }
    });
  });

  // También escuchamos cambios directos de la URL (hashchange)
  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#sostenibilidad") {
      setTimeout(() => {
        if (roiChartInstance) {
          roiChartInstance.resize();
        } else {
          calcularYActualizar();
        }
      }, 80);
    }
  });

  // --- 8. EJECUCIÓN INICIAL AL CARGAR LA PÁGINA ---
  // Si la pestaña actual ya es #sostenibilidad, iniciamos de inmediato
  if (window.location.hash === "#sostenibilidad") {
    calcularYActualizar();
  } else {
    // Si no, realizamos el cálculo inicial de forma segura
    calcularYActualizar();
  }
});
