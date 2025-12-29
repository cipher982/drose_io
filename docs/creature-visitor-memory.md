# Creature System - Visitor Memory (Phase 2)

## Overview
Server-side visitor tracking system that persists interaction data to JSON files, enabling personalized greetings and behavior across visits.

## Architecture

### Data Storage
- **Location**: `data/visitors/{vid}.json`
- **Format**: JSON with atomic writes
- **Persistence**: Docker volume mount (`data/` → persisted across deployments)

### API Endpoints

#### POST `/api/creature/visit`
Records a visit and updates visitor data.

**Request:**
```json
{
  "vid": "uuid-v4-format",
  "referrer": "https://linkedin.com",
  "page": "/blog",
  "timeOnPage": 45,
  "interactions": {
    "clicks": 5,
    "fled": 2
  }
}
```

**Response:**
```json
{
  "visits": 2,
  "firstSeen": "2025-12-29T18:29:03.389Z",
  "returning": true
}
```

**Security:**
- VID sanitization (alphanumeric + hyphens only)
- Minimum length validation (10 chars)
- Path traversal prevention

#### GET `/api/creature/visitor/:vid`
Retrieve visitor data (debugging/admin only).

**Response:**
```json
{
  "vid": "test-visitor-12345",
  "firstSeen": "2025-12-29T18:29:03.389Z",
  "lastVisit": "2025-12-29T18:29:17.582Z",
  "visits": 2,
  "totalTimeOnSite": 45,
  "referrers": ["https://linkedin.com"],
  "interactions": {
    "clicks": 5,
    "fled": 2
  },
  "pagesVisited": ["/", "/blog"]
}
```

### Client Integration

The creature.js client calls the API:
1. **On page load**: Records visit with referrer and page
2. **On page unload**: Sends final interaction counts via `sendBeacon`

```javascript
// Fire on load (async, non-blocking)
recordVisit();

// Fire on unload (sendBeacon for reliability)
window.addEventListener('beforeunload', () => {
  navigator.sendBeacon('/api/creature/visit', JSON.stringify({
    vid: getVisitorId(),
    page: window.location.pathname,
    timeOnPage: Math.floor(performance.now() / 1000),
    interactions: state.interactions,
  }));
});
```

## Docker Configuration

### Dockerfile
```dockerfile
# Create data directories for persistence
RUN mkdir -p /app/data/visitors
```

### docker-compose.yml
```yaml
volumes:
  - threads-data:/app/data  # Persists both threads/ and visitors/
```

## Files Modified

### Created
- `server/lib/visitor-memory.ts` - Core memory management
- `server/api/creature-visit.ts` - HTTP API
- `docs/creature-visitor-memory.md` - This file

### Modified
- `server/index.ts` - Route registration
- `public/assets/js/creature.js` - Client-side tracking
- `Dockerfile` - Directory creation

## Testing

```bash
# Test first visit
curl -X POST http://localhost:3001/api/creature/visit \
  -H "Content-Type: application/json" \
  -d '{
    "vid": "test-visitor-12345",
    "referrer": "https://linkedin.com",
    "page": "/",
    "interactions": {"clicks": 3, "fled": 1}
  }'

# Test returning visitor
curl -X POST http://localhost:3001/api/creature/visit \
  -H "Content-Type: application/json" \
  -d '{
    "vid": "test-visitor-12345",
    "page": "/blog",
    "timeOnPage": 45,
    "interactions": {"clicks": 5, "fled": 2}
  }'

# Get visitor data
curl http://localhost:3001/api/creature/visitor/test-visitor-12345
```

## Phase 3: LLM Integration (Done)

**Implemented Dec 2025** - See [pepper-v2-implementation-report.md](./pepper-v2-implementation-report.md)

Visitor memory now powers LLM-generated thoughts:
1. ~~**Personalized greetings** based on visit history~~ → LLM uses visit count
2. ~~**Memory-based thoughts** (references to past visits)~~ → LLM sees referrers, pages
3. **Loyalty states** (visitor becomes more friendly over time) → Future
4. **Page-specific behavior** (remembers which pages visitor likes) → Future
5. **Admin dashboard** to view visitor stats → Future

### Current Implementation
```typescript
// server/lib/pepper-prompt.ts
if (visitor.visits > 1) {
  lines.push(`Returning visitor, visit #${visitor.visits}`);
} else {
  lines.push('New visitor');
}
```

LLM generates contextual thoughts like:
- "you're back! visit #3 *wag*"
- "from linkedin again? *curious sniff*"

## Deployment

1. **Build**: `bun run build` (runs Umami injection, creates directories)
2. **Deploy**: Git push triggers Coolify auto-deploy
3. **Persistence**: Data survives container restarts via volume mount

## Notes

- **Privacy**: No PII collected, visitor IDs are client-generated UUIDs
- **Performance**: Fire-and-forget API calls, doesn't block page load
- **Reliability**: sendBeacon ensures data sent even on fast page exits
- **Atomic writes**: Temp file + rename prevents corruption on concurrent writes
