// FrontEnd/assets/js/smooth_marker.js
// Interpolación de marcadores MapLibre para que los buses se muevan de forma
// continua entre actualizaciones GPS, en lugar de saltar al último punto.
(function (global) {
  "use strict";

  const DEFAULT_DURATION = 10000;
  const MIN_DURATION = 250;
  const MAX_DURATION = 20000;
  const MAX_QUEUE = 20;

  const states = new WeakMap();

  function now() {
    return global.performance && typeof global.performance.now === "function"
      ? global.performance.now()
      : Date.now();
  }

  const raf = global.requestAnimationFrame
    ? global.requestAnimationFrame.bind(global)
    : (callback) => global.setTimeout(() => callback(now()), 16);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toLngLat(value) {
    if (Array.isArray(value) && value.length >= 2) {
      return [Number(value[0]), Number(value[1])];
    }
    if (value && typeof value === "object") {
      if (Number.isFinite(Number(value.lng)) && Number.isFinite(Number(value.lat))) {
        return [Number(value.lng), Number(value.lat)];
      }
      if (Number.isFinite(Number(value.lon)) && Number.isFinite(Number(value.lat))) {
        return [Number(value.lon), Number(value.lat)];
      }
    }
    return null;
  }

  function isValidLngLat(lngLat) {
    return Boolean(lngLat) &&
      Number.isFinite(lngLat[0]) && Number.isFinite(lngLat[1]) &&
      Math.abs(lngLat[0]) <= 180 && Math.abs(lngLat[1]) <= 90;
  }

  function toTimestamp(value) {
    if (value == null) return null;
    if (typeof value === "number") {
      return value < 1e12 ? value * 1000 : value;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function positionOf(marker) {
    const lngLat = marker.getLngLat();
    return [lngLat.lng, lngLat.lat];
  }

  function stateOf(marker) {
    let state = states.get(marker);
    if (!state) {
      state = {
        current: null,
        queue: [],
        segment: null,
        rafId: null,
        lastTimestamp: null,
      };
      states.set(marker, state);
    }
    return state;
  }

  function samePoint(a, b) {
    return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
  }

  function setPosition(marker, lngLat) {
    marker.setLngLat([lngLat[0], lngLat[1]]);
  }

  function segmentDuration(state, point) {
    if (point.timestamp != null && state.lastTimestamp != null) {
      const delta = point.timestamp - state.lastTimestamp;
      if (delta > 0 && delta <= 60000) {
        return clamp(delta, MIN_DURATION, MAX_DURATION);
      }
    }
    return clamp(point.duration, MIN_DURATION, MAX_DURATION);
  }

  function runNext(marker, state) {
    if (state.rafId || state.segment || !state.queue.length) return;

    const point = state.queue.shift();
    const from = state.current || positionOf(marker);
    const to = point.target;

    if (samePoint(from, to)) {
      state.current = to;
      if (point.timestamp != null) state.lastTimestamp = point.timestamp;
      setPosition(marker, to);
      runNext(marker, state);
      return;
    }

    const duration = segmentDuration(state, point);
    if (point.timestamp != null) state.lastTimestamp = point.timestamp;
    state.segment = { from, to, start: null, duration };

    const frame = (frameTime) => {
      const segment = state.segment;
      if (!segment) return;

      if (segment.start == null) segment.start = frameTime;
      const progress = clamp((frameTime - segment.start) / segment.duration, 0, 1);
      const lng = segment.from[0] + (segment.to[0] - segment.from[0]) * progress;
      const lat = segment.from[1] + (segment.to[1] - segment.from[1]) * progress;
      const next = [lng, lat];

      state.current = next;
      setPosition(marker, next);

      if (progress < 1) {
        state.rafId = raf(frame);
        return;
      }

      state.current = segment.to;
      setPosition(marker, segment.to);
      state.segment = null;
      state.rafId = null;
      runNext(marker, state);
    };

    state.rafId = raf(frame);
  }

  function prefersReducedMotion() {
    return Boolean(
      global.matchMedia &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function move(marker, target, options) {
    if (!marker || typeof marker.setLngLat !== "function") return false;

    const lngLat = toLngLat(target);
    if (!isValidLngLat(lngLat)) return false;

    if (prefersReducedMotion()) {
      return snap(marker, lngLat);
    }

    const opts = options || {};
    const state = stateOf(marker);

    // Si no hay animación activa, tomar la posición real del marcador:
    // así respetamos las posiciones que ponen las cargas iniciales.
    if (!state.segment && !state.queue.length) {
      const actual = positionOf(marker);
      state.current = isValidLngLat(actual) ? actual : lngLat;
    }

    const last = state.queue.length ? state.queue[state.queue.length - 1] : null;
    if (last && samePoint(last.target, lngLat)) return true;
    if (!last && state.current && samePoint(state.current, lngLat) && !state.segment) {
      return true;
    }

    if (state.queue.length >= MAX_QUEUE) state.queue.shift();

    state.queue.push({
      target: lngLat,
      timestamp: toTimestamp(opts.timestamp),
      duration: clamp(
        Number(opts.duration) || DEFAULT_DURATION,
        MIN_DURATION,
        MAX_DURATION
      ),
    });

    runNext(marker, state);
    return true;
  }

  function stop(marker, snapToTarget) {
    const state = states.get(marker);
    if (!state) return;

    if (state.rafId && global.cancelAnimationFrame) {
      global.cancelAnimationFrame(state.rafId);
    }
    state.rafId = null;
    state.segment = null;

    if (snapToTarget && state.queue.length) {
      const point = state.queue[state.queue.length - 1];
      state.current = point.target;
      setPosition(marker, point.target);
    }
    state.queue = [];
  }

  function snap(marker, target) {
    const lngLat = toLngLat(target);
    if (!marker || !isValidLngLat(lngLat)) return false;

    stop(marker, false);
    const state = stateOf(marker);
    state.current = lngLat;
    setPosition(marker, lngLat);
    return true;
  }

  global.SmoothMarker = {
    move,
    stop,
    snap,
  };
})(window);
