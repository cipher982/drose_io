/**
 * Pepper chat - David's visitor-facing agent on drose.io.
 *
 * A fixed launcher plus a typing-first chat panel. Pepper answers from the
 * public site and carries messages to David; David's replies arrive over
 * /api/pepper/stream. Independent of creature.js (which does not run under
 * prefers-reduced-motion); the sprite is only decoration via
 * window.PepperSprite when it exists.
 */

(function () {
  'use strict';

  const SHEET = '/assets/images/pepper_spritesheet_v2.png?v=5';
  const SHEET_W = 400;
  const SHEET_H = 527;
  const FACE = { y: 384, h: 70 };
  const GREETING = "hi! i'm pepper, david's dog. ask me about his work, or tell me something and i'll carry it to him *tilt*";
  const FALLBACK = "*whimper* something went wrong on my end. try again in a moment?";
  const MAX_LEN = 2000;

  const ua = navigator.userAgent || '';
  const IN_APP = /FBAN|FBAV|Instagram|LinkedInApp|Twitter|Line\/|MicroMessenger/i.test(ua) ||
    (/iPhone|iPad|iPod/.test(ua) && /AppleWebKit/.test(ua) && !/Safari/.test(ua));

  const state = {
    vid: null,
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

  let root, launcher, dot, panel, log, form, input, sendBtn, lastFocus;

  // ============================================================
  // Visitor id (shared with the old widget and creature.js: '__vid')
  // ============================================================

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[2]) : null;
  }

  function setCookie(name, value, days) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax';
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  function getVisitorId() {
    if (state.vid) return state.vid;
    let id = null;
    try { id = localStorage.getItem('__vid'); } catch { /* storage blocked */ }
    if (!id) id = getCookie('__vid');
    if (!id) id = uuid();
    try { localStorage.setItem('__vid', id); } catch { /* storage blocked */ }
    if (!getCookie('__vid')) setCookie('__vid', id, 365 * 10);
    state.vid = id;
    return id;
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

  function faceEl(size) {
    const box = el('div', 'pc-face');
    const s = el('div', 'pc-sprite');
    const scale = size / 100 * 1.05;
    s.style.width = 100 * scale + 'px';
    s.style.height = FACE.h * scale + 'px';
    s.style.backgroundImage = "url('" + SHEET + "')";
    s.style.backgroundSize = SHEET_W * scale + 'px ' + SHEET_H * scale + 'px';
    s.style.backgroundPosition = '0px ' + (-FACE.y * scale) + 'px';
    box.appendChild(s);
    return box;
  }

  const ENVELOPE = '<svg width="18" height="12" viewBox="0 0 22 15" aria-hidden="true"><rect x="1" y="1" width="20" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M1.5 1.8 11 8.5l9.5-6.7" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>';
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
    const parts = chunk.split(/(\*[^*\n]{1,60}\*)/g);
    parts.forEach(function (p) {
      if (!p) return;
      if (/^\*[^*\n]{1,60}\*$/.test(p)) parent.appendChild(el('em', null, p));
      else parent.appendChild(document.createTextNode(p));
    });
  }

  function scrollDown() { log.scrollTop = log.scrollHeight; }

  function add(node) { log.appendChild(node); scrollDown(); return node; }

  function addPepper(text) {
    const m = el('div', 'pc-msg pepper');
    appendRich(m, text, true);
    return add(m);
  }

  function addVisitor(text) {
    const m = el('div', 'pc-msg visitor');
    appendRich(m, text, false);
    return add(m);
  }

  function addDavid(text, ts) {
    const card = el('div', 'pc-letter');
    card.appendChild(el('div', 'pc-k', 'Letter from David'));
    const p = el('p');
    appendRich(p, text, false);
    card.appendChild(p);
    if (ts && (!state.lastDavidTs || ts > state.lastDavidTs)) state.lastDavidTs = ts;
    const when = ts ? new Date(ts) : new Date();
    card.appendChild(el('div', 'pc-sig', 'David · ' + formatWhen(when)));
    return add(card);
  }

  function formatWhen(d) {
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function addStatus(status) {
    const row = el('div', 'pc-status');
    if (status === 'sent') {
      row.classList.add('ok');
      row.innerHTML = ENVELOPE;
      const b = el('b', null, 'carried to david');
      row.appendChild(b);
    } else if (status === 'limited') {
      row.classList.add('muted');
      row.appendChild(el('span', null, "pepper has carried enough letters for now. try again later."));
    } else {
      row.classList.add('muted');
      row.appendChild(el('span', null, "the letter didn't make it. try again in a bit."));
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
  function hideTyping() {
    if (typingEl) { typingEl.remove(); typingEl = null; }
  }

  function clearChips() {
    if (state.chips) { state.chips.remove(); state.chips = null; }
  }

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
    if (wrap.childNodes.length) state.chips = add(wrap);
  }

  function addContactCard() {
    if (state.contactEmail || state.askedContact) return;
    state.askedContact = true;

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

    if (state.telegramLink) {
      const tg = el('a', 'pc-tg');
      tg.href = state.telegramLink;
      tg.target = '_blank';
      tg.rel = 'noopener noreferrer';
      tg.innerHTML = TG;
      tg.appendChild(document.createTextNode(IN_APP
        ? 'open in your browser first to use telegram'
        : 'get his reply on telegram'));
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

  async function saveContact(email) {
    try {
      const res = await fetch('/api/pepper/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitorId: getVisitorId(), email: email }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      state.contactEmail = data.email || email;
      return state.contactEmail;
    } catch {
      return null;
    }
  }

  // ============================================================
  // Build
  // ============================================================

  function build() {
    root = el('div', 'pepper-chat');

    launcher = el('button', 'pepper-launcher');
    launcher.type = 'button';
    launcher.setAttribute('aria-expanded', 'false');
    launcher.setAttribute('aria-controls', 'pepper-panel');
    launcher.setAttribute('aria-label', 'Talk to Pepper');
    launcher.appendChild(faceEl(40));
    launcher.appendChild(el('span', 'pc-label', 'talk to pepper'));
    dot = el('span', 'pc-dot');
    dot.hidden = true;
    launcher.appendChild(dot);
    launcher.addEventListener('click', function () { state.open ? close() : open(); });

    panel = el('div', 'pepper-panel');
    panel.id = 'pepper-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with Pepper');

    const head = el('div', 'pc-head');
    head.appendChild(faceEl(34));
    const who = el('div', 'pc-who');
    who.appendChild(el('b', null, 'pepper'));
    who.appendChild(el('small', null, "david's dog · carries messages"));
    head.appendChild(who);
    const x = el('button', 'pc-close', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close chat');
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

    root.appendChild(panel);
    root.appendChild(launcher);
    document.body.appendChild(root);
  }

  // ============================================================
  // Open / close
  // ============================================================

  async function open() {
    if (state.open) return;
    state.open = true;
    lastFocus = document.activeElement;
    panel.hidden = false;
    root.classList.add('is-open');
    launcher.setAttribute('aria-expanded', 'true');
    setUnread(false);
    markSeen();
    if (window.PepperSprite) window.PepperSprite.sit();

    if (!state.loaded) {
      state.loaded = true;
      await loadHistory();
    }
    scrollDown();
    input.focus();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    panel.hidden = true;
    root.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    if (window.PepperSprite) window.PepperSprite.resume();
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
    else launcher.focus();
  }

  function setUnread(on) {
    state.unread = on;
    dot.hidden = !on;
    launcher.setAttribute('aria-label', on ? 'Talk to Pepper (David replied)' : 'Talk to Pepper');
  }

  // ============================================================
  // Server
  // ============================================================

  function fetchHistory() {
    if (!state.historyPromise) {
      state.historyPromise = fetch('/api/pepper/history?visitorId=' + encodeURIComponent(getVisitorId()))
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; });
    }
    return state.historyPromise;
  }

  function markSeen() {
    if (!state.lastDavidTs) return;
    try { localStorage.setItem('__pepper_seen', String(state.lastDavidTs)); } catch { /* ignore */ }
  }

  async function loadHistory() {
    // Offline or not deployed yet: greet anyway.
    const data = await fetchHistory();

    const messages = (data && Array.isArray(data.messages)) ? data.messages : [];
    if (data) {
      state.contactEmail = data.contactEmail || null;
      state.telegramLink = data.telegramLink || null;
      state.relayed = !!data.relayed;
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
    if (state.relayed) openStream();
    markSeen();
  }

  async function send(text, via) {
    if (state.sending) return;
    text = String(text).slice(0, MAX_LEN);
    state.sending = true;
    sendBtn.disabled = true;
    clearChips();
    addVisitor(text);
    showTyping();

    let data = null;
    let status = 0;
    try {
      const res = await fetch('/api/pepper/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visitorId: getVisitorId(),
          text: text,
          page: location.pathname,
          via: via,
        }),
      });
      status = res.status;
      try { data = await res.json(); } catch { data = null; }
    } catch {
      status = 0;
    }

    hideTyping();
    state.sending = false;
    sendBtn.disabled = false;

    if (status === 200 && data && typeof data.say === 'string') {
      if (data.say) addPepper(data.say);
      if (data.relay && data.relay.status) {
        addStatus(data.relay.status);
        if (data.relay.status === 'sent') {
          state.relayed = true;
          openStream();
        }
      }
      if ('contactEmail' in data) state.contactEmail = data.contactEmail || state.contactEmail;
      if (data.telegramLink) state.telegramLink = data.telegramLink;
      if (data.askContact && !state.contactEmail) addContactCard();
      addChips(data.options);
    } else if (status === 429 && data && data.say) {
      addPepper(data.say);
    } else {
      addPepper(FALLBACK);
    }
    if (state.open) input.focus();
  }

  // ============================================================
  // David's replies arrive as SSE event 'david' with {text, ts}
  // ============================================================

  function openStream() {
    if (state.es || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/pepper/stream?visitorId=' + encodeURIComponent(getVisitorId()));
    state.es = es;
    es.addEventListener('david', function (ev) {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg.text !== 'string') return;
      onDavidReply(msg);
    });
  }

  function onDavidReply(msg) {
    if (!state.loaded) {
      // Refetch on first open so history includes this letter.
      state.historyPromise = null;
      setUnread(true);
      if (window.PepperSprite) window.PepperSprite.deliverLetter();
      return;
    }
    if (window.PepperSprite) window.PepperSprite.deliverLetter();
    addPepper('*drops letter* he wrote back!');
    addDavid(msg.text, msg.ts);
    if (state.open) markSeen();
    else setUnread(true);
  }

  // ============================================================
  // Start
  // ============================================================

  function init() {
    build();
    getVisitorId();
    // /m/<token> links from Pepper's emails land on /?pepper=open.
    if (/[?&]pepper=open\b/.test(location.search)) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
      open();
    }
    // A returning visitor with a relayed thread should hear about David's
    // reply before opening the panel. The server says whether a thread exists.
    fetchHistory().then(function (data) {
      if (!data || !data.relayed) return;
      state.relayed = true;
      const msgs = Array.isArray(data.messages) ? data.messages : [];
      const last = msgs[msgs.length - 1];
      if (last && last.from === 'david') {
        let seen = null;
        try { seen = localStorage.getItem('__pepper_seen'); } catch { /* ignore */ }
        if (String(last.ts) !== seen) setUnread(true);
      }
      openStream();
    });
  }

  window.PepperChat = {
    open: open,
    close: close,
    isOpen: function () { return state.open; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
