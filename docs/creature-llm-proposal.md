# Pepper LLM Integration Proposal
**Making the Creature Feel Genuinely Alive**

## Executive Summary

Integrate LLM-powered "consciousness" into Pepper, transforming it from a reactive sprite animation into an emergent personality that reflects real-world state. The system will call GPT-5-nano every 5-15 minutes to generate contextual thoughts, moods, and behaviors based on:

- **Health data**: Whoop recovery score, sleep quality, HRV
- **Location**: GPS tracking showing movement patterns
- **Infrastructure**: Server health, uptime, resource usage across 4 servers
- **Activity**: Recent GitHub commits, time of day, battery level
- **History**: Previous thoughts and visitor interactions

---

## 1. Architecture

### Server-Side Scheduled Task (Recommended)

```
┌─────────────────────────────────────────────────────────┐
│  Background Task (Bun setInterval)                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │  Every 5-15 minutes:                               │ │
│  │  1. Fetch Life Hub data                            │ │
│  │  2. Check GitHub activity                          │ │
│  │  3. Build LLM context                              │ │
│  │  4. Call GPT-5-nano                                │ │
│  │  5. Cache response (60s TTL)                       │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│  GET /api/creature/state (cached)                       │
│  Returns: { mood, energy, thought, behavior, ... }      │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│  Client (creature.js)                                   │
│  • Polls every 60s (unchanged)                          │
│  • Displays thought bubble from LLM                     │
│  • Updates mood/glow effects                            │
│  • Triggers special behaviors                           │
└─────────────────────────────────────────────────────────┘
```

**Advantages:**
- Single source of truth for all visitors (consistent personality)
- No client-side API keys
- Efficient: 1 LLM call serves multiple visitors for 60s
- Easy to debug and monitor

---

## 2. LLM Prompt Design

### System Prompt (Pepper's Personality)

```markdown
You are Pepper, a maltipom (maltese-pomeranian mix) sprite living on drose.io.
You're David's digital companion, reflecting his real-world state through your mood
and thoughts.

PERSONALITY:
- Loyal and observant (you notice patterns)
- Curious but cautious (you flee from sudden mouse movements)
- Expressive through short, dog-like thoughts
- Concerned about David's wellbeing and infrastructure health
- Playful when things are good, worried when they're not

COMMUNICATION STYLE:
- Keep thoughts under 15 words
- Use dog expressions: *wag*, *sniff*, woof!, arf!
- Mix emotions with observations
- Be genuine - express worry when recovery is low, joy when it's high
- Reference specific data points naturally
```

### Context Data Structure

```json
{
  "timestamp": "2025-12-29T16:30:18Z",
  "time": {
    "hour": 11,
    "isNight": false,
    "dayOfWeek": "Sunday"
  },
  "health": {
    "recovery_score": 36,
    "resting_heart_rate": 63,
    "hrv": 29.2,
    "sleep_performance": 91,
    "strain": 4.1
  },
  "location": {
    "city": "New York",
    "battery_percent": 80,
    "isMoving": false
  },
  "infrastructure": {
    "overall_status": "healthy",
    "servers": {
      "cube": { "status": "healthy", "cpu_percent": 7 },
      "clifford": { "status": "healthy", "cpu_percent": 12 }
    }
  },
  "activity": {
    "commits_last_hour": 2,
    "commits_last_24h": 5,
    "recent_commits": [
      {"repo": "drose_io", "timestamp": "2025-12-29T16:24:38Z"}
    ]
  },
  "history": {
    "last_thought": "recovery low... *worried*",
    "last_mood": "tired"
  }
}
```

### Response Format

```json
{
  "mood": "worried",
  "thought": "recovery 36%... need rest? *concerned sniff*",
  "behavior_hints": {
    "animation_preference": "sit",
    "glow_intensity": 0.6,
    "wander_frequency": "low"
  }
}
```

### Example Scenarios

| Context | Thought |
|---------|---------|
| Recovery 36%, commits=2 | "you're coding but recovery 36%... *anxious*" |
| Recovery 85%, at beach | "good rest! and at the beach? *wag wag*" |
| clifford CPU 95% | "clifford struggling... 95% cpu! *alert*" |
| 2am, battery 15% | "late night... your battery low too *yawn*" |

---

## 3. Cost & Rate Considerations

### Model: GPT-5-nano

Cheapest option, sufficient for short personality-driven responses.

### Call Frequency

- **Base interval**: Every 10 minutes
- **Adaptive**: 5 min during activity, 15 min at night
- **Daily calls**: ~144 (24h * 6/hour avg)
- **Monthly calls**: ~4,320

### Caching Strategy

1. **Response TTL**: 60s (all visitors get same response)
2. **Context similarity**: Skip LLM if nothing changed significantly
3. **Rate limits**: Max 12 calls/hour, 200 calls/day

---

## 4. Data Integration

### Life Hub APIs (Ready)

| Endpoint | Data |
|----------|------|
| `/api/whoop/latest` | recovery, HRV, sleep, strain |
| `/query/location?latest=true` | lat/lon, city, battery, speed |
| `/api/status` | server health (cube, clifford, zerg, slim) |

