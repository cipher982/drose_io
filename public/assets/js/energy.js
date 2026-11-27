// Energy governor: one place that decides how much the page is allowed to move.
//
// Sets <html data-energy="active|calm|still"> and fires an "energy" event on
// window when it changes. CSS pauses ambient animation off it; pepper.js and
// the loop videos (scripts.js) follow it too.
//
//   active  someone is here: visible, focused, input in the last CALM_MS
//   calm    visible but nobody is touching it (no input for CALM_MS), or the
//           window is not focused: ambient motion pauses where it stands,
//           Pepper stays put, loop videos pause
//   still   hidden, or no input for STILL_MS, or the visitor asked for less
//           motion or data: nothing animates, Pepper naps, polling stops
//
// Any input returns to active at once. Nothing polls: a single timer is armed
// for the next threshold. ?energy=calm:4,still:8 shortens the thresholds (in
// seconds) for scripts/perf/energy.ts.
(function () {
  'use strict';
  var CALM_MS = 60 * 1000;
  var STILL_MS = 4 * 60 * 1000;
  try {
    var q = new URLSearchParams(location.search).get('energy');
    if (q) q.split(',').forEach(function (kv) {
      var p = kv.split(':'), s = parseFloat(p[1]) * 1000;
      if (!(s > 0)) return;
      if (p[0] === 'calm') CALM_MS = s;
      if (p[0] === 'still') STILL_MS = s;
    });
  } catch (e) {}

  var root = document.documentElement;
  var forced = false;
  try {
    forced = window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !!(navigator.connection && navigator.connection.saveData);
  } catch (e) {}

  var lastInput = Date.now();
  var level = '';
  var timer = 0;

  function compute() {
    if (forced || document.visibilityState === 'hidden') return 'still';
    var idle = Date.now() - lastInput;
    if (idle >= STILL_MS) return 'still';
    if (idle >= CALM_MS || !document.hasFocus()) return 'calm';
    return 'active';
  }

  function update() {
    clearTimeout(timer);
    var next = compute();
    if (next !== level) {
      level = next;
      root.dataset.energy = next;
      try { window.dispatchEvent(new CustomEvent('energy', { detail: next })); } catch (e) {}
    }
    if (next === 'still' && (forced || document.visibilityState === 'hidden')) return;
    var idle = Date.now() - lastInput;
    var wait = idle < CALM_MS ? CALM_MS - idle : idle < STILL_MS ? STILL_MS - idle : -1;
    if (wait >= 0) timer = setTimeout(update, wait + 50);
  }

  // Input only stamps a time; the state is recomputed only when it would change.
  function onInput() {
    lastInput = Date.now();
    if (level !== 'active') update();
  }
  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (t) {
    window.addEventListener(t, onInput, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') lastInput = Date.now(); update(); });
  window.addEventListener('focus', function () { lastInput = Date.now(); update(); });
  window.addEventListener('blur', update);
  window.addEventListener('pageshow', update);

  update();
  window.Energy = {
    get level() { return level; },
    // fn(level) now and on every change.
    watch: function (fn) { window.addEventListener('energy', function (e) { fn(e.detail); }); fn(level); },
  };
})();
