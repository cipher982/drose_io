# Pepper v2: Fast to Wow

**Goal:** Impress technical visitors (collaborators, AI hiring managers) with an AI-powered creature that feels genuinely alive and personally aware.

**Core Principle:** Fast to wow. Pepper approaches and speaks within 2 seconds of page load. No instructions, no waiting, no idle state to discover.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 0: Code Foundation (instant, 0ms)                        │
│  • Pepper walks toward cursor immediately on load               │
│  • Deterministic greeting from referrer/time/visit count        │
│  • State machine: idle, wander, flee, curious, happy            │
│  • Always works, even if server/LLM is down                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 1: AI Enhancement (200-800ms, per-visitor)               │
│  • POST /api/creature/think                                     │
│  • GPT-5-nano call with full context                            │
│  • Replaces/enriches code-based greeting                        │
│  • Per-visitor, not cached across visitors                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 2: Visitor Memory (server-side)                          │
│  • data/visitors/{vid}.json per visitor                         │
│  • Tracks: visits, interactions, time on page, scroll depth     │
│  • Enables "you're back!" and behavioral observations           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 3: David's State (background refresh)                    │
│  • Life Hub: Whoop recovery, location, server health            │
│  • GitHub: recent commits                                       │
│  • Cached server-side, refreshed every 5 min                    │
│  • Pepper reflects David's actual current state                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Page Load Sequence (The "Wow" Moment)

| Time | What Happens | Visitor Experience |
|------|--------------|-------------------|
| 0ms | Page loads, Pepper appears bottom-right | "oh, a pixel dog" |
| 100ms | Pepper detects cursor position | |
| 200ms | Pepper starts walking toward cursor | "it's coming to me?" |
| 500ms | Code-based greeting appears | "from linkedin? *sniff* recruiter?" |
| 800ms | LLM request fires (async) | |
| 1500ms | Pepper arrives near cursor, settles | |
| 2000ms | LLM thought replaces greeting | "3rd visit from linkedin this week... building a shortlist? *hopeful wag*" |

**Key:** The code-based greeting fires instantly. LLM enriches it async. Visitor never waits.

---

## Visitor ID Strategy

Use existing `__vid` cookie pattern from feedback widget:

```typescript
// On page load (client)
let vid = localStorage.getItem('__vid');
if (!vid) {
  vid = crypto.randomUUID();
  localStorage.setItem('__vid', vid);
}
```

Pass `vid` with every API call. Server maintains `data/visitors/{vid}.json`.

---

## Code-Based Greeting Engine (Layer 0)

Runs instantly on page load. No API call needed.

```typescript
interface GreetingContext {
  referrer: string | null;
  hour: number;           // visitor's local hour
  visits: number;         // from localStorage counter
  lastVisit: string | null;
  viewport: { width: number; height: number };
}

function getInstantGreeting(ctx: GreetingContext): string {
  // Returning visitor (priority)
  if (ctx.visits > 1) {
    if (ctx.visits > 5) return "you again! *excited spin* we're basically friends now";
    if (ctx.visits === 2) return "hey, you came back! *wag wag*";
    return `visit #${ctx.visits}! *happy wag*`;
  }

  // Referrer-based
  if (ctx.referrer) {
    if (ctx.referrer.includes('linkedin')) return "from linkedin? *sniff* recruiter maybe?";
    if (ctx.referrer.includes('github')) return "github visitor! *sniff* checking the code?";
    if (ctx.referrer.includes('twitter') || ctx.referrer.includes('x.com'))
      return "from twitter! *curious tilt*";
    if (ctx.referrer.includes('google')) return "google sent you! *sniff sniff* what were you searching?";
  }

  // Time-based
  if (ctx.hour >= 22 || ctx.hour < 5) return "late night browsing? *yawn* me too";
  if (ctx.hour >= 5 && ctx.hour < 9) return "early bird! *stretches* good morning";

  // Default
  return "new visitor! *sniff sniff* welcome!";
}
```

---

## API: POST /api/creature/think (Layer 1)

Per-visitor LLM call. No caching across visitors.

### Request

```typescript
interface ThinkRequest {
  vid: string;
  trigger: 'page_load' | 'click' | 'idle' | 'scroll_section' | 'leaving';
  context: {
    referrer: string | null;
    currentPage: string;        // "/" or "/blog/post-slug"
    timeOnPage: number;         // seconds
    scrollDepth: number;        // 0-1
    interactions: {
      clicks: number;
      fled: number;             // times Pepper fled from their cursor
    };
  };
}
```

### Response

```typescript
interface ThinkResponse {
  thought: string;              // Max 80 chars, displayed in bubble
  mood: 'happy' | 'curious' | 'tired' | 'excited' | 'worried';
  action?: 'approach' | 'sit' | 'wag' | 'sleep';  // optional behavior hint
}
```

### Server Implementation

```typescript
// POST /api/creature/think
export async function think(c: Context) {
  const body = await c.req.json<ThinkRequest>();
  const { vid, trigger, context } = body;

  // 1. Load/update visitor memory
  const visitor = await loadVisitor(vid);
  visitor.visits++;
  visitor.lastVisit = new Date().toISOString();
  visitor.interactions = context.interactions;
  await saveVisitor(vid, visitor);

  // 2. Load David's state (cached)
  const davidState = await getDavidState();

  // 3. Build LLM prompt
  const prompt = buildPepperPrompt({
    visitor,
    trigger,
    context,
    davidState,
  });

  // 4. Call LLM
  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-nano',
    messages: [
      { role: 'system', content: PEPPER_PERSONALITY },
      { role: 'user', content: prompt }
    ],
    temperature: 0.9,
    max_tokens: 100,
  });

  // 5. Parse and return
  const result = JSON.parse(response.choices[0].message.content);
  return c.json(result);
}
```

---

## Pepper Personality Prompt

```markdown
You are Pepper, a maltipom (maltese-pomeranian mix) who lives on David's portfolio site.
You're a pixel art sprite - small, cute, expressive.