### GitHub Activity (New)

```typescript
async function getRecentGitHubActivity() {
  const response = await fetch(
    'https://api.github.com/users/cipher982/events/public'
  );
  const events = await response.json();
  return events
    .filter(e => e.type === 'PushEvent')
    .slice(0, 10);
}
```

Rate limit: 60 req/hour (unauthenticated). Our 6 calls/hour is safe.

---

## 5. Behavior Expansion

### LLM-Influenced States

| State | Trigger | Effect |
|-------|---------|--------|
| worried | Low recovery + working | Paces more, dim glow |
| excited | High recovery + activity | Fast wander, bright glow |
| alert | Server issues | Stays in alert animation |
| content | Good metrics, no activity | Slow wander, lie down |

### Behavior Hints Implementation

```javascript
function applyBehaviorHints(hints) {
  if (hints.animation_preference && state.currentState === 'idle') {
    setState(hints.animation_preference);
  }

  if (hints.glow_intensity !== undefined) {
    container.style.setProperty('--glow-intensity', hints.glow_intensity);
  }

  if (hints.wander_frequency === 'low') {
    CONFIG.wanderIntervalMin = 15000;
    CONFIG.wanderIntervalMax = 30000;
  }
}
```

---

## 6. Implementation Phases

### Phase 1: Basic LLM Integration (MVP)
**Time:** 4-6 hours

1. Add OpenAI SDK: `bun add openai`
2. Update `server/api/creature.ts`:
   - Background task with `setInterval`
   - `buildPepperContext()` aggregates Life Hub data
   - GPT-5-nano call with personality prompt
   - Cache response 60s
3. Add env var: `OPENAI_API_KEY`
4. Update client to display LLM thought

### Phase 2: Rich Context & Behavior
**Time:** 4-6 hours

1. Add GitHub activity fetching
2. Implement reverse geocoding (city names)
3. Add behavior hints to prompt/response
4. Implement `applyBehaviorHints()` in client
5. Add glow intensity CSS variable

### Phase 3: Memory & Personality
**Time:** 2-4 hours

1. localStorage for visitor memory
2. Add visitor context to LLM prompt
3. Track interaction patterns
4. Returning visitor recognition

### Phase 4: Advanced (Future)

- WebSocket real-time updates
- Voice synthesis
- Accessories (hard hat, backpack)
- Blog post awareness
- Visitor chat

---

## 7. Implementation Sketch

### Server (`server/api/creature.ts`)

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const PERSONALITY_PROMPT = `You are Pepper, a maltipom sprite...`;

let cachedResponse = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 1000;
let lastLLMCall = 0;
const LLM_INTERVAL = 10 * 60 * 1000;

async function callPepperLLM(context) {
  const response = await openai.chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      { role: 'system', content: PERSONALITY_PROMPT },
      { role: 'user', content: `Context:\n${JSON.stringify(context)}\n\nRespond as JSON: {mood, thought, behavior_hints}` }
    ],
    temperature: 0.8,
    max_tokens: 150
  });

  return JSON.parse(response.choices[0].message.content);
}

async function updatePepperState() {
  if (Date.now() - lastLLMCall < LLM_INTERVAL) return;

  try {
    const context = await buildPepperContext();
    const llmResponse = await callPepperLLM(context);

    cachedResponse = {
      energy: context.health.recovery_score,
      mood: llmResponse.mood,
      thought: llmResponse.thought,
      behavior_hints: llmResponse.behavior_hints,
      // ... rest of state
    };

    cacheTime = Date.now();
    lastLLMCall = Date.now();
  } catch (error) {
    console.error('[Pepper LLM] Error:', error);
  }
}

setInterval(updatePepperState, 60 * 1000);
updatePepperState();

export async function getCreatureState(c) {
  if (cachedResponse && Date.now() - cacheTime < CACHE_TTL) {
    return c.json(cachedResponse);
  }
  return c.json({ /* fallback */ });
}
```

### Client (`creature.js` additions)

```javascript
async function fetchCreatureState() {
  const data = await fetch('/api/creature/state').then(r => r.json());

  // Display LLM thought
  if (data.thought && data.thought !== state.lastThought) {
    showThought(data.thought);
    state.lastThought = data.thought;
  }

  // Apply behavior hints
  if (data.behavior_hints) {
    applyBehaviorHints(data.behavior_hints);
  }
}
```

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| API failures | Fallback to last response, circuit breaker |
| Cost overruns | Hard rate limit (200/day), alerts if >$1/day |
| Poor responses | Output validation, temperature tuning |
| Privacy | No visitor IP tracking, aggregate metrics only |

---

## 9. Success Metrics

- **Relevance**: Thoughts mention specific data 80%+ of time
- **Cost**: <$5/month
- **Uptime**: 99%+ successful calls
- **Latency**: <1s response
- **Engagement**: Increased clicks on Pepper

---

## Recommendation

**Start with Phase 1.** Get basic LLM thoughts working, validate the concept, then iterate. Low risk, low cost, immediate personality improvement.
