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

  const SPRITE_SHEET = '/assets/images/pepper_spritesheet.png?v=1';

  // Frame data: y-offset, frame height, frame count
  const SPRITES = {
    idle:  { y: 0,   h: 88,  frames: 3, speed: 400 },
    walk:  { y: 88,  h: 85,  frames: 4, speed: 150 },
    run:   { y: 173, h: 82,  frames: 4, speed: 80  },
    sit:   { y: 255, h: 99,  frames: 2, speed: 600 },
    lie:   { y: 354, h: 58,  frames: 2, speed: 800 },
    face:  { y: 412, h: 119, frames: 2, speed: 500 },
    alert: { y: 531, h: 79,  frames: 1, speed: 0   },
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

  const CONFIG = {
    wanderIntervalMin: 5000,
    wanderIntervalMax: 15000,
    stateCheckInterval: 60000,

    wanderSpeed: 50,
    fleeSpeed: 400,
    curiousSpeed: 30,

    fleeDistance: 120,
    curiousDistance: 300,
    ignoreDistance: 400,

    boundaryPadding: 80,
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
  };

  // ============================================================
  // DOM Elements
  // ============================================================

  let container = null;
  let spriteEl = null;

  // ============================================================
  // Initialization
  // ============================================================

  function init() {
    // Early return on mobile or reduced motion preference
    if (window.matchMedia('(max-width: 600px)').matches ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    createCreatureDOM();
    bindEvents();
    startAnimationLoop();
    scheduleNextWander();

    const bounds = getViewportBounds();
    state.x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
    state.y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
    updatePosition();

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
    container.addEventListener('click', onCreatureClick);
    document.addEventListener('visibilitychange', onVisibilityChange);
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

  function onCreatureClick() {
    showThought(getRandomThought());

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

  // ============================================================
  // Start
  // ============================================================

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
