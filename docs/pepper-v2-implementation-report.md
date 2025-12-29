# Pepper v2 Implementation Report

**Project:** drose.io Portfolio - Ambient AI Creature System
**Date:** December 29, 2025
**Engineer:** Claude Code + David Rose

---

## Executive Summary

Pepper v2 transforms a simple pixel art mascot into an AI-powered creature that greets visitors personally, remembers returning users, and generates contextual thoughts using GPT-5-nano. The implementation follows a "fast to wow" principle: visitors see Pepper approach and speak within 2 seconds of page load.

**Key Metrics:**
- Time to first interaction: <500ms (instant greeting)
- Time to AI-personalized thought: ~1-2s
- Estimated cost: ~$5/month at typical traffic
- Graceful degradation: Works without API key

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Instant Greeting (0-500ms, client-side)               │
│  • Pepper walks toward cursor on page load                      │
│  • Deterministic greeting from referrer/time/visit count        │
│  • Works offline, no API dependency                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: Visitor Memory (server-side persistence)              │
│  • JSON files in data/visitors/{vid}.json                       │
│  • Tracks visits, referrers, pages, interactions                │
│  • Start/end events prevent double-counting                     │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: LLM Thoughts (800ms+, per-visitor AI)                 │
│  • POST /api/creature/think                                     │
│  • GPT-5-nano with low reasoning effort                         │
│  • Replaces instant greeting when ready                         │
│  • Rate limited: per-vid, per-IP, global daily cap              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Instant Greeting Engine

### Objective
Provide immediate feedback to visitors without waiting for server responses.

### Implementation

**Files Modified:**
- `public/assets/js/creature.js` - Added greeting engine and approach-on-load

**Features:**
1. **Visitor ID** - UUID stored in localStorage with Safari private mode fallback
2. **Visit Counter** - Local count for instant greeting personalization
3. **Greeting Logic** - Priority-based selection:
   - Returning visitors: "hey, you came back! *wag wag*"
   - Referrer-based: LinkedIn, GitHub, Twitter, Google detection
   - Time-based: Late night, early morning greetings
   - Default: "new visitor! *sniff sniff* welcome!"

4. **Approach Behavior** - Pepper starts at right edge, walks to center

**Code Review (Codex):**
- Added try/catch for localStorage (Safari private mode)
- Added UUID fallback for older browsers
- Added NaN guard on visit counter
- Filtered same-origin referrers
- Clamped target position to viewport bounds

### Commit
```
476a812 feat(creature): add instant greeting and approach-on-load behavior
```

---

## Phase 2: Server-Side Visitor Memory

### Objective
Persist visitor data across sessions for personalized AI responses.

### Implementation

**Files Created:**
- `server/lib/visitor-memory.ts` - Load/save visitor JSON files
- `server/api/creature-visit.ts` - HTTP API endpoint

**Files Modified:**
- `server/index.ts` - Route registration
- `public/assets/js/creature.js` - API calls on page load/exit
- `Dockerfile` - Create data directory

**API Endpoint:**
```
POST /api/creature/visit
{
  "vid": "uuid",
  "event": "start" | "end",
  "referrer": "https://linkedin.com",
  "page": "/",
  "timeOnPage": 45,
  "interactions": { "clicks": 3, "fled": 1 }
}
```

**Visitor Schema:**
```typescript
interface VisitorMemory {
  vid: string;
  firstSeen: string;
  lastVisit: string;
  visits: number;
  totalTimeOnSite: number;
  referrers: string[];        // Host only, max 10
  interactions: {
    clicks: number;
    fled: number;
  };
  pagesVisited: string[];     // Max 50
}
```

**Security Measures:**
- VID validation (alphanumeric + hyphens, 10-64 chars)
- Path traversal prevention
- Input length caps (referrer 100, page 200 chars)
- Atomic writes with rename()

**Code Review (Codex):**
- Split start/end events to prevent double-counting visits
- Added timeOnPage validation (finite, positive, max 6h)
- Capped arrays to prevent unbounded growth
- Fixed sendBeacon with Blob for Content-Type header

### Commits
```
10136c3 feat(creature): add server-side visitor memory (Phase 2)
```

---

## Phase 3: LLM-Powered Thoughts

### Objective
Generate personalized, context-aware thoughts using AI.

### Implementation

**Files Created:**
- `server/lib/pepper-prompt.ts` - System prompt and context builder
- `server/api/creature-think.ts` - LLM endpoint with rate limiting

**Files Modified:**
- `server/index.ts` - Route registration
- `public/assets/js/creature.js` - LLM request function, triggers

**API Endpoint:**
```
POST /api/creature/think
{
  "vid": "uuid",
  "trigger": "page_load" | "click" | "idle" | "leaving",
  "context": {
    "currentPage": "/",
    "timeOnPage": 45,
    "hour": 14
  }
}

Response:
{
  "thought": "you came back! *excited wag*",
  "mood": "happy"
}
```

