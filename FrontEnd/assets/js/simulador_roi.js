/**
 * =========================================================
 * SIMULADOR GREEN ROI Y ECO-DASHBOARD
 * Lógica financiera cruzada (CAPEX/OPEX vs Ahorro Diésel)
 * =========================================================
 */

document.addEventListener("DOMContentLoaded", () => {
  console.log("🌱 Inicializando Simulador de Retorno Verde (Green ROI)...");

  // --- 1. REFERENCIAS DEL DOM ---
  const flotillaDisplay = document.getElementById("roi-flotilla-display");
  const inputDiesel = document.getElementById("roi-diesel-mensual");
  
  // Variable global para la flotilla (obtenida del servidor)
  let flotillaGlobal = 0;
  
  // Variables Financijas según requerimientos
  const CAPEX_POR_CAMION = 3818.50; // Inversión inicial (Hardware)
  const OPEX_MENSUAL_POR_CAMION = 750.00; // Suscripción (250) + Mantenimiento (500)
  const TASA_AHORRO_DIESEL = 0.08; // 8% de ahorro

  const valInversion = document.getElementById("roi-val-inversion");
  const valAhorroMensual = document.getElementById("roi-val-ahorro-mensual");
  const valRetorno = document.getElementById("roi-val-retorno");

  const ecoValDiesel = document.getElementById("eco-val-diesel");
  const ecoValCO2 = document.getElementById("eco-val-co2");
  const ecoValArboles = document.getElementById("eco-val-arboles");

  const ctx = document.getElementById("roi-chart")?.getContext("2d");
  
  // Inyectar el contenedor del mensaje dinámico si no existe
  const chartContainer = document.querySelector(".roi-chart-container");
  let mensajeDinamico = document.getElementById("roi-mensaje-dinamico");
  if (!mensajeDinamico && chartContainer) {
      mensajeDinamico = document.createElement("div");
      mensajeDinamico.id = "roi-mensaje-dinamico";
      mensajeDinamico.style.textAlign = "center";
      mensajeDinamico.style.marginTop = "20px";
      mensajeDinamico.style.padding = "15px";
      mensajeDinamico.style.borderRadius = "8px";
      mensajeDinamico.style.background = "rgba(30,30,45,0.7)";
      mensajeDinamico.style.border = "1px solid rgba(255,255,255,0.05)";
      mensajeDinamico.style.fontFamily = "'Poppins', sans-serif";
      mensajeDinamico.style.fontSize = "1.05rem";
      mensajeDinamico.style.transition = "all 0.3s ease";
      // Insertarlo después del canvas
      chartContainer.appendChild(mensajeDinamico);
  }

  let roiChartInstance = null;

  // --- 2. CONSTANTES ECOLÓGICAS ---
  const PRECIO_DIESEL_LITRO = 24.50; 
  const CO2_KG_POR_LITRO = 2.68;     
  const ARBOLES_POR_TON_CO2 = 50;    

  // --- 3. CÁLCULO FINANCIERO Y PROYECCIÓN ---
  const calcularYActualizar = () => {
    const flotilla = Math.max(0, flotillaGlobal || 0);
    const dieselMensualPorCamion = Math.max(0, parseFloat(inputDiesel?.value) || 0);

    const labels = [];
    const dataCostoAcumulado = [];
    const dataAhorroAcumulado = [];
    
    let mesQuiebre = -1;

    // Proyección a 12 meses
    for (let mes = 0; mes <= 12; mes++) {
      labels.push(mes === 0 ? "Mes 0" : `Mes ${mes}`);
      
      // Costo Acumulado = (CAPEX + (OPEX * mes)) * Flotilla
      const costoMes = (CAPEX_POR_CAMION + (OPEX_MENSUAL_POR_CAMION * mes)) * flotilla;
      
      // Ahorro Bruto Acumulado = ((Diesel * 8%) * mes) * Flotilla
      const ahorroMes = (dieselMensualPorCamion * TASA_AHORRO_DIESEL * mes) * flotilla;

      dataCostoAcumulado.push(costoMes);
      dataAhorroAcumulado.push(ahorroMes);

      // Evaluar punto de quiebre (solo la primera vez que el ahorro supera al costo)
      if (mesQuiebre === -1 && ahorroMes > costoMes) {
        mesQuiebre = mes;
      }
    }

    // Actualizar Mensaje Dinámico
    if (mensajeDinamico) {
        if (flotilla === 0 || dieselMensualPorCamion === 0) {
            mensajeDinamico.innerHTML = `Ingresa los datos para calcular el retorno de inversión.`;
            mensajeDinamico.style.color = "#adb5bd";
        } else if (mesQuiebre !== -1) {
            mensajeDinamico.innerHTML = `🚀 Tu sistema se pagará solo en el <strong style="color:#00e676; font-size:1.2rem;">Mes ${mesQuiebre}</strong>, generando ganancias puras a partir de ahí.`;
            mensajeDinamico.style.color = "#ffffff";
            mensajeDinamico.style.boxShadow = "0 4px 15px rgba(0, 230, 118, 0.15)";
        } else {
            mensajeDinamico.innerHTML = `⚠️ Con el gasto actual de diésel, el retorno de inversión requerirá más de 12 meses.`;
            mensajeDinamico.style.color = "#ff4757";
            mensajeDinamico.style.boxShadow = "none";
        }
    }

    // Cálculos para la cabecera (Valores estáticos mensuales)
    const inversionTotal = CAPEX_POR_CAMION * flotilla;
    // Ahorro Neto Mensual = Ahorro Bruto - OPEX
    const ahorroNetoMensual = ((dieselMensualPorCamion * TASA_AHORRO_DIESEL) - OPEX_MENSUAL_POR_CAMION) * flotilla;

    if (valInversion) {
      valInversion.textContent = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(inversionTotal);
    }
    if (valAhorroMensual) {
      valAhorroMensual.textContent = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(ahorroNetoMensual);
      valAhorroMensual.className = ahorroNetoMensual >= 0 ? "summary-value highlight-green" : "summary-value highlight-red";
      if (ahorroNetoMensual < 0) valAhorroMensual.style.color = "#ff4757"; // Override color if negative
    }
    if (valRetorno) {
      valRetorno.textContent = mesQuiebre !== -1 ? `${mesQuiebre} meses` : "+12 meses";
    }

    // Impacto Ecológico Anual Simulado
    const litrosAhorradosMes = (dieselMensualPorCamion / PRECIO_DIESEL_LITRO) * TASA_AHORRO_DIESEL * flotilla;
    const litrosAhorradosAnual = litrosAhorradosMes * 12;
    const co2EvitadoAnual = (litrosAhorradosAnual * CO2_KG_POR_LITRO) / 1000;
    const arbolesEquivalentes = co2EvitadoAnual * ARBOLES_POR_TON_CO2;

    if (ecoValDiesel) animarValorElemento(ecoValDiesel, litrosAhorradosAnual, 0);
    if (ecoValCO2) animarValorElemento(ecoValCO2, co2EvitadoAnual, 1);
    if (ecoValArboles) animarValorElemento(ecoValArboles, arbolesEquivalentes, 0);

    dibujarGrafica(labels, dataCostoAcumulado, dataAhorroAcumulado);
  };

  // --- 4. FUNCIÓN ANIMACIÓN DE CONTADORES ---
  const animarValorElemento = (elemento, valorFinal, decimales = 0) => {
    const duracion = 600;
    const pasos = 20;
    const incremento = valorFinal / pasos;
    let actual = 0;
    let pasoActual = 0;

    const timer = setInterval(() => {
      actual += incremento;
      pasoActual++;

      if (pasoActual >= pasos) {
        clearInterval(timer);
        elemento.textContent = valorFinal.toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
      } else {
        elemento.textContent = actual.toLocaleString("es-MX", { minimumFractionDigits: decimales, maximumFractionDigits: decimales });
      }
    }, duracion / pasos);
  };

  // --- 5. RENDERIZADO DE LA GRÁFICA (DARK MODE) ---
  const dibujarGrafica = (labels, dataCosto, dataAhorro) => {
    if (!ctx) return;

    if (roiChartInstance) {
      roiChartInstance.destroy();
    }

    // Gradiente Verde Vibrante para Ahorro
    const gradientAhorro = ctx.createLinearGradient(0, 0, 0, 350);
    gradientAhorro.addColorStop(0, "rgba(0, 230, 118, 0.4)");
    gradientAhorro.addColorStop(1, "rgba(0, 230, 118, 0.0)");

    // Gradiente Naranja/Rojo para Costo Operativo
    const gradientCosto = ctx.createLinearGradient(0, 0, 0, 350);
    gradientCosto.addColorStop(0, "rgba(255, 71, 87, 0.2)");
    gradientCosto.addColorStop(1, "rgba(255, 71, 87, 0.0)");

    roiChartInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Ahorro Bruto Acumulado",
            data: dataAhorro,
            borderColor: "#00e676", // Verde neón
            borderWidth: 3,
            backgroundColor: gradientAhorro,
            fill: true,
            tension: 0.4,
            pointBackgroundColor: "#00e676",
            pointBorderColor: "#1e1e2d",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
          },
          {
            label: "Costo Acumulado (CAPEX + OPEX)",
            data: dataCosto,
            borderColor: "#ff4757", // Rojo/Naranja
            borderWidth: 3,
            backgroundColor: gradientCosto,
            fill: true,
            tension: 0.4,
            borderDash: [5, 5],
            pointBackgroundColor: "#ff4757",
            pointBorderColor: "#1e1e2d",
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            labels: {
              color: "#adb5bd",
              usePointStyle: true,
              pointStyle: 'circle',
              font: { family: "Poppins", size: 12, weight: 500 },
              padding: 20
            }
          },
          tooltip: {
            backgroundColor: "rgba(20, 20, 30, 0.95)",
            titleColor: "#ffffff",
            bodyColor: "#e9ecef",
            borderColor: "rgba(255, 255, 255, 0.1)",
            borderWidth: 1,
            titleFont: { family: "Poppins", size: 14, weight: 600 },
            bodyFont: { family: "Poppins", size: 13 },
            padding: 15,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: (context) => {
                return `${context.dataset.label}: ${new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(context.parsed.y)}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: "rgba(255, 255, 255, 0.05)", drawBorder: false },
            ticks: { color: "#adb5bd", font: { family: "Poppins", size: 11 } }
          },
          y: {
            grid: { color: "rgba(255, 255, 255, 0.05)", drawBorder: false },
            ticks: {
              color: "#adb5bd",
              font: { family: "Poppins", size: 11 },
              callback: (value) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value)
            }
          }
        }
      }
    });
  };

  // --- 6. EVENTOS REACTIVOS ---
  if (inputDiesel) {
    inputDiesel.addEventListener("input", () => {
      if (inputDiesel.value !== "" && parseFloat(inputDiesel.value) < 0) inputDiesel.value = 0;
      calcularYActualizar();
    });
  }

  // --- 7. AJUSTE DE GRÁFICA AL CAMBIAR PESTAÑA ---
  const redibujarSiVisible = () => {
    if (window.location.hash === "#sostenibilidad") {
      setTimeout(() => {
        if (roiChartInstance) roiChartInstance.resize();
        else calcularYActualizar();
      }, 150);
    }
  };

  document.querySelectorAll(".nav-item").forEach(link => {
    link.addEventListener("click", () => redibujarSiVisible());
  });
  window.addEventListener("hashchange", redibujarSiVisible);

  // --- 8. INIT ---
  const inicializarSimulador = async () => {
      try {
          const token = localStorage.getItem("tecbus_token");
          // Si por alguna razón BACKEND_URL no está globalmente definido aún, hacemos un fallback seguro
          const baseUrl = typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : "https://tecbus-api.onrender.com";
          
          if (!token) throw new Error("No hay token");

          const response = await fetch(`${baseUrl}/api/camiones`, {
              headers: { Authorization: `Bearer ${token}` }
          });
          
          if (response.ok) {
              const camiones = await response.json();
              flotillaGlobal = camiones.length;
          } else {
              flotillaGlobal = 0; // Fallback
          }
      } catch (error) {
          console.warn("⚠️ Error al obtener la flotilla real para el ROI:", error);
          flotillaGlobal = 0;
      }

      if (flotillaDisplay) {
          flotillaDisplay.textContent = flotillaGlobal;
      }
      
      calcularYActualizar();
  };

  inicializarSimulador();
});
