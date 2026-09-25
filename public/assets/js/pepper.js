/**
 * Pepper - David's dog, living in a small home in the corner of drose.io.
 *
 * One component, three parts:
 *   home   a glass habitat (bottom right) where the sprite lives: he wanders a
 *          little, sits, naps, watches the cursor, runs off with letters. The
 *          whole home is the button that opens the chat.
 *   chat   a typing-first panel that grows out of the home. Pepper answers from
 *          the public site and carries messages to David (server/pepper).
 *   voice  a short thought bubble on page load (/api/creature/think).
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
  const MAX_LEN = 2000;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
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
    pet.scale = window.matchMedia('(max-width: 520px)').matches ? 0.54 : 0.62;
    pet.width = stage.clientWidth;
    const maxX = Math.max(0, pet.width - FRAME_W * pet.scale);
    if (!pet.away) {
      pet.x = Math.min(pet.x, maxX);
      pet.targetX = Math.min(pet.targetX, maxX);
    }
    render();
  }

  function maxX() { return Math.max(0, pet.width - FRAME_W * pet.scale); }

  function setMode(mode) {
    if (pet.mode === mode) return;
    pet.mode = mode;
    pet.frame = 0;
    pet.frameAt = performance.now();
    root.dataset.mode = mode;
    updateStatus();
    render();
  }

  function updateStatus() {
    const key = pet.busy || (home.matches(':hover') && !chat.open ? 'happy' : pet.mode);
    statusEl.textContent = STATUS[key] || '';
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

    home.addEventListener('click', function () { chat.open ? close() : open(); });
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

  async function visitorTraits() {
    if (typeof VisitorContext === 'undefined' || !VisitorContext.collect) return null;
    const ctx = await Promise.race([
      VisitorContext.collect().catch(function () { return null; }),
      new Promise(function (r) { setTimeout(function () { r(null); }, 500); }),
    ]);
    if (!ctx) return null;
    return {
      timezone: ctx.locale && ctx.locale.timezone,
      language: ctx.browser && ctx.browser.language,
      languages: ctx.browser && ctx.browser.languages,
      screen: ctx.device ? { width: ctx.device.screenWidth, height: ctx.device.screenHeight, pixelRatio: ctx.device.pixelRatio } : null,
      device: ctx.device ? { type: ctx.device.touchPoints > 0 ? 'mobile' : 'desktop' } : null,
      browser: ctx.browser ? { name: browserName(ctx.browser.userAgent) } : null,
      connection: ctx.network ? { effectiveType: ctx.network.effectiveType, downlink: ctx.network.downlink, rtt: ctx.network.rtt } : null,
      battery: ctx.battery,
    };
  }

  async function arrivalThought() {
    try {
      const res = await fetch('/api/creature/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vid: visitorId(),
          trigger: 'page_load',
          context: { currentPage: location.pathname, timeOnPage: Math.floor(performance.now() / 1000), hour: new Date().getHours() },
          visitor: await visitorTraits(),
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.thought && !chat.unread) say(data.thought);
    } catch { /* a quiet dog is fine */ }
  }

  function recordVisit() {
    fetch('/api/creature/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vid: visitorId(), event: 'start', referrer: document.referrer || null, page: location.pathname }),
      keepalive: true,
    }).catch(function () { /* not critical */ });
    window.addEventListener('pagehide', function () {
      const body = JSON.stringify({ vid: visitorId(), event: 'end', timeOnPage: Math.floor(performance.now() / 1000) });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/creature/visit', new Blob([body], { type: 'application/json' }));
    });
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
        body: JSON.stringify({ visitorId: visitorId(), text: text, page: location.pathname, via: via }),
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
      addChips(data.options);
    } else if (status === 429 && data && data.say) {
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
  }

  function onDavidReply(msg) {
    if (!chat.loaded) {
      chat.historyPromise = null; // refetch on open so history includes it
      setUnread(true);
      arriveWithLetter();
      say('*ears perk* david wrote back! click me', 9000);
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
      say('*ears perk* david wrote back! click me', 9000);
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

    recordVisit();

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
        setTimeout(function () { say('*wag* david wrote back while you were gone. click me', 9000); }, 1200);
      } else if (!chat.open) {
        setTimeout(arrivalThought, 1400);
      }
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