**Triggers:**
| Trigger | When | Example Response |
|---------|------|------------------|
| page_load | 800ms after load | "new friend! *sniff sniff*" |
| click | User clicks Pepper | "you clicked me! *happy spin*" |
| idle | 30s no interaction | "still here? *curious tilt*" |
| leaving | Mouse to top of viewport | "leaving already? *sad ears*" |

**Pepper's Personality (System Prompt):**
- Maltipom (maltese-pomeranian mix)
- Dog-like mannerisms: *wag*, *sniff*, *tilt*, arf!
- Max 50 characters per thought
- Lowercase, casual punctuation
- Moods: happy, curious, tired, excited, sleepy

**Rate Limiting (3-tier):**
1. Per-VID: 10 requests/minute
2. Per-IP: 30 requests/minute (prevents vid rotation)
3. Global: 1000 requests/day (circuit breaker)

**LLM Configuration:**
- Model: `gpt-5-nano`
- Reasoning effort: `low`
- Temperature: 0.7
- Timeout: 10 seconds

**Code Review (Codex):**
- Added IP-based rate limiting
- Added global daily circuit breaker
- Added request timeout with AbortController
- Fixed prompt example (real mood value, not pipes)
- Limited pages in prompt to last 5
- Separated JSON parse errors from internal errors
- Added rate limit map pruning (every 5 min)

### Commits
```
4ec8258 (Phase 3 bundled with sprite updates)
035b33a fix(creature): harden LLM endpoint per Codex review
```

---

## Cost Analysis

**Model:** GPT-5-nano with low reasoning effort

**Per Request:**
- System prompt: ~200 tokens
- User context: ~150 tokens
- Response: ~30 tokens
- **Total:** ~380 tokens

**Estimated Costs:**
| Traffic | Requests/Day | Monthly Cost |
|---------|--------------|--------------|
| Low | 100 | ~$3 |
| Medium | 500 | ~$15 |
| High | 1000 | ~$30 |

**Cost Controls:**
- Global daily limit: 1000 requests
- Client-side cooldown: 10 seconds between requests
- Rate limiting prevents abuse

---

## Security Summary

| Layer | Protection |
|-------|------------|
| Input Validation | VID format, length caps, type checking |
| Path Traversal | Alphanumeric-only VID sanitization |
| Rate Limiting | Per-vid, per-IP, global daily cap |
| API Key | Server-side only, never exposed |
| CORS | Enabled for /api/* (consider restricting) |
| Timeout | 10s AbortController on LLM calls |
| Atomic Writes | rename() for data integrity |

---

## File Inventory

### New Files
| File | Purpose | Lines |
|------|---------|-------|
| `server/lib/visitor-memory.ts` | Visitor JSON storage | 83 |
| `server/lib/pepper-prompt.ts` | LLM prompt engineering | 75 |
| `server/api/creature-visit.ts` | Visit tracking API | 95 |
| `server/api/creature-think.ts` | LLM thoughts API | 200 |

### Modified Files
| File | Changes |
|------|---------|
| `public/assets/js/creature.js` | +250 lines (greeting, LLM, tracking) |
| `server/index.ts` | +4 lines (route registration) |
| `Dockerfile` | +1 line (data directory) |

### Documentation
| File | Purpose |
|------|---------|
| `docs/creature-v2-spec.md` | Original specification |
| `docs/creature-visitor-memory.md` | Phase 2 documentation |
| `docs/pepper-v2-implementation-report.md` | This report |

---

## Deployment Checklist

### Environment Variables
```bash
OPENAI_API_KEY=sk-...  # Required for Phase 3
```

### Docker/Coolify
- [ ] `data/` directory mounted as volume (visitor persistence)
- [ ] `OPENAI_API_KEY` added to Coolify environment
- [ ] Verify volume persists across deploys

### Verification Steps
1. Load page → Pepper approaches from right
2. Check thought bubble appears at 500ms
3. Verify LLM thought replaces it ~1-2s later
4. Click Pepper → New thought generated
5. Check `data/visitors/` for JSON files
6. Test without API key → Falls back to instant greetings

---

## Future Enhancements (Phase 4+)

1. **David's State Integration**
   - Whoop recovery score
   - Recent GitHub commits
   - Server health status
   - Location awareness

2. **Enhanced Triggers**
   - Scroll depth milestones
   - Time on specific pages
   - Return after long absence

3. **Personality Evolution**
   - Friendship levels
   - Remembered conversations
   - Seasonal variations

---

## Conclusion

Pepper v2 successfully transforms a static mascot into an engaging, AI-powered companion. The three-phase approach ensures:

1. **Instant feedback** - No waiting for API responses
2. **Persistent memory** - Returning visitors are recognized
3. **Personalized AI** - Context-aware, genuine interactions

The implementation prioritizes graceful degradation, cost control, and security while delivering the "wow" moment within 2 seconds of page load.

---

*Report generated by Claude Code*
*December 29, 2025*
