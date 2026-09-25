/**
 * Pepper - David's dog, living in a small home in the corner of drose.io.
 *
 * One component, three parts:
 *   home   a glass habitat (bottom right) where the sprite lives: he wanders a
 *          little, sits, naps, watches the cursor, runs off with letters. The
 *          whole home is the button that opens the chat.
 *   chat   a typing-first panel that grows out of the home. Pepper answers from
 *          the public site and carries messages to David (server/pepper).
 *   voice  a short thought bubble on page load (/api/pepper/hello).
 *
 * David's replies arrive over /api/pepper/stream as SSE event 'david'.
 * Under prefers-reduced-motion Pepper sits still; everything else works.
 */

(function () {
  'use strict';

  // ============================================================
  // Constants
  // ============================================================

  const SHEET = '/assets/images/pepper_spritesheet_v2.png?v=5';
  const SHEET_W = 400;
  const SHEET_H = 527;
  const FRAME_W = 100;
  // Rows of the sheet. All frames face right.
  const ANIM = {
    idle:  { y: 0,   h: 86, n: 3, ms: 420 },
    walk:  { y: 86,  h: 73, n: 4, ms: 150 },
    run:   { y: 159, h: 73, n: 4, ms: 80 },
    sit:   { y: 232, h: 86, n: 2, ms: 700 },
    lie:   { y: 318, h: 66, n: 2, ms: 1100 },
    happy: { y: 384, h: 71, n: 2, ms: 420 },
    alert: { y: 455, h: 73, n: 1, ms: 0 },
  };
  const STATUS = {
    idle: 'hanging out',
    walk: 'sniffing around',
    sit: 'sitting pretty',
    lie: 'napping',
    happy: 'say hi',
    alert: 'watching you',
    listening: 'listening',
    thinking: 'thinking…',
    running: 'running it to david…',
    delivered: 'delivered',
    letter: 'has a letter for you',
  };

  const GREETING = "hi! i'm pepper, david's dog. ask me about his work, or tell me something and i'll carry it to him *tilt*";
  const FALLBACK = '*whimper* something went wrong on my end. try again in a moment?';
  const MAX_LEN = 1000;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const TAP = window.matchMedia('(pointer: coarse)').matches ? 'tap' : 'click';
  const ua = navigator.userAgent || '';
  const IN_APP = /FBAN|FBAV|Instagram|LinkedInApp|Twitter|Line\/|MicroMessenger/i.test(ua) ||
    (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua));

  const chat = {
    open: false,
    loaded: false,
    sending: false,
    contactEmail: null,
    telegramLink: null,
    relayed: false,
    askedContact: false,
    unread: false,
    es: null,
    chips: null,
    lastDavidTs: null,
    historyPromise: null,
  };

  let vid = null;
  let root, home, statusEl, dotEl, stage, petEl, spriteEl, shadowEl, bubble;
  let panel, log, form, input, sendBtn, lastFocus;

  // ============================================================
  // Visitor id ('__vid', shared with the server's visitor memory)
  // ============================================================

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function visitorId() {
    if (vid) return vid;
    try { vid = localStorage.getItem('__vid'); } catch { /* storage blocked */ }
    if (!vid) vid = getCookie('__vid');
    if (!vid) vid = uuid();
    try { localStorage.setItem('__vid', vid); } catch { /* storage blocked */ }
    if (!getCookie('__vid')) {
      document.cookie = '__vid=' + encodeURIComponent(vid) + '; expires=' +
        new Date(Date.now() + 3650 * 864e5).toUTCString() + '; path=/; SameSite=Lax';
    }
    return vid;
  }

  // ============================================================
  // DOM helpers
  // ============================================================

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const ENVELOPE = '<svg width="18" height="12" viewBox="0 0 22 15" aria-hidden="true"><rect x="1" y="1" width="20" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.5 1.8 11 8.5l9.5-6.7" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
  const LETTER = '<svg viewBox="0 0 22 15" aria-hidden="true"><rect x="1" y="1" width="20" height="13" rx="2" fill="#f4f4f5"/><path d="M1.6 1.9 11 8.4l9.4-6.5" stroke="#6366f1" stroke-width="1.7" fill="none"/></svg>';
  const ARROW = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TG = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M14.5 2 1.8 7c-.6.2-.6.8 0 1l3.1 1 1.2 3.7c.2.5.6.5.9.2l1.8-1.6 3.3 2.4c.5.3.9.1 1-.4L15.3 2.7c.1-.6-.3-.9-.8-.7Z" fill="currentColor"/></svg>';

  // Text -> DOM nodes: http(s) links and same-site paths become anchors,
  // *actions* become muted <em>. Everything else is a text node, so nothing
  // from the model or a visitor is ever parsed as HTML. (No regex lookbehind:
  // older Safari rejects it at parse time and would take the whole script down.)
  const LINK_RE = /(https?:\/\/[^\s<>"']+)|(^|\s)(\/[a-z0-9][\w\-./#?=&%]*)/gi;

  function appendRich(parent, text, allowActions) {
    text = String(text);
    let last = 0;
    let m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text)) !== null) {
      const lead = m[2] || '';
      const start = m.index + lead.length;
      let url = m[1] || m[3];
      if (start > last) appendActions(parent, text.slice(last, start), allowActions);
      let trail = '';
      while (/[.,!?;:)\]]$/.test(url)) { trail = url.slice(-1) + trail; url = url.slice(0, -1); }
      const a = el('a', null, url);
      a.href = url;
      if (/^https?:/i.test(url) && url.indexOf(location.origin) !== 0) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      parent.appendChild(a);
      if (trail) parent.appendChild(document.createTextNode(trail));
      last = m.index + m[0].length;
    }
    if (last < text.length) appendActions(parent, text.slice(last), allowActions);
  }

  function appendActions(parent, chunk, allowActions) {
    if (!allowActions) { parent.appendChild(document.createTextNode(chunk)); return; }
    chunk.split(/(\*[^*\n]{1,60}\*)/g).forEach(function (p) {
      if (!p) return;
      if (/^\*[^*\n]{1,60}\*$/.test(p)) parent.appendChild(el('em', null, p));
      else parent.appendChild(document.createTextNode(p));
    });
  }

  // ============================================================
  // Home: the habitat and the pet that lives in it
  // ============================================================

  const pet = {
    mode: 'sit',
    x: 0,
    targetX: 0,
    facing: -1,           // -1 = looking left, toward the page
    frame: 0,
    frameAt: 0,
    nextThink: 0,
    carrying: false,
    away: false,
    busy: null,           // 'listening' | 'thinking' | 'running' | 'letter' | 'delivered'
    lastPoke: 0,
    width: 0,             // habitat inner width
    scale: 0.62,
    line: null,           // today's status line for the current mode
  };

  function spriteFrame(anim, frame) {
    const a = ANIM[anim];
    const s = pet.scale;
    spriteEl.style.width = FRAME_W * s + 'px';
    spriteEl.style.height = a.h * s + 'px';
    spriteEl.style.backgroundSize = SHEET_W * s + 'px ' + SHEET_H * s + 'px';
    spriteEl.style.backgroundPosition = (-frame * FRAME_W * s) + 'px ' + (-a.y * s) + 'px';
  }

  function measure() {
    pet.scale = window.matchMedia('(max-width: 520px)').matches ? 0.5 : 0.56;
    pet.width = stage.clientWidth;
    const maxX = Math.max(0, pet.width - FRAME_W * pet.scale);
    if (!pet.away) {
      pet.x = Math.min(pet.x, maxX);
      pet.targetX = Math.min(pet.targetX, maxX);
    }
    render();
  }

  function maxX() { return Math.max(0, pet.width - FRAME_W * pet.scale); }

  // Pepper's day (/api/pepper/day): status lines per activity, written by the
  // model a few times an hour. STATUS above is the fallback.
  let dayLines = null;
  function lineFor(mode) {
    const list = dayLines && dayLines[mode];
    return list && list.length ? list[Math.floor(Math.random() * list.length)] : STATUS[mode];
  }

  function setMode(mode) {
    if (pet.mode === mode) return;
    pet.mode = mode;
    pet.line = lineFor(mode);
    pet.frame = 0;
    pet.frameAt = performance.now();
    root.dataset.mode = mode;
    updateStatus();
    render();
  }

  function updateStatus() {
    const key = pet.busy || (home.matches(':hover') && !chat.open ? 'happy' : pet.mode);
    statusEl.textContent = key === 'working' ? workStatus() : (key === pet.mode && pet.line) || STATUS[key] || '';
  }

  function render() {
    spriteFrame(pet.mode, pet.frame);
    petEl.style.transform = 'translateX(' + pet.x.toFixed(1) + 'px)';
    spriteEl.style.transform = pet.facing < 0 ? 'scaleX(-1)' : '';
    petEl.classList.toggle('carrying', pet.carrying);
    petEl.classList.toggle('left', pet.facing < 0);
    shadowEl.style.transform = 'translateX(' + (pet.x + FRAME_W * pet.scale * 0.5).toFixed(1) + 'px)';
    shadowEl.style.opacity = pet.away ? '0' : '';
  }

  function walkTo(x, run) {
    pet.targetX = Math.max(0, Math.min(maxX(), x));
    if (Math.abs(pet.targetX - pet.x) < 2) return false;
    pet.facing = pet.targetX > pet.x ? 1 : -1;
    setMode(run ? 'run' : 'walk');
    return true;
  }

  // What to do next when nothing is going on. Small, calm, mostly still.
  function think(now) {
    pet.nextThink = now + 3000 + Math.random() * 4500;
    if (pet.away || pet.busy === 'running') return;

    if (chat.open) {
      // Keep company: sit near the panel, face the conversation.
      if (pet.mode === 'walk' || pet.mode === 'run') return;
      pet.facing = -1;
      setMode(Math.random() < 0.8 ? 'sit' : 'idle');
      return;
    }
    if (pet.busy === 'letter') { pet.facing = -1; setMode('sit'); return; }

    const hour = new Date().getHours();
    const drowsy = (hour >= 0 && hour < 6) || now - pet.lastPoke > 75000;
    if (drowsy && Math.random() < 0.6) { setMode('lie'); return; }
    if (pet.mode === 'lie' && Math.random() < 0.7) return; // naps last a while

    const r = Math.random();
    if (r < 0.5) {
      const span = maxX();
      const hop = (span * 0.25) + Math.random() * span * 0.5;
      if (!walkTo(pet.x + (Math.random() < 0.5 ? -hop : hop))) setMode('idle');
    } else if (r < 0.74) {
      setMode('sit');
    } else if (r < 0.88) {
      setMode('idle');
    } else {
      pet.facing = -pet.facing;
      setMode('idle');
      render();
    }
  }

  function arrive() {
    if (pet.busy === 'running' && pet.carrying) {
      // Off stage with the letter; come back empty-pawed.
      pet.away = true;
      render();
      setTimeout(function () {
        pet.carrying = false;
        pet.away = false;
        pet.busy = 'delivered';
        pet.x = pet.width + 4;
        updateStatus();
        walkTo(maxX() * 0.62, true);
        setTimeout(function () { if (pet.busy === 'delivered') { pet.busy = null; updateStatus(); } }, 4000);
      }, 1400);
      return;
    }
    if (chat.open) { pet.facing = -1; setMode('sit'); return; }
    if (pet.busy === 'letter') { pet.facing = -1; setMode('sit'); return; }
    setMode(Math.random() < 0.6 ? 'sit' : 'idle');
  }

  let lastTick = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (document.hidden) { lastTick = now; return; }
    const dt = Math.min(0.05, (now - (lastTick || now)) / 1000);
    lastTick = now;

    if (houseAnimates && now - (tick.houseAt || 0) > 120) { tick.houseAt = now; drawHouse(now); }

    const a = ANIM[pet.mode];
    if (a.n > 1 && now - pet.frameAt >= a.ms) {
      pet.frame = (pet.frame + 1) % a.n;
      pet.frameAt = now;
      spriteFrame(pet.mode, pet.frame);
    }

    if (pet.mode === 'walk' || pet.mode === 'run') {
      const speed = pet.mode === 'run' ? 170 : 26;
      const d = pet.targetX - pet.x;
      const step = Math.sign(d) * Math.min(Math.abs(d), speed * dt);
      pet.x += step;
      render();
      if (Math.abs(pet.targetX - pet.x) < 0.5) { pet.x = pet.targetX; arrive(); }
    } else if (now >= pet.nextThink) {
      think(now);
    }
  }

  // Leave the stage to the right carrying the visitor's note, then come back.
  function runOffWithNote() {
    pet.busy = 'running';
    pet.carrying = true;
    if (reduced) {
      pet.busy = 'delivered';
      pet.carrying = false;
      updateStatus();
      setTimeout(function () { pet.busy = null; updateStatus(); }, 4000);
      return;
    }
    pet.facing = 1;
    pet.targetX = pet.width + 24;
    setMode('run');
    updateStatus();
  }

  // Run in from the right with David's letter and sit down with it.
  function arriveWithLetter() {
    pet.busy = 'letter';
    pet.carrying = true;
    updateStatus();
    if (reduced) { render(); return; }
    pet.away = false;
    pet.x = pet.width + 4;
    walkTo(maxX() * 0.55, true);
  }

  function letterRead() {
    if (pet.busy !== 'letter') return;
    pet.busy = chat.open ? 'listening' : null;
    pet.carrying = false;
    updateStatus();
    render();
  }

  function poke() {
    pet.lastPoke = performance.now();
    if (pet.mode === 'lie' && !pet.busy) setMode('idle');
  }

  // Watch the cursor: turn toward it when it comes close, wake up when it's near.
  let pointerRaf = 0;
  function onPointerMove(e) {
    if (pointerRaf) return;
    pointerRaf = requestAnimationFrame(function () {
      pointerRaf = 0;
      if (chat.open || pet.away || pet.mode === 'walk' || pet.mode === 'run') return;
      const r = stage.getBoundingClientRect();
      const px = r.left + pet.x + FRAME_W * pet.scale / 2;
      const py = r.bottom - 30;
      const dist = Math.hypot(e.clientX - px, e.clientY - py);
      if (dist > 260) return;
      pet.lastPoke = performance.now();
      const face = e.clientX < px ? -1 : 1;
      if (face !== pet.facing) { pet.facing = face; render(); }
      if (pet.mode === 'lie' && dist < 140 && !pet.busy) setMode('alert');
      else if ((pet.mode === 'idle' || pet.mode === 'sit') && dist < 180 && !pet.busy && Math.random() < 0.02) setMode('alert');
    });
  }

  function buildHome() {
    home = el('button', 'pepper-home');
    home.type = 'button';
    home.setAttribute('aria-expanded', 'false');
    home.setAttribute('aria-controls', 'pepper-panel');
    home.setAttribute('aria-label', 'Talk to Pepper, David’s dog');

    const caption = el('span', 'ph-caption');
    caption.appendChild(el('b', null, 'pepper'));
    statusEl = el('span', 'ph-status', STATUS.sit);
    caption.appendChild(statusEl);
    home.appendChild(caption);

    // The dog house at a glance, on the home itself; tapping it opens "help him".
    needEl = el('span', 'ph-need');
    needEl.hidden = true;
    home.appendChild(needEl);

    const cta = el('span', 'ph-cta');
    cta.appendChild(el('span', null, 'talk'));
    cta.insertAdjacentHTML('beforeend', ARROW);
    home.appendChild(cta);

    dotEl = el('span', 'ph-dot');
    dotEl.hidden = true;
    home.appendChild(dotEl);

    stage = el('span', 'ph-stage');
    stage.setAttribute('aria-hidden', 'true');
    stage.appendChild(el('span', 'ph-floor'));
    houseCanvas = el('canvas', 'ph-house');
    houseCanvas.width = GRID_W;
    houseCanvas.height = GRID_H;
    houseCanvas.style.width = GRID_W * PX + 'px';
    houseCanvas.style.height = GRID_H * PX + 'px';
    houseCtx = houseCanvas.getContext('2d');
    stage.appendChild(houseCanvas);
    sparksEl = el('span', 'ph-sparks');
    stage.appendChild(sparksEl);
    fleetEl = el('span', 'ph-fleet');
    fleetEl.appendChild(el('span', 'ph-leds'));
    home.appendChild(fleetEl);
    shadowEl = el('span', 'ph-shadow');
    stage.appendChild(shadowEl);
    petEl = el('span', 'ph-pet');
    spriteEl = el('span', 'ph-sprite');
    spriteEl.style.backgroundImage = "url('" + SHEET + "')";
    petEl.appendChild(spriteEl);
    const carry = el('span', 'ph-carry');
    carry.innerHTML = LETTER;
    petEl.appendChild(carry);
    const z = el('span', 'ph-z');
    z.innerHTML = '<i>z</i><i>z</i><i>z</i>';
    petEl.appendChild(z);
    stage.appendChild(petEl);
    home.appendChild(stage);

    home.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.ph-need')) { open(); showPalette(); return; }
      chat.open ? close() : open();
    });
    home.addEventListener('mouseenter', function () {
      poke();
      if (!chat.open && !pet.busy && pet.mode !== 'walk' && pet.mode !== 'run') setMode('happy');
      updateStatus();
    });
    home.addEventListener('mouseleave', function () {
      if (pet.mode === 'happy') setMode('sit');
      updateStatus();
    });
  }

  // ============================================================
  // The dog house he is building (server/pepper/world.ts is the source of truth)
  // ============================================================

  // Drawn as real pixel art: a 60x36 grid painted at 2x on a canvas.
  const GRID_W = 60, GRID_H = 36, PX = 2;
  const HEX = {
    red: '#e0524d', orange: '#ef8a3c', yellow: '#f2cf4a', green: '#58b368', teal: '#2fb5a8', blue: '#4a8fe0',
    indigo: '#6366f1', purple: '#9b6be0', pink: '#ee7fb3', white: '#e9e8f0', black: '#2b2b35', brown: '#8a5a34',
  };
  const C = {
    wood: '#b07a45', woodDark: '#7f5230', woodLight: '#caa06a', brick: '#a9533d', mortar: '#6d3326',
    shingle: '#575c7d', glass: '#8fd3ff', dark: '#14141e', pole: '#8e94ab', leaf: '#3f8f4f', ground: 'rgba(0,0,0,0.35)',
  };
  const WORK = {
    floor: 'laying floor planks', walls: 'building the walls', roof: 'shingling the roof',
    door: 'hanging the door', window: 'cutting a window', paint: 'painting the walls',
  };
  const HOUSE_DOOR_X = 20 * PX; // where he stands to work, in stage px

  let houseCanvas, houseCtx, sparksEl, fleetEl, worldState = null, seenBuild = null;

  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = function (v) { return Math.max(0, Math.min(255, Math.round(v * f))); };
    return 'rgb(' + ch(n >> 16) + ',' + ch((n >> 8) & 255) + ',' + ch(n & 255) + ')';
  }

  function drawHouse(t) {
    const w = worldState;
    const g = houseCtx;
    if (!g) return;
    g.clearRect(0, 0, GRID_W, GRID_H);
    const r = function (x, y, ww, hh, c) { g.fillStyle = c; g.fillRect(x, y, ww, hh); };
    if (!w) return;
    const P = w.parts;
    const frac = function (k) { return P[k] ? P[k].done / P[k].of : 0; };

    // Ground shadow under the plot
    r(2, 35, 36, 1, C.ground);

    // Nothing built yet: stake out the plot
    if (frac('floor') === 0) {
      for (let x = 3; x < 37; x += 2) r(x, 34, 1, 1, 'rgba(165,180,252,0.5)');
      r(35, 27, 1, 8, C.woodDark); r(32, 26, 7, 4, C.woodLight); r(33, 27, 5, 1, C.woodDark);
    }

    // Floor
    const fw = Math.round(34 * frac('floor'));
    if (fw) {
      r(3, 32, fw, 3, C.woodDark);
      r(3, 32, fw, 1, C.woodLight);
      for (let x = 8; x < 3 + fw; x += 6) r(x, 33, 1, 2, shade(C.wood, 0.7));
    }

    // Walls rise bottom-up
    const wf = frac('walls');
    const wh = Math.round(18 * wf);
    if (wh) {
      const top = 32 - wh;
      const painted = w.parts.paint && w.parts.paint.done > 0 && w.wallColor;
      const base = painted ? HEX[w.wallColor] : w.wallMaterial === 'brick' ? C.brick : C.wood;
      r(6, top, 28, wh, base);
      if (w.wallMaterial === 'brick' && !painted) {
        for (let y = 31; y >= top; y -= 3) {
          r(6, y, 28, 1, C.mortar);
          const off = ((31 - y) / 3) % 2 ? 3 : 0;
          for (let x = 6 + off; x < 34; x += 6) r(x, Math.max(top, y - 2), 1, Math.min(2, y - top), C.mortar);
        }
      } else {
        for (let y = 31; y >= top; y -= 3) r(6, y, 28, 1, shade(base, 0.82));
      }
      r(6, top, 1, wh, shade(base, 0.7));
      r(33, top, 1, wh, shade(base, 0.7));
    }

    // Scaffolding while the shell is going up
    const shellBusy = (wf > 0 && wf < 1) || (wf === 1 && frac('roof') < 1);
    if (shellBusy) {
      const top = wf < 1 ? 32 - wh - 3 : 10;
      r(4, top, 1, 34 - top, C.pole); r(35, top, 1, 34 - top, C.pole);
      for (let y = top + 2; y < 32; y += 5) { r(4, y, 3, 1, C.pole); r(33, y, 3, 1, C.pole); }
    }

    // Door and window
    if (P.door && P.door.done) {
      const frame = w.doorColor ? HEX[w.doorColor] : C.woodDark;
      r(16, 22, 8, 10, frame);
      r(17, 23, 6, 9, C.dark);
      r(17, 22, 6, 1, frame);
      const blanket = w.decor.find(function (d) { return d.item === 'blanket'; });
      if (blanket) r(17, 30, 6, 2, HEX[blanket.color || 'blue']);
    }
    if (P.window && P.window.done) {
      const glow = w.decor.some(function (d) { return d.item === 'lantern'; });
      r(26, 18, 5, 5, C.woodDark);
      r(27, 19, 3, 3, glow ? '#ffe7a3' : C.glass);
      r(28, 19, 1, 3, C.woodDark); r(27, 20, 3, 1, C.woodDark);
    }

    // Roof, course by course
    const rf = frac('roof');
    if (rf > 0) {
      const color = w.roofColor ? HEX[w.roofColor] : C.shingle;
      if (w.roofStyle === 'flat') {
        const rows = Math.max(1, Math.round(4 * rf));
        for (let k = 0; k < rows; k++) r(2, 14 - k, 36, 1, k % 2 ? shade(color, 0.85) : color);
      } else {
        const rows = Math.max(1, Math.round(11 * rf));
        for (let k = 0; k < rows; k++) {
          const hw = w.roofStyle === 'dome'
            ? Math.round(Math.sqrt(Math.max(0, 16 * 16 - (k * 1.45) * (k * 1.45))) * 1.12)
            : 18 - Math.round(k * 1.65);
          if (hw <= 0) break;
          r(20 - hw, 14 - k, hw * 2, 1, k % 2 ? shade(color, 0.85) : color);
        }
      }
    }

    // Decorations
    const has = function (item) { return w.decor.filter(function (d) { return d.item === item; }); };
    const roofDone = rf === 1;
    has('flag').slice(0, 1).forEach(function (d) {
      const baseY = roofDone ? (w.roofStyle === 'flat' ? 10 : 3) : 26;
      const x = roofDone ? 20 : 41;
      r(x, baseY - 5, 1, roofDone ? 6 : 9, C.pole);
      const c = HEX[d.color || 'red'];
      r(x + 1, baseY - 5, 4, 1, c); r(x + 1, baseY - 4, 3, 1, c); r(x + 1, baseY - 3, 2, 1, c);
    });
    if (has('lights').length && wf === 1) {
      const colors = [HEX.yellow, HEX.pink, HEX.teal];
      for (let i = 0, x = 4; x < 36; x += 3, i++) {
        const on = reduced || Math.floor(t / 500 + i) % 3 !== 0;
        r(x, 15 + (i % 2), 1, 1, on ? colors[i % 3] : 'rgba(255,255,255,0.15)');
      }
    }
    if (has('lantern').length) {
      g.globalAlpha = reduced ? 0.18 : 0.12 + 0.06 * Math.sin(t / 300);
      r(11, 21, 5, 5, '#ffd66b');
      r(12, 20, 3, 7, '#ffd66b');
      g.globalAlpha = 1;
      r(13, 20, 1, 2, C.dark); r(12, 22, 3, 3, '#ffd66b');
    }
    if (has('bell').length && P.door && P.door.done) { r(25, 21, 2, 2, '#e2b54a'); r(25, 23, 2, 1, '#b8892c'); }
    has('flower').forEach(function (d, i) {
      const x = [1, 38, 44][i];
      r(x, 31, 1, 4, C.leaf); r(x - 1, 29, 3, 2, HEX[d.color || 'pink']); r(x, 30, 1, 1, HEX.yellow);
    });
    has('ball').slice(0, 1).forEach(function (d) { const c = HEX[d.color || 'red']; r(40, 32, 3, 3, c); r(40, 32, 1, 1, shade(c, 1.3)); });
    if (has('bone').length) { r(22, 35, 4, 1, '#f1efe6'); r(21, 34, 1, 1, '#f1efe6'); r(26, 34, 1, 1, '#f1efe6'); }
    if (has('bowl').length) { r(36, 33, 5, 2, '#6b7280'); r(37, 32, 3, 1, '#4a8fe0'); }
    if (has('cactus').length) { r(47, 28, 2, 7, '#4c9a5a'); r(45, 30, 1, 2, '#4c9a5a'); r(46, 31, 1, 1, '#4c9a5a'); r(49, 29, 1, 2, '#4c9a5a'); }
    if (has('mushroom').length) { r(0, 32, 4, 2, '#d9534f'); r(1, 32, 1, 1, '#fff'); r(1, 34, 2, 1, '#f1efe6'); }
    if (has('sign').length) { r(51, 30, 1, 5, C.woodDark); r(48, 26, 7, 4, C.woodLight); r(49, 27, 5, 1, C.woodDark); r(49, 28, 3, 1, C.woodDark); }

    // His pile of materials, stacked
    let y = 34;
    const pile = w.pile || {};
    const stack = function (n, h, draw) { for (let i = 0; i < Math.min(n || 0, 4); i++) { draw(y - h + 1); y -= h; } };
    stack(pile.plank, 1, function (yy) { r(53, yy, 7, 1, C.wood); r(53, yy, 1, 1, C.woodDark); });
    stack(pile.brick, 2, function (yy) { r(54, yy, 5, 2, C.brick); r(54, yy + 1, 5, 1, C.mortar); });
    stack(pile.shingle, 1, function (yy) { r(54, yy, 5, 1, C.shingle); });
    if (pile.paint) { r(55, y - 3, 3, 3, '#cfd3e0'); r(55, y - 3, 3, 1, HEX.white); y -= 4; }
  }

  function workStatus() {
    return worldState && worldState.lastBuild ? WORK[worldState.lastBuild.part] : 'building';
  }

  // He walks over, faces the house, and gets to work for a few seconds.
  function workOnHouse() {
    if (pet.busy && pet.busy !== 'listening') return;
    const was = pet.busy;
    pet.busy = 'working';
    updateStatus();
    const done = function () {
      if (pet.busy === 'working') pet.busy = was === 'listening' && chat.open ? 'listening' : null;
      updateStatus();
    };
    if (reduced) { setTimeout(done, 3000); return; }
    walkTo(HOUSE_DOOR_X + 26, false);
    let n = 0;
    const hammer = setInterval(function () {
      if (pet.mode === 'walk') return;
      pet.facing = -1;
      setMode(n % 2 ? 'sit' : 'alert');
      spark();
      if (++n > 7) { clearInterval(hammer); setMode('sit'); done(); }
    }, 450);
  }

  function spark() {
    if (!sparksEl) return;
    const s = el('i', null, n2('tok', 'tap', '✦'));
    s.style.left = (22 + Math.random() * 40) + 'px';
    sparksEl.appendChild(s);
    setTimeout(function () { s.remove(); }, 900);
  }
  function n2() { return arguments[Math.floor(Math.random() * arguments.length)]; }

  function applyWorld(state) {
    if (!state) return;
    const first = worldState === null;
    if (state.catalog) worldCatalog = state.catalog;
    worldState = state;
    const id = state.lastBuild && state.lastBuild.id;
    if (!first && id && id !== seenBuild) workOnHouse();
    seenBuild = id || null;
    // Only string lights and lanterns flicker; otherwise draw once per change.
    houseAnimates = !reduced && (state.decor || []).some(function (d) { return d.item === 'lights' || d.item === 'lantern'; });
    drawHouse(reduced ? 0 : performance.now());
    noticeChanges(state);
    renderNeed();
    renderProject();
  }

  function fetchWorld() {
    return fetch('/api/pepper/world?visitorId=' + encodeURIComponent(visitorId()))
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(applyWorld)
      .catch(function () { /* the house can wait */ });
  }

  // David's agents, on a little screen on the wall (public repos only).
  function renderFleet(f) {
    if (!fleetEl) return;
    // No feed at all (not configured, or Longhouse unreachable): no screen, rather than a broken one.
    fleetEl.hidden = !f || !f.updatedAt;
    const lights = fleetEl.querySelector('.ph-leds');
    lights.textContent = '';
    const working = f && f.sessions ? f.sessions.filter(function (s) { return s.state === 'working'; }) : [];
    for (let i = 0; i < Math.min(working.length, 6); i++) {
      const led = el('i');
      led.style.animationDelay = (i * 0.37) % 1.6 + 's';
      lights.appendChild(led);
    }
    fleetEl.classList.toggle('on', working.length > 0);
    const repos = working.map(function (s) { return s.repo; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    fleetEl.title = working.length
      ? "david's agents: " + working.length + ' working (' + repos.join(', ') + ')'
      : "david's agents are quiet right now";
  }

  function fetchFleet() {
    return fetch('/api/pepper/fleet')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(renderFleet)
      .catch(function () { renderFleet(null); });
  }

  // ---- the project strip in the chat panel ----

  let projectEl = null, paletteEl = null, pickedItem = null, needEl = null, houseAnimates = false;
  let sinceYou = [];

  function needText(w) {
    if (w.paused) return 'dog house · on a break';
    if (w.needs && w.needs.length) {
      const n = w.needs[0];
      return 'dog house · needs ' + n.count + ' ' + ITEM_LABEL[n.item] + (n.count > 1 && n.item !== 'paint' ? 's' : '');
    }
    return w.complete ? 'dog house · done, bring decorations' : 'dog house · working on it';
  }

  function renderNeed() {
    if (!needEl || !worldState) return;
    needEl.textContent = needText(worldState);
    needEl.title = 'help pepper build it';
    needEl.hidden = false;
  }

  // What happened on the house since this browser last looked, once, on return.
  function noticeChanges(state) {
    const latest = (state.recent || []).reduce(function (m, r) { return Math.max(m, r.ts); }, 0);
    if (!latest) return;
    let seen = 0;
    try { seen = Number(localStorage.getItem('__pepper_house_seen')) || 0; } catch { /* storage blocked */ }
    if (!noticeChanges.done) {
      noticeChanges.done = true;
      if (seen) sinceYou = state.recent.filter(function (r) { return r.ts > seen; }).slice(-2).map(function (r) { return r.text; });
    }
    if (latest > seen) {
      try { localStorage.setItem('__pepper_house_seen', String(latest)); } catch { /* storage blocked */ }
    }
  }

  function showPalette() {
    if (!paletteEl) return;
    paletteEl.hidden = false;
    projectEl.querySelector('.pc-proj-help').setAttribute('aria-expanded', 'true');
    pickedItem = null;
    renderProject();
  }
  const ITEM_LABEL = { plank: 'plank', brick: 'brick', shingle: 'shingle', paint: 'paint', flag: 'flag', lantern: 'lantern', flower: 'flower', ball: 'ball', bone: 'bone', blanket: 'blanket', bowl: 'bowl', lights: 'string lights', bell: 'bell', cactus: 'cactus', mushroom: 'mushroom', sign: 'sign' };

  function buildProject() {
    projectEl = el('div', 'pc-project');
    projectEl.hidden = true;
    const top = el('div', 'pc-proj-top');
    top.appendChild(el('span', 'pc-proj-title', 'building a dog house'));
    top.appendChild(el('span', 'pc-proj-count'));
    const help = el('button', 'pc-proj-help', 'help him');
    help.type = 'button';
    help.setAttribute('aria-expanded', 'false');
    help.addEventListener('click', function () {
      paletteEl.hidden = !paletteEl.hidden;
      help.setAttribute('aria-expanded', String(!paletteEl.hidden));
      pickedItem = null;
      renderProject();
    });
    top.appendChild(help);
    projectEl.appendChild(top);
    projectEl.appendChild(el('div', 'pc-proj-needs'));
    projectEl.appendChild(el('div', 'pc-proj-since'));
    projectEl.appendChild(el('div', 'pc-proj-yours'));
    paletteEl = el('div', 'pc-palette');
    paletteEl.hidden = true;
    projectEl.appendChild(paletteEl);
    return projectEl;
  }

  function renderProject() {
    if (!projectEl || !worldState) return;
    const w = worldState;
    projectEl.hidden = false;
    let done = 0, of = 0;
    Object.keys(w.parts).forEach(function (k) { done += w.parts[k].done; of += w.parts[k].of; });
    projectEl.querySelector('.pc-proj-title').textContent = w.complete ? 'decorating his dog house' : 'building a dog house';
    projectEl.querySelector('.pc-proj-count').textContent = w.complete ? w.helpers + ' helpers' : done + '/' + of;
    const sinceEl = projectEl.querySelector('.pc-proj-since');
    sinceEl.textContent = sinceYou.length ? 'since you were here: ' + sinceYou.join(', ') : '';
    sinceEl.hidden = !sinceEl.textContent;
    const needsEl = projectEl.querySelector('.pc-proj-needs');
    needsEl.textContent = w.paused ? 'on a break for now'
      : w.needs && w.needs.length
        ? 'needs ' + w.needs.map(function (n) { return n.count + ' ' + ITEM_LABEL[n.item] + (n.count > 1 && n.item !== 'paint' ? 's' : ''); }).join(', ')
        : w.complete ? 'finished! bring him something to decorate it' : 'has what he needs, working on it';
    // This visitor's own mark on the house, the newest one.
    const yours = projectEl.querySelector('.pc-proj-yours');
    yours.textContent = w.yours && w.yours.length ? w.yours[0] : '';
    yours.hidden = !yours.textContent;

    if (paletteEl.hidden) return;
    paletteEl.textContent = '';
    const needed = (w.needs || []).map(function (n) { return n.item; });
    const catalog = worldCatalog.items || Object.keys(ITEM_LABEL);
    if (pickedItem) {
      paletteEl.appendChild(el('div', 'pc-pal-label', 'what color ' + ITEM_LABEL[pickedItem] + '?'));
      const row = el('div', 'pc-swatches');
      Object.keys(HEX).forEach(function (c) {
        const b = el('button', 'pc-swatch');
        b.type = 'button';
        b.style.background = HEX[c];
        b.setAttribute('aria-label', c);
        b.addEventListener('click', function () { giveItem(pickedItem, c); });
        row.appendChild(b);
      });
      paletteEl.appendChild(row);
      return;
    }
    paletteEl.appendChild(el('div', 'pc-pal-label', 'hand him something'));
    const grid = el('div', 'pc-items');
    catalog.forEach(function (item) {
      const b = el('button', 'pc-item' + (needed.indexOf(item) >= 0 ? ' needed' : ''), ITEM_LABEL[item] || item);
      b.type = 'button';
      b.addEventListener('click', function () {
        const colored = (worldCatalog.colored || []).indexOf(item) >= 0;
        if (colored) { pickedItem = item; renderProject(); } else giveItem(item, null);
      });
      grid.appendChild(b);
    });
    paletteEl.appendChild(grid);
  }

  let worldCatalog = { colored: ['paint', 'flag', 'flower', 'ball', 'blanket'] };
  let tz = null;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* fine */ }

  const THANKS = {
    plank: '*grabs the plank* perfect, thank you!',
    brick: '*nudges the brick into place* thank you!',
    shingle: '*carries the shingle up* the roof thanks you',
    paint: '*sniffs the paint can* ooh. thank you!',
  };

  async function giveItem(item, color) {
    pickedItem = null;
    paletteEl.hidden = true;
    projectEl.querySelector('.pc-proj-help').setAttribute('aria-expanded', 'false');
    let data = null;
    try {
      const res = await fetch('/api/pepper/world/give', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId(), item: item, color: color, timezone: tz }),
      });
      data = await res.json();
    } catch { /* offline */ }
    if (data && data.ok) {
      const decor = (worldCatalog.decor || []).indexOf(item) >= 0;
      addPepper(data.built && THANKS[item] ? THANKS[item]
        : decor ? '*wag* for my house? i love it. thank you!'
          : '*adds it to the pile* thank you!');
      applyWorld(data.state);
    } else if (data && data.reason === 'limited') {
      addPepper("you've already helped a lot today. come back tomorrow? *wag*");
    } else if (data && data.reason === 'full') {
      addPepper("i already have plenty of those! maybe something else? *tilt*");
      applyWorld(data.state);
    } else {
      addPepper(FALLBACK);
    }
  }

  // ============================================================
  // Voice: one thought on arrival
  // ============================================================

  let bubbleTimer = 0;
  function say(text, ms) {
    if (chat.open || !text) return;
    bubble.textContent = '';
    appendRich(bubble, text, true);
    bubble.hidden = false;
    // Point the bubble's tail at Pepper wherever he is standing.
    const r = stage.getBoundingClientRect();
    const br = bubble.getBoundingClientRect();
    const anchor = r.left + pet.x + FRAME_W * pet.scale / 2 - br.left;
    bubble.style.setProperty('--tail', Math.max(18, Math.min(br.width - 18, anchor)) + 'px');
    requestAnimationFrame(function () { bubble.classList.add('on'); });
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, ms || 7000);
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    bubble.classList.remove('on');
    setTimeout(function () { if (!bubble.classList.contains('on')) bubble.hidden = true; }, 250);
  }

  function browserName(s) {
    if (!s) return null;
    if (s.includes('Firefox')) return 'Firefox';
    if (s.includes('Edg/')) return 'Edge';
    if (s.includes('Safari') && !s.includes('Chrome')) return 'Safari';
    if (s.includes('Chrome')) return 'Chrome';
    return null;
  }

  // Just enough for Pepper to notice someone: where in the world (by timezone),
  // their language, phone or not, and their browser. Nothing finer-grained.
  function visitorTraits() {
    let timezone = null;
    try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* fine */ }
    return {
      timezone: timezone,
      language: navigator.language || null,
      device: { type: window.matchMedia('(pointer: coarse)').matches && window.innerWidth < 820 ? 'mobile' : 'desktop' },
      browser: { name: browserName(navigator.userAgent) },
    };
  }

  // One call on arrival: the server remembers the visit and may answer with a thought.
  async function hello() {
    try {
      const res = await fetch('/api/pepper/hello', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: visitorId(),
          page: location.pathname,
          referrer: document.referrer || null,
          hour: new Date().getHours(),
          weekday: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
          traits: visitorTraits(),
        }),
      });
      const data = res.ok ? await res.json() : null;
      if (data && data.thought && !chat.unread && !chat.open) say(data.thought);
    } catch { /* a quiet dog is fine */ }
  }

  // ============================================================
  // Chat panel
  // ============================================================

  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function add(node) { log.appendChild(node); scrollDown(); return node; }

  function addPepper(text) {
    const m = el('div', 'pc-msg from-pepper');
    appendRich(m, text, true);
    return add(m);
  }

  function addVisitor(text) {
    const m = el('div', 'pc-msg from-visitor');
    appendRich(m, text, false);
    return add(m);
  }

  function formatWhen(d) {
    if (Date.now() - d.getTime() < 60000) return 'just now';
    return d.toDateString() === new Date().toDateString()
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function addDavid(text, ts) {
    const card = el('div', 'pc-letter');
    card.appendChild(el('div', 'pc-k', 'Letter from David'));
    const p = el('p');
    appendRich(p, text, false);
    card.appendChild(p);
    if (ts && (!chat.lastDavidTs || ts > chat.lastDavidTs)) chat.lastDavidTs = ts;
    card.appendChild(el('div', 'pc-sig', 'David · ' + formatWhen(ts ? new Date(ts) : new Date())));
    return add(card);
  }

  function addStatus(status) {
    const row = el('div', 'pc-status');
    if (status === 'sent') {
      row.classList.add('ok');
      row.innerHTML = ENVELOPE;
      row.appendChild(el('b', null, 'carried to david'));
    } else {
      row.classList.add('muted');
      row.appendChild(el('span', null, status === 'limited'
        ? 'pepper has carried enough letters for now. try again later.'
        : "the letter didn't make it. try again in a bit."));
    }
    return add(row);
  }

  let typingEl = null;
  function showTyping() {
    if (typingEl) return;
    typingEl = el('div', 'pc-typing');
    typingEl.setAttribute('aria-label', 'Pepper is typing');
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    add(typingEl);
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function clearChips() { if (chat.chips) { chat.chips.remove(); chat.chips = null; } }

  function addChips(options) {
    clearChips();
    if (!Array.isArray(options) || options.length === 0) return;
    const wrap = el('div', 'pc-chips');
    options.slice(0, 3).forEach(function (opt) {
      if (typeof opt !== 'string' || !opt.trim()) return;
      const b = el('button', 'pc-chip', opt.trim());
      b.type = 'button';
      b.addEventListener('click', function () { send(opt.trim(), 'option'); });
      wrap.appendChild(b);
    });
    if (wrap.childNodes.length) chat.chips = add(wrap);
  }

  function addContactCard() {
    if (chat.contactEmail || chat.askedContact) return;
    chat.askedContact = true;

    const card = el('form', 'pc-card');
    card.noValidate = true;
    const id = 'pc-contact-' + Date.now();
    const label = el('label', null, 'Where should his reply go?');
    label.htmlFor = id;
    const row = el('div', 'pc-row');
    const field = el('input');
    field.type = 'email';
    field.id = id;
    field.autocomplete = 'email';
    field.inputMode = 'email';
    field.placeholder = 'you@example.com';
    field.required = true;
    const btn = el('button', 'pc-btn', 'Send');
    btn.type = 'submit';
    row.appendChild(field);
    row.appendChild(btn);
    const err = el('div', 'pc-err');
    err.hidden = true;
    card.appendChild(label);
    card.appendChild(row);
    card.appendChild(err);
    card.appendChild(el('div', 'pc-fine', 'only david sees it. or just type it in the chat.'));

    if (chat.telegramLink) {
      const tg = el('a', 'pc-tg');
      tg.href = chat.telegramLink;
      tg.target = '_blank';
      tg.rel = 'noopener noreferrer';
      tg.innerHTML = TG;
      tg.appendChild(document.createTextNode(IN_APP ? 'open in your browser first to use telegram' : 'get his reply on telegram'));
      card.appendChild(tg);
    }

    card.addEventListener('submit', async function (e) {
      e.preventDefault();
      const email = field.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        err.textContent = "That doesn't look like an email address.";
        err.hidden = false;
        field.focus();
        return;
      }
      err.hidden = true;
      btn.disabled = true;
      field.disabled = true;
      const ok = await saveContact(email);
      if (ok) {
        card.remove();
        addPepper('got it. his reply goes to ' + ok + ' *tail wag*');
      } else {
        btn.disabled = false;
        field.disabled = false;
        err.textContent = "Couldn't save that. Check the address and try again.";
        err.hidden = false;
      }
    });

    add(card);
  }

  function buildPanel() {
    panel = el('div', 'pepper-panel');
    panel.id = 'pepper-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with Pepper');

    const head = el('div', 'pc-head');
    const who = el('div', 'pc-who');
    who.appendChild(el('b', null, 'Chat with Pepper'));
    who.appendChild(el('small', null, 'knows david’s work · carries messages'));
    head.appendChild(who);
    const x = el('button', 'pc-close');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close chat');
    x.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
    x.addEventListener('click', close);
    head.appendChild(x);

    log = el('div', 'pc-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');

    form = el('form', 'pc-composer');
    input = el('input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.maxLength = MAX_LEN;
    input.placeholder = 'Ask Pepper, or say “tell david…”';
    input.setAttribute('aria-label', 'Message Pepper');
    sendBtn = el('button', 'pc-send');
    sendBtn.type = 'submit';
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = ARROW;
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      send(text, 'typed');
    });

    panel.appendChild(head);
    panel.appendChild(buildProject());
    panel.appendChild(log);
    panel.appendChild(form);
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
    });
  }

  async function open() {
    if (chat.open) return;
    chat.open = true;
    lastFocus = document.activeElement;
    hideBubble();
    panel.hidden = false;
    root.classList.add('is-open');
    home.setAttribute('aria-expanded', 'true');
    setUnread(false);
    letterRead();
    poke();
    if (!pet.busy) pet.busy = 'listening';
    pet.facing = -1;
    if (pet.mode !== 'run') setMode('sit');
    updateStatus();
    markSeen();

    if (!chat.loaded) {
      chat.loaded = true;
      await loadHistory();
    }
    scrollDown();
    input.focus();
  }

  function close() {
    if (!chat.open) return;
    chat.open = false;
    panel.hidden = true;
    root.classList.remove('is-open');
    home.setAttribute('aria-expanded', 'false');
    if (pet.busy === 'listening' || pet.busy === 'thinking') pet.busy = null;
    updateStatus();
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    else home.focus();
  }

  function setUnread(on) {
    chat.unread = on;
    dotEl.hidden = !on;
    home.setAttribute('aria-label', on ? 'Pepper has a letter from David for you' : 'Talk to Pepper, David’s dog');
  }

  // ============================================================
  // Server
  // ============================================================

  function fetchHistory() {
    if (!chat.historyPromise) {
      chat.historyPromise = fetch('/api/pepper/history?visitorId=' + encodeURIComponent(visitorId()))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return chat.historyPromise;
  }

  function markSeen() {
    if (!chat.lastDavidTs) return;
    try { localStorage.setItem('__pepper_seen', String(chat.lastDavidTs)); } catch { /* ignore */ }
  }

  async function loadHistory() {
    const data = await fetchHistory();
    const messages = (data && Array.isArray(data.messages)) ? data.messages : [];
    if (data) {
      chat.contactEmail = data.contactEmail || null;
      chat.telegramLink = data.telegramLink || null;
      chat.relayed = !!data.relayed;
    }
    if (messages.length === 0) {
      addPepper(GREETING);
    } else {
      messages.forEach(function (m) {
        if (!m || typeof m.text !== 'string') return;
        if (m.from === 'visitor') addVisitor(m.text);
        else if (m.from === 'david') addDavid(m.text, m.ts);
        else addPepper(m.text);
      });
    }
    if (chat.relayed) openStream();
    markSeen();
  }

  async function saveContact(email) {
    try {
      const res = await fetch('/api/pepper/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId(), email: email }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      chat.contactEmail = data.email || email;
      return chat.contactEmail;
    } catch {
      return null;
    }
  }

  async function send(text, via) {
    if (chat.sending) return;
    text = String(text).slice(0, MAX_LEN);
    chat.sending = true;
    sendBtn.disabled = true;
    clearChips();
    addVisitor(text);
    showTyping();
    pet.busy = 'thinking';
    if (pet.mode !== 'run') setMode('alert');
    updateStatus();

    let data = null;
    let status = 0;
    try {
      const res = await fetch('/api/pepper/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: visitorId(), text: text, page: location.pathname, via: via, timezone: tz }),
      });
      status = res.status;
      try { data = await res.json(); } catch { data = null; }
    } catch {
      status = 0;
    }

    hideTyping();
    chat.sending = false;
    sendBtn.disabled = false;
    if (pet.busy === 'thinking') pet.busy = chat.open ? 'listening' : null;
    if (pet.mode === 'alert') setMode('sit');

    if (status === 200 && data && typeof data.say === 'string') {
      if (data.say) addPepper(data.say);
      if (data.relay && data.relay.status) {
        addStatus(data.relay.status);
        if (data.relay.status === 'sent') {
          chat.relayed = true;
          openStream();
          runOffWithNote();
        }
      }
      if ('contactEmail' in data) chat.contactEmail = data.contactEmail || chat.contactEmail;
      if (data.telegramLink) chat.telegramLink = data.telegramLink;
      if (data.askContact && !chat.contactEmail) addContactCard();
      if (data.world && data.world.state) applyWorld(data.world.state);
      addChips(data.options);
    } else if (data && typeof data.say === 'string' && data.say) {
      addPepper(data.say);
    } else {
      addPepper(FALLBACK);
    }
    updateStatus();
    if (chat.open) input.focus();
  }

  function openStream() {
    if (chat.es || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/pepper/stream?visitorId=' + encodeURIComponent(visitorId()));
    chat.es = es;
    es.addEventListener('david', function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg && typeof msg.text === 'string') onDavidReply(msg);
    });
    // Every (re)connect: a reply may have landed while no stream was listening.
    es.addEventListener('open', catchUp);
  }

  async function catchUp() {
    let data = null;
    try {
      const res = await fetch('/api/pepper/history?visitorId=' + encodeURIComponent(visitorId()));
      data = res.ok ? await res.json() : null;
    } catch { return; }
    const msgs = data && Array.isArray(data.messages) ? data.messages : [];
    msgs.forEach(function (m) {
      if (m && m.from === 'david' && typeof m.text === 'string' && (!chat.lastDavidTs || m.ts > chat.lastDavidTs)) onDavidReply(m);
    });
  }

  function onDavidReply(msg) {
    if (msg.ts && (!chat.lastDavidTs || msg.ts > chat.lastDavidTs)) chat.lastDavidTs = msg.ts;
    if (!chat.loaded) {
      chat.historyPromise = null; // refetch on open so history includes it
      setUnread(true);
      arriveWithLetter();
      say('*ears perk* david wrote back! ' + TAP + ' me', 9000);
      return;
    }
    if (chat.open) {
      addPepper('*drops letter* he wrote back!');
      addDavid(msg.text, msg.ts);
      markSeen();
      if (!reduced) {
        pet.x = pet.width + 4;
        pet.carrying = true;
        pet.busy = 'letter';
        walkTo(maxX() * 0.55, true);
        setTimeout(letterRead, 2200);
      }
    } else {
      addPepper('*drops letter* he wrote back!');
      addDavid(msg.text, msg.ts);
      setUnread(true);
      arriveWithLetter();
      say('*ears perk* david wrote back! ' + TAP + ' me', 9000);
    }
  }

  // ============================================================
  // Start
  // ============================================================

  function init() {
    root = el('div', 'pepper');
    root.dataset.mode = 'sit';
    if (reduced) root.classList.add('still');

    bubble = el('div', 'pepper-bubble');
    bubble.hidden = true;
    bubble.setAttribute('role', 'status');
    bubble.addEventListener('click', open);

    buildHome();
    buildPanel();
    root.appendChild(panel);
    root.appendChild(bubble);
    root.appendChild(home);
    document.body.appendChild(root);

    visitorId();
    measure();
    pet.x = maxX() * 0.7;
    pet.targetX = pet.x;
    pet.lastPoke = performance.now();
    render();

    if ('ResizeObserver' in window) new ResizeObserver(measure).observe(stage);
    else window.addEventListener('resize', measure);

    if (!reduced) {
      pet.nextThink = performance.now() + 1500;
      requestAnimationFrame(tick);
      window.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    fetchWorld();
    fetchFleet();
    setInterval(function () { if (!document.hidden) { fetchWorld(); fetchFleet(); } }, 60000);

    fetch('/api/pepper/day')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.statuses) return;
        dayLines = d.statuses;
        pet.line = lineFor(pet.mode);
        updateStatus();
      })
      .catch(function () { /* fixed lines are fine */ });

    // /m/<token> links from Pepper's emails land on /?pepper=open.
    if (/[?&]pepper=open\b/.test(location.search)) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
      open();
    }

    // Returning visitor with a letter waiting: Pepper is holding it.
    fetchHistory().then(function (data) {
      let letterWaiting = false;
      if (data && data.relayed) {
        chat.relayed = true;
        const msgs = Array.isArray(data.messages) ? data.messages : [];
        msgs.forEach(function (m) { if (m && m.from === 'david' && m.ts > (chat.lastDavidTs || 0)) chat.lastDavidTs = m.ts; });
        const last = msgs[msgs.length - 1];
        if (last && last.from === 'david') {
          let seen = null;
          try { seen = localStorage.getItem('__pepper_seen'); } catch { /* ignore */ }
          letterWaiting = String(last.ts) !== seen && !chat.open;
        }
        openStream();
      }
      if (letterWaiting) {
        setUnread(true);
        pet.busy = 'letter';
        pet.carrying = true;
        updateStatus();
        render();
        setTimeout(function () { say('*wag* david wrote back while you were gone. ' + TAP + ' me', 9000); }, 1200);
      }
      // Always say hello to the server (it remembers the visit); the bubble
      // only shows when Pepper is not already holding a letter.
      setTimeout(hello, 1400);
    });
  }

  window.PepperChat = {
    open: open,
    close: close,
    isOpen: function () { return chat.open; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