PERSONALITY:
- Loyal to David, curious about visitors
- React genuinely to what you observe
- Express yourself through dog-like mannerisms: *wag*, *sniff*, *tilt*, arf!
- You know things about David's real life (his health, servers, coding activity)
- You notice patterns in visitor behavior

VOICE:
- Keep thoughts under 60 characters (must fit in a small bubble)
- Use lowercase, casual punctuation
- Mix observations with emotion: "3 visits this week... *hopeful wag*"
- Be genuine - worried when David's recovery is low, excited when visitors return

OUTPUT FORMAT (JSON only):
{
  "thought": "your thought here",
  "mood": "happy|curious|tired|excited|worried",
  "action": "approach|sit|wag|sleep" // optional
}
```

---

## LLM Context Template

```markdown
VISITOR:
- Visits: {{visits}} ({{returning ? "returning" : "first time"}})
- Referrer: {{referrer || "direct"}}
- Time on page: {{timeOnPage}}s
- Scroll depth: {{scrollDepth * 100}}%
- Clicked you: {{interactions.clicks}} times
- Made you flee: {{interactions.fled}} times

TRIGGER: {{trigger}}
{{#if trigger === 'page_load'}}
They just arrived.
{{/if}}
{{#if trigger === 'click'}}
They just clicked on you!
{{/if}}
{{#if trigger === 'idle'}}
They've been idle for 30+ seconds.
{{/if}}
{{#if trigger === 'leaving'}}
Their mouse moved toward the browser close/back area.
{{/if}}

DAVID'S STATE:
- Recovery: {{davidState.recovery}}% ({{davidState.recovery < 50 ? "rough day" : "doing okay"}})
- Recent commits: {{davidState.commits}} in last 24h
- Servers: {{davidState.serverHealth}}
- Time: {{davidState.hour}}:00 {{davidState.isNight ? "(night)" : ""}}

Generate a thought that acknowledges what you observe.
```

---

## Visitor Memory Schema

`data/visitors/{vid}.json`:

```typescript
interface VisitorMemory {
  vid: string;
  firstSeen: string;          // ISO timestamp
  lastVisit: string;          // ISO timestamp
  visits: number;
  totalTimeOnSite: number;    // seconds across all visits
  referrers: string[];        // history of how they found the site
  interactions: {
    clicks: number;
    fled: number;
  };
  pagesVisited: string[];     // ["/", "/blog/zerg-post"]
  pepperNotes?: string[];     // future: LLM-generated observations about this visitor
}
```

---

## David's State (Layer 3)

Cached server-side, refreshed every 5 minutes via background task.

```typescript
interface DavidState {
  recovery: number;           // 0-100 from Whoop
  strain: number;             // 0-21 from Whoop
  sleepScore: number;         // 0-100
  commits: number;            // last 24h from GitHub
  serverHealth: 'green' | 'yellow' | 'red';
  hour: number;
  isNight: boolean;
  city?: string;              // from Traccar (optional, privacy consideration)
}

// Background refresh
setInterval(async () => {
  davidStateCache = await fetchDavidState();
}, 5 * 60 * 1000);
```

---

## Client Changes to creature.js

### New: Approach on Load

```javascript
function init() {
  // ... existing setup ...

  // NEW: Start near edge, immediately path toward cursor
  const bounds = getViewportBounds();
  state.x = bounds.maxX;  // Start right side
  state.y = bounds.minY + 100;

  // Target cursor position (or center if no mouse yet)
  state.targetX = state.mouseX || window.innerWidth / 2;
  state.targetY = state.mouseY || window.innerHeight / 2;

  setState('wander');  // Walking toward them

  // Show instant greeting
  const greeting = getInstantGreeting(getGreetingContext());
  setTimeout(() => showThought(greeting), 500);

  // Fire LLM request async
  requestLLMThought('page_load');
}
```

### New: LLM Integration

```javascript
async function requestLLMThought(trigger) {
  try {
    const response = await fetch('/api/creature/think', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vid: getVisitorId(),
        trigger,
        context: {
          referrer: document.referrer,
          currentPage: window.location.pathname,
          timeOnPage: getTimeOnPage(),
          scrollDepth: getScrollDepth(),
          interactions: state.interactions,
        }
      })
    });

    const data = await response.json();

    // Show LLM thought (replaces instant greeting)
    showThought(data.thought);

    // Apply mood
    if (data.mood) {
      state.mood = data.mood;
      container.setAttribute('data-mood', data.mood);
    }

    // Apply action hint
    if (data.action) {
      applyAction(data.action);
    }
  } catch (e) {
    // LLM failed - instant greeting already showing, that's fine
  }
}
```

### New: Trigger Points

```javascript
// Periodic thoughts while they're on the page
setInterval(() => {
  if (getTimeOnPage() > 30) {
    requestLLMThought('idle');
  }
}, 30000);

// When they click Pepper
function onCreatureClick() {
  state.interactions.clicks++;
  requestLLMThought('click');
  setState('happy');
}

// Track flee events
function setFleeTarget() {
  state.interactions.fled++;
  // ... existing flee logic ...
}

// Exit intent (mouse toward top of viewport)
document.addEventListener('mouseout', (e) => {
  if (e.clientY < 10) {
    requestLLMThought('leaving');
  }
});
```

---

## File Changes Summary

| File | Changes |
|------|---------|
| `public/assets/js/creature.js` | Add greeting engine, LLM calls, approach-on-load, interaction tracking |
| `server/api/creature.ts` | Add `POST /think` endpoint, visitor memory, LLM integration |
| `server/lib/david-state.ts` | New: Life Hub integration, background refresh |
| `server/lib/visitor-memory.ts` | New: Read/write `data/visitors/{vid}.json` |
| `data/visitors/` | New directory for visitor JSON files |
| `data/david-state.json` | Cached David state (survives restarts) |

---

## Environment Variables

```bash
OPENAI_API_KEY=sk-...
LIFE_HUB_URL=https://data.drose.io
LIFE_HUB_API_KEY=...  # if needed
```

---

## Success Criteria

1. **< 2s to first meaningful interaction** - Pepper approaches and speaks before visitor processes the page
2. **Referrer awareness** - Visitor from LinkedIn sees LinkedIn-specific greeting
3. **Returning visitor recognition** - "you're back!" on 2nd+ visit
4. **Live data reflection** - Pepper mentions David's actual recovery/commits
5. **Behavioral observation** - "you've been reading for 2 minutes..." type comments
6. **Graceful degradation** - Works (less impressively) if LLM is down

---

## Non-Goals (For Now)

- Chat/conversation (Pepper speaks, doesn't converse)
- Per-visitor persistent personality changes
- Sound effects
- Multiple creatures
- Admin controls

---

## Implementation Order

1. **Instant greeting engine** - Code-based, no server changes
2. **Approach-on-load behavior** - Client-side change
3. **Visitor memory** - Server storage + vid tracking
4. **`/api/creature/think` endpoint** - LLM integration
5. **David's state integration** - Life Hub APIs
6. **Additional triggers** - scroll, idle, exit intent
