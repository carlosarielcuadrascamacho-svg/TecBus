/**
 * SmartBus — Landing Page Interactivity
 * High-performance, tactile micro-interactions following Emil Kowalski principles.
 */

(function () {
    "use strict";

    // 1. Datos de rutas oficiales
    const ROUTES_DATA = {
        guasave: {
            title: "Ruta Guamúchil – Guasave",
            destination: "Guasave",
            duration: 40,
            nextStop: "Parada 3: Centro",
            etaMin: 4,
            speed: "46 km/h",
            beaconPosition: { left: "55%", top: "20%" },
            note: "Destino: Terminal Guasave (Duración estándar: 40 min)"
        },
        tamazula: {
            title: "Ruta Guamúchil – Tamazula",
            destination: "Tamazula",
            duration: 30,
            nextStop: "Parada 4: San Alberto",
            etaMin: 6,
            speed: "52 km/h",
            beaconPosition: { left: "70%", top: "42%" },
            note: "Destino: Tamazula Centro (Duración estándar: 30 min)"
        }
    };

    let activeRouteKey = "guasave";

    // 2. Navbar Scroll State
    const navbar = document.getElementById("navbar");
    function updateNavbar() {
        if (!navbar) return;
        if (window.scrollY > 20) {
            navbar.classList.add("is-scrolled");
        } else {
            navbar.classList.remove("is-scrolled");
        }
    }
    window.addEventListener("scroll", updateNavbar, { passive: true });
    updateNavbar();

    // 3. Menú Móvil
    const mobileToggle = document.getElementById("mobile-toggle");
    const navMenu = document.getElementById("nav-menu");
    const navLinks = document.querySelectorAll(".nav-link");

    if (mobileToggle && navMenu) {
        mobileToggle.addEventListener("click", () => {
            const isOpen = navMenu.classList.toggle("is-active");
            mobileToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });

        navLinks.forEach((link) => {
            link.addEventListener("click", () => {
                navMenu.classList.remove("is-active");
                mobileToggle.setAttribute("aria-expanded", "false");
            });
        });
    }

    // 4. ScrollSpy
    const sections = document.querySelectorAll("section[id]");
    function handleScrollSpy() {
        const scrollPosition = window.scrollY + 120;
        sections.forEach((section) => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute("id");

            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
                navLinks.forEach((link) => {
                    link.classList.remove("active");
                    if (link.getAttribute("href") === `#${sectionId}`) {
                        link.classList.add("active");
                    }
                });
            }
        });
    }
    window.addEventListener("scroll", handleScrollSpy, { passive: true });

    // 5. Hero Radar Telemetry Controller
    const activeRouteName = document.getElementById("active-route-name");
    const radarDestTag = document.getElementById("radar-dest-tag");
    const radarNextStopTag = document.getElementById("radar-next-stop-tag");
    const radarStopName = document.getElementById("radar-stop-name");
    const radarEtaVal = document.getElementById("radar-eta-val");
    const radarSpeed = document.getElementById("radar-speed");
    const radarEta = document.getElementById("radar-eta");
    const busBeacon = document.getElementById("bus-beacon");

    const tabGuasave = document.getElementById("tab-guasave");
    const tabTamazula = document.getElementById("tab-tamazula");

    function setRadarRoute(key) {
        activeRouteKey = key;
        const data = ROUTES_DATA[key];
        if (!data) return;

        // Actualizar tabs
        if (tabGuasave && tabTamazula) {
            const isGuasave = key === "guasave";
            tabGuasave.classList.toggle("is-active", isGuasave);
            tabGuasave.setAttribute("aria-selected", isGuasave ? "true" : "false");

            tabTamazula.classList.toggle("is-active", !isGuasave);
            tabTamazula.setAttribute("aria-selected", !isGuasave ? "true" : "false");
        }

        // Actualizar textos y telemetría
        if (activeRouteName) activeRouteName.textContent = data.title;
        if (radarDestTag) radarDestTag.textContent = data.destination;
        if (radarNextStopTag) radarNextStopTag.textContent = data.nextStop;
        if (radarStopName) radarStopName.textContent = data.nextStop;
        if (radarEtaVal) radarEtaVal.textContent = `${data.etaMin} minutos`;
        if (radarSpeed) radarSpeed.textContent = data.speed;
        if (radarEta) radarEta.textContent = `Llega en ${data.etaMin} min`;

        // Animar baliza del autobús con suavidad
        if (busBeacon) {
            busBeacon.style.left = data.beaconPosition.left;
            busBeacon.style.top = data.beaconPosition.top;
        }

        // Sincronizar calculadora de ruta
        syncCalculatorRoute(key);
    }

    if (tabGuasave) {
        tabGuasave.addEventListener("click", () => setRadarRoute("guasave"));
    }
    if (tabTamazula) {
        tabTamazula.addEventListener("click", () => setRadarRoute("tamazula"));
    }

    // 6. Calculadora de Horarios de Viaje
    const departureSlider = document.getElementById("departure-slider");
    const departureDisplay = document.getElementById("departure-display");
    const calcArrivalTime = document.getElementById("calc-arrival-time");
    const calcRouteNote = document.getElementById("calc-route-note");
    const calcRouteGuasave = document.getElementById("calc-route-guasave");
    const calcRouteTamazula = document.getElementById("calc-route-tamazula");

    let calcRouteKey = "guasave";

    function formatMinutesToTime(totalMinutes) {
        const hours24 = Math.floor(totalMinutes / 60) % 24;
        const mins = totalMinutes % 60;
        const period = hours24 >= 12 ? "PM" : "AM";
        const hours12 = hours24 % 12 || 12;
        const formattedMins = mins < 10 ? `0${mins}` : mins;
        const formattedHours = hours12 < 10 ? `0${hours12}` : hours12;
        return `${formattedHours}:${formattedMins} ${period}`;
    }

    function updateCalculator() {
        if (!departureSlider || !departureDisplay || !calcArrivalTime) return;

        const minutesFromMidnight = parseInt(departureSlider.value, 10);
        departureDisplay.textContent = formatMinutesToTime(minutesFromMidnight);

        const routeData = ROUTES_DATA[calcRouteKey];
        const arrivalMinutes = minutesFromMidnight + (routeData ? routeData.duration : 40);
        calcArrivalTime.textContent = formatMinutesToTime(arrivalMinutes);

        if (calcRouteNote && routeData) {
            calcRouteNote.textContent = routeData.note;
        }
    }

    function syncCalculatorRoute(key) {
        calcRouteKey = key;
        if (calcRouteGuasave && calcRouteTamazula) {
            calcRouteGuasave.classList.toggle("is-active", key === "guasave");
            calcRouteTamazula.classList.toggle("is-active", key === "tamazula");
        }
        updateCalculator();
    }

    if (departureSlider) {
        departureSlider.addEventListener("input", updateCalculator);
    }

    if (calcRouteGuasave) {
        calcRouteGuasave.addEventListener("click", () => {
            syncCalculatorRoute("guasave");
            setRadarRoute("guasave");
        });
    }

    if (calcRouteTamazula) {
        calcRouteTamazula.addEventListener("click", () => {
            syncCalculatorRoute("tamazula");
            setRadarRoute("tamazula");
        });
    }

    updateCalculator();

    // 7. Acordeón de Preguntas Frecuentes
    const faqItems = document.querySelectorAll(".faq-item");
    faqItems.forEach((item) => {
        const questionBtn = item.querySelector(".faq-question");
        if (!questionBtn) return;

        questionBtn.addEventListener("click", () => {
            const isCurrentlyOpen = item.classList.contains("is-open");

            // Cerrar otros acordeones para mantener elegancia
            faqItems.forEach((other) => {
                other.classList.remove("is-open");
                const otherBtn = other.querySelector(".faq-question");
                if (otherBtn) otherBtn.setAttribute("aria-expanded", "false");
            });

            if (!isCurrentlyOpen) {
                item.classList.add("is-open");
                questionBtn.setAttribute("aria-expanded", "true");
            }
        });
    });

    // 8. Simulación periódica de movimiento leve del bus (tacto de tiempo real)
    setInterval(() => {
        if (!busBeacon) return;
        const currentData = ROUTES_DATA[activeRouteKey];
        if (!currentData) return;

        // Fluctuación sutil de velocidad
        if (radarSpeed) {
            const baseSpeed = parseInt(currentData.speed, 10);
            const delta = Math.floor(Math.random() * 7) - 3;
            radarSpeed.textContent = `${Math.max(38, baseSpeed + delta)} km/h`;
        }
    }, 4000);

})();
