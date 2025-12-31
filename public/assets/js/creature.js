/**
 * Creature System - Pepper the pixel art dog for drose.io
 *
 * A sprite-based creature that wanders the page, reacts to mouse,
 * and reflects real-world state from Life Hub.
 */

(function () {
  'use strict';

  // ============================================================
  // Sprite Configuration
  // ============================================================

  const SPRITE_SHEET = '/assets/images/pepper_spritesheet_v2.png?v=5';

  // Frame data: y-offset, frame height, frame count
  const SPRITES = {
    idle:  { y: 0,   h: 86,  frames: 3, speed: 400 },
    walk:  { y: 86,  h: 73,  frames: 4, speed: 150 },
    run:   { y: 159, h: 73,  frames: 4, speed: 80  },
    sit:   { y: 232, h: 86,  frames: 2, speed: 600 },
    lie:   { y: 318, h: 66,  frames: 2, speed: 800 },
    face:  { y: 384, h: 71,  frames: 2, speed: 500 },
    alert: { y: 455, h: 73,  frames: 1, speed: 0   },
  };

  const FRAME_WIDTH = 100;

  // State to animation mapping
  const STATE_ANIMATIONS = {
    idle: 'idle',
    wander: 'walk',
    flee: 'run',
    curious: 'alert',
    sleep: 'lie',
    happy: 'face',
    sit: 'sit',
  };

  // ============================================================
  // Configuration
  // ============================================================

  const isMobile = window.matchMedia('(max-width: 600px)').matches;

  const CONFIG = {
    wanderIntervalMin: 5000,
    wanderIntervalMax: 15000,
    stateCheckInterval: 60000,

    wanderSpeed: 50,
    fleeSpeed: 400,
    curiousSpeed: 30,

    // Smaller interaction distances on mobile (touch is less precise)
    fleeDistance: isMobile ? 100 : 120,
    curiousDistance: isMobile ? 250 : 300,
    ignoreDistance: isMobile ? 350 : 400,

    boundaryPadding: isMobile ? 40 : 80,
  };

  // ============================================================
  // State
  // ============================================================

  const state = {
    x: 100,
    y: 100,
    currentState: 'idle',
    targetX: null,
    targetY: null,
    facingLeft: false,

    mouseX: 0,
    mouseY: 0,
    mouseSpeed: 0,
    lastMouseX: 0,
    lastMouseY: 0,
    lastMouseTime: 0,

    mood: 'neutral',
    energy: 70,

    // Animation
    currentAnimation: 'idle',
    currentFrame: 0,
    lastFrameChange: 0,

    lastWander: 0,
    nextWanderTime: 8000,
    stateStartTime: 0,

    // Performance
    isPaused: false,
    lastX: null,
    lastY: null,
    lastViewportHeight: null,
    lastSpriteHeight: null,

    // Interaction tracking
    interactions: {
      clicks: 0,
      fled: 0,
    },

    // LLM thought cooldown
    lastLLMRequest: 0,
  };

  // ============================================================
  // DOM Elements
  // ============================================================

  let container = null;
  let spriteEl = null;

  // ============================================================
  // Visitor Tracking
  // ============================================================

  // In-memory fallback for when localStorage is unavailable (Safari private, etc.)
  const memoryStorage = { vid: null, visits: 0 };

  function generateUUID() {
    // Fallback for environments without crypto.randomUUID
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Simple fallback UUID generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getVisitorId() {
    try {
      let vid = localStorage.getItem('__vid');
      if (!vid) {
        vid = generateUUID();
        localStorage.setItem('__vid', vid);
      }
      return vid;
    } catch {
      // localStorage unavailable (Safari private mode, etc.)
      if (!memoryStorage.vid) {
        memoryStorage.vid = generateUUID();
      }
      return memoryStorage.vid;
    }
  }

  function getVisitCount() {
    try {
      const stored = parseInt(localStorage.getItem('__visit_count') || '0', 10);
      const count = (Number.isFinite(stored) ? stored : 0) + 1;
      localStorage.setItem('__visit_count', String(count));
      return count;
    } catch {
      // localStorage unavailable
      memoryStorage.visits++;
      return memoryStorage.visits;
    }
  }

  // ============================================================
  // LLM Thought Requests
  // ============================================================

  const LLM_COOLDOWN = 10000; // 10s between requests

  // Visitor context from collector library (pre-collected on init)
  let visitorCtx = null;
  let visitorCtxPromise = null;

  // Start collecting immediately (don't block on it)
  function startVisitorContextCollection() {
    if (visitorCtxPromise) return visitorCtxPromise;
    if (typeof VisitorContext !== 'undefined' && VisitorContext.collect) {
      visitorCtxPromise = VisitorContext.collect()
        .then(ctx => { visitorCtx = ctx; return ctx; })
        .catch(e => { console.warn('VisitorContext collection failed:', e); return null; });
    } else {
      visitorCtxPromise = Promise.resolve(null);
    }
    return visitorCtxPromise;
  }

  // Get cached context (with timeout if still collecting)
  async function getVisitorCtx() {
    if (visitorCtx) return visitorCtx;
    if (!visitorCtxPromise) startVisitorContextCollection();
    // Wait max 6s for collection (library waits for web vitals which takes ~5s)
    const timeout = new Promise(r => setTimeout(() => r(null), 6000));
    return Promise.race([visitorCtxPromise, timeout]);
  }

  async function requestLLMThought(trigger) {
    // Cooldown check
    const now = Date.now();
    if (now - state.lastLLMRequest < LLM_COOLDOWN) return;
    state.lastLLMRequest = now;

    // Collect visitor context (cached after first call)
    const vctx = await getVisitorCtx();

    try {
      const response = await fetch('/api/creature/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vid: getVisitorId(),
          trigger,
          context: {
            currentPage: window.location.pathname,
            timeOnPage: Math.floor(performance.now() / 1000),
            hour: new Date().getHours(),
          },
          // Visitor traits from collector library (map to expected structure)
          visitor: vctx ? {
            timezone: vctx.locale?.timezone,
            language: vctx.browser?.language,
            languages: vctx.browser?.languages,
            screen: vctx.device ? {
              width: vctx.device.screenWidth,
              height: vctx.device.screenHeight,
              pixelRatio: vctx.device.pixelRatio,
            } : null,
            device: vctx.device ? {
              type: vctx.device.touchPoints > 0 ? 'mobile' : 'desktop',
            } : null,
            browser: vctx.browser ? {
              name: detectBrowserName(vctx.browser.userAgent),
            } : null,
            connection: vctx.network ? {
              effectiveType: vctx.network.effectiveType,
              downlink: vctx.network.downlink,
              rtt: vctx.network.rtt,
            } : null,
            battery: vctx.battery,
          } : null,
        }),
      });

      if (!response.ok) return;

      const data = await response.json();

      if (data.thought) {
        showThought(data.thought);
      }

      if (data.mood) {
        state.mood = data.mood;
        container.setAttribute('data-mood', data.mood);
      }
    } catch {
      // LLM failed, instant greeting already shown
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  function init() {
    // Early return for reduced motion (accessibility)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // Start collecting visitor context early (non-blocking)
    startVisitorContextCollection();

    createCreatureDOM();
    bindEvents();
    startAnimationLoop();

    // Start at right edge
    const bounds = getViewportBounds();
    state.x = bounds.maxX;
    state.y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);

    // Target cursor or center (clamped to bounds)
    state.targetX = Math.max(bounds.minX, Math.min(bounds.maxX, window.innerWidth / 2));
    state.targetY = Math.max(bounds.minY, Math.min(bounds.maxY, window.innerHeight / 2));

    // Start walking toward target
    setState('wander');

    updatePosition();

    // Request LLM thought after approach animation starts
    setTimeout(() => {
      requestLLMThought('page_load');
    }, 600);

    // Record visit (fire and forget, don't block page load)
    recordVisit();

    fetchCreatureState();
    setInterval(fetchCreatureState, CONFIG.stateCheckInterval);
  }

  function createCreatureDOM() {
    container = document.createElement('div');
    container.className = 'creature-container interactive';
    container.setAttribute('data-state', 'idle');

    // Create sprite element
    spriteEl = document.createElement('div');
    spriteEl.className = 'creature-sprite';
    spriteEl.style.cssText = `
      width: ${FRAME_WIDTH}px;
      height: ${SPRITES.idle.h}px;
      background-image: url('${SPRITE_SHEET}');
      background-repeat: no-repeat;
      background-position: 0 0;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    `;

    container.appendChild(spriteEl);

    // Thought bubble
    const thought = document.createElement('div');
    thought.className = 'creature-thought';
    container.appendChild(thought);

    document.body.appendChild(container);

    // Set initial sprite frame
    setAnimation('idle');
  }

  // ============================================================
  // Sprite Animation
  // ============================================================

  function setAnimation(animName) {
    if (state.currentAnimation === animName) return;

    state.currentAnimation = animName;
    state.currentFrame = 0;
    state.lastFrameChange = performance.now();

    const sprite = SPRITES[animName];
    if (sprite) {
      spriteEl.style.height = sprite.h + 'px';
      updateSpriteFrame();
    }
  }

  function updateSpriteFrame() {
    const sprite = SPRITES[state.currentAnimation];
    if (!sprite) return;

    const x = state.currentFrame * FRAME_WIDTH;
    const y = sprite.y;

    spriteEl.style.backgroundPosition = `-${x}px -${y}px`;
  }

  function advanceFrame(now) {
    const sprite = SPRITES[state.currentAnimation];
    if (!sprite || sprite.frames <= 1) return;

    if (now - state.lastFrameChange > sprite.speed) {
      state.currentFrame = (state.currentFrame + 1) % sprite.frames;
      state.lastFrameChange = now;
      updateSpriteFrame();
    }
  }

  // ============================================================
  // Event Binding
  // ============================================================

  function bindEvents() {
    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('click', onCreatureClick);
    container.addEventListener('touchend', onCreatureTap);
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Track idle time (30s of no interaction)
    let lastInteraction = Date.now();
    document.addEventListener('mousemove', () => { lastInteraction = Date.now(); }, { passive: true });
    document.addEventListener('touchmove', () => { lastInteraction = Date.now(); }, { passive: true });
    document.addEventListener('keydown', () => { lastInteraction = Date.now(); }, { passive: true });
    document.addEventListener('scroll', () => { lastInteraction = Date.now(); }, { passive: true });

    setInterval(() => {
      if (Date.now() - lastInteraction > 30000) {
        requestLLMThought('idle');
        lastInteraction = Date.now(); // Reset to avoid spam
      }
    }, 30000);

    // Exit intent detection (mouse leaving viewport at top)
    document.addEventListener('mouseout', (e) => {
      if (e.clientY < 10 && e.relatedTarget === null) {
        requestLLMThought('leaving');
      }
    });

    // Send final interaction counts on page exit (use sendBeacon for reliability)
    window.addEventListener('beforeunload', () => {
      const data = JSON.stringify({
        vid: getVisitorId(),
        event: 'end',
        timeOnPage: Math.floor(performance.now() / 1000),
        interactions: state.interactions,
      });

      // Try sendBeacon first (most reliable), fall back to fetch
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/creature/visit', new Blob([data], { type: 'application/json' }));
      } else {
        fetch('/api/creature/visit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: data,
          keepalive: true,
        }).catch(() => {
          // Failed to send, not critical
        });
      }
    });
  }

  function onMouseMove(e) {
    const now = performance.now();
    const dt = now - state.lastMouseTime;

    if (dt > 0) {
      const dx = e.clientX - state.lastMouseX;
      const dy = e.clientY - state.lastMouseY;
      state.mouseSpeed = Math.sqrt(dx * dx + dy * dy) / dt * 1000;
    }

    state.mouseX = e.clientX;
    state.mouseY = e.clientY;
    state.lastMouseX = e.clientX;
    state.lastMouseY = e.clientY;
    state.lastMouseTime = now;
  }

  function onTouchStart(e) {
    // Initialize touch tracking on first touch
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      state.mouseX = touch.clientX;
      state.mouseY = touch.clientY;
      state.lastMouseX = touch.clientX;
      state.lastMouseY = touch.clientY;
      state.lastMouseTime = performance.now();
    }
  }

  function onTouchMove(e) {
    // Track touch position like mouse position
    if (e.touches.length > 0) {
      const touch = e.touches[0];
      const now = performance.now();
      const dt = now - state.lastMouseTime;

      if (dt > 0) {
        const dx = touch.clientX - state.lastMouseX;
        const dy = touch.clientY - state.lastMouseY;
        state.mouseSpeed = Math.sqrt(dx * dx + dy * dy) / dt * 1000;
      }

      state.mouseX = touch.clientX;
      state.mouseY = touch.clientY;
      state.lastMouseX = touch.clientX;
      state.lastMouseY = touch.clientY;
      state.lastMouseTime = now;
    }
  }

  function onCreatureTap(e) {
    e.preventDefault(); // Prevent click event from also firing
    onCreatureClick();
  }

  function onCreatureClick() {
    state.interactions.clicks++;
    showThought(getRandomThought());

    // Request LLM thought for click interaction
    requestLLMThought('click');

    if (state.currentState !== 'flee') {
      setState('happy');
      setTimeout(() => {
        if (state.currentState === 'happy') {
          setState('idle');
        }
      }, 2000);
    }
  }

  function onVisibilityChange() {
    state.isPaused = document.hidden;

    if (state.isPaused) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      return;
    }

    // Resume animation loop (ensure only one RAF chain)
    if (!rafId) {
      lastFrameTime = performance.now();
      rafId = requestAnimationFrame(animationLoop);
    }
  }

  // ============================================================
  // State Machine
  // ============================================================

  function setState(newState) {
    if (state.currentState === newState) return;

    state.currentState = newState;
    state.stateStartTime = performance.now();
    container.setAttribute('data-state', newState);

    // Set appropriate animation
    const animName = STATE_ANIMATIONS[newState] || 'idle';
    setAnimation(animName);
  }

  function updateState() {
    const now = performance.now();
    const creatureScreenPos = getCreatureScreenPosition();
    const distToMouse = getDistance(
      creatureScreenPos.x,
      creatureScreenPos.y,
      state.mouseX,
      state.mouseY
    );

    // Priority: flee > curious > current state
    if (distToMouse < CONFIG.fleeDistance && state.currentState !== 'flee') {
      setState('flee');
      setFleeTarget();
      return;
    }

    if (state.currentState === 'flee') {
      if (hasArrivedAtTarget()) {
        setState('idle');
        scheduleNextWander();
      }
      return;
    }

    if (distToMouse < CONFIG.curiousDistance && distToMouse > CONFIG.fleeDistance) {
      if (state.currentState !== 'curious') {
        setState('curious');
      }
      // Look at mouse (update facing direction)
      updateFacingDirection(state.mouseX);
      return;
    }

    if (state.currentState === 'idle' && now - state.lastWander > state.nextWanderTime) {
      setState('wander');
      setRandomWanderTarget();
      return;
    }

    if (state.currentState === 'wander' && hasArrivedAtTarget()) {
      setState('idle');
      scheduleNextWander();
    }

    if (state.currentState === 'curious' && distToMouse > CONFIG.curiousDistance) {
      setState('idle');
      scheduleNextWander();
    }
  }

  function scheduleNextWander() {
    state.lastWander = performance.now();
    state.nextWanderTime = CONFIG.wanderIntervalMin +
      Math.random() * (CONFIG.wanderIntervalMax - CONFIG.wanderIntervalMin);
  }

  // ============================================================
  // Movement
  // ============================================================

  function setRandomWanderTarget() {
    const bounds = getViewportBounds();
    state.targetX = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    state.targetY = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
  }

  function setFleeTarget() {
    state.interactions.fled++;
    const creatureScreenPos = getCreatureScreenPosition();

    const angle = Math.atan2(
      creatureScreenPos.y - state.mouseY,
      creatureScreenPos.x - state.mouseX
    );

    const fleeDistance = 200 + Math.random() * 100;
    let newX = state.x + Math.cos(angle) * fleeDistance;
    let newY = state.y - Math.sin(angle) * fleeDistance;

    const bounds = getViewportBounds();
    newX = Math.max(bounds.minX, Math.min(bounds.maxX, newX));
    newY = Math.max(bounds.minY, Math.min(bounds.maxY, newY));

    state.targetX = newX;
    state.targetY = newY;
  }

  function moveTowardTarget(dt) {
    if (state.targetX === null || state.targetY === null) return;

    const dx = state.targetX - state.x;
    const dy = state.targetY - state.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 2) {
      state.x = state.targetX;
      state.y = state.targetY;
      return;
    }

    // Update facing direction based on movement
    if (Math.abs(dx) > 1) {
      updateFacingDirection(state.x + dx);
    }

    let speed = CONFIG.wanderSpeed;
    if (state.currentState === 'flee') speed = CONFIG.fleeSpeed;
    if (state.currentState === 'curious') speed = CONFIG.curiousSpeed;

    const moveAmount = speed * (dt / 1000);
    const ratio = Math.min(1, moveAmount / dist);

    state.x += dx * ratio;
    state.y += dy * ratio;
  }

  function hasArrivedAtTarget() {
    if (state.targetX === null) return true;
    const dx = state.targetX - state.x;
    const dy = state.targetY - state.y;
    return Math.sqrt(dx * dx + dy * dy) < 5;
  }

  function updateFacingDirection(targetX) {
    const shouldFaceLeft = targetX < state.x;
    if (shouldFaceLeft !== state.facingLeft) {
      state.facingLeft = shouldFaceLeft;
      container.classList.toggle('facing-left', shouldFaceLeft);
    }
  }

  // ============================================================
  // Animation Loop
  // ============================================================

  let lastFrameTime = 0;
  let rafId = 0;

  function startAnimationLoop() {
    lastFrameTime = performance.now();
    if (rafId) return;
    rafId = requestAnimationFrame(animationLoop);
  }

  function animationLoop(now) {
    // Pause when tab is hidden
    if (state.isPaused) {
      rafId = 0;
      return;
    }

    const dt = now - lastFrameTime;
    lastFrameTime = now;

    updateState();
    moveTowardTarget(dt);
    updatePosition();
    advanceFrame(now);

    rafId = requestAnimationFrame(animationLoop);
  }

  function updatePosition() {
    const viewportHeight = window.innerHeight;
    const spriteHeight = SPRITES[state.currentAnimation]?.h ?? SPRITES.idle.h;

    // Only update if something affecting transform changed
    if (
      state.x === state.lastX &&
      state.y === state.lastY &&
      viewportHeight === state.lastViewportHeight &&
      spriteHeight === state.lastSpriteHeight
    ) return;

    // Use transform for GPU-accelerated movement
    const transformX = state.x;
    const transformY = viewportHeight - state.y - spriteHeight;
    container.style.transform = `translate3d(${transformX}px, ${transformY}px, 0)`;

    state.lastX = state.x;
    state.lastY = state.y;
    state.lastViewportHeight = viewportHeight;
    state.lastSpriteHeight = spriteHeight;
  }

  // ============================================================
  // Thought Bubbles
  // ============================================================

  const thoughts = [
    '...', 'woof!', '*sniff*', 'hello!', ':)', '*wag*', '*curious*', 'ooh', 'arf!',
  ];

  function getRandomThought() {
    return thoughts[Math.floor(Math.random() * thoughts.length)];
  }

  function showThought(text) {
    const thoughtEl = container.querySelector('.creature-thought');
    if (!thoughtEl) return;

    thoughtEl.textContent = text;
    container.classList.add('thinking');

    setTimeout(() => {
      container.classList.remove('thinking');
    }, 2000);
  }

  // ============================================================
  // Data Integration
  // ============================================================

  async function recordVisit() {
    try {
      await fetch('/api/creature/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vid: getVisitorId(),
          event: 'start',
          referrer: document.referrer || null,
          page: window.location.pathname,
        }),
      });
    } catch {
      // Server tracking failed, not critical
    }
  }

  async function fetchCreatureState() {
    try {
      const response = await fetch('/api/creature/state');
      if (!response.ok) return;

      const data = await response.json();

      state.mood = data.mood || 'neutral';
      state.energy = data.energy || 70;

      container.setAttribute('data-mood', state.mood);

      if (state.energy < 30 && data.time?.isNight) {
        setState('sleep');
      }
    } catch {
      // API not available
    }
  }

  // ============================================================
  // Utilities
  // ============================================================

  function getViewportBounds() {
    return {
      minX: CONFIG.boundaryPadding,
      maxX: window.innerWidth - CONFIG.boundaryPadding - FRAME_WIDTH,
      minY: CONFIG.boundaryPadding,
      maxY: window.innerHeight - CONFIG.boundaryPadding - 100,
    };
  }

  function getCreatureScreenPosition() {
    const spriteHeight = SPRITES[state.currentAnimation]?.h ?? SPRITES.idle.h;
    return {
      x: state.x + FRAME_WIDTH / 2,
      y: window.innerHeight - state.y - spriteHeight / 2,
    };
  }

  function getDistance(x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function detectBrowserName(ua) {
    if (!ua) return null;
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Edg/')) return 'Edge';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Safari';
    if (ua.includes('Chrome')) return 'Chrome';
    return null;
  }

  // ============================================================
  // Start
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
