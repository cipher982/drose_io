# drose.io - Magical Inbox Feedback System

A real-time feedback widget with persistent per-device messaging. Visitors can send you messages, and you can reply - conversations persist across sessions with instant updates via Server-Sent Events.

## Features

### For Visitors
- 👋 **One-click interaction** - "I'm a real person" button to prove humanity
- 💬 **Persistent conversations** - Messages persist across browser sessions
- 🔴 **Live notifications** - See when David replies (Win98-styled notification)
- ⚡ **Instant updates** - Server-Sent Events for real-time message delivery
- 🔒 **Privacy-friendly** - Device ID via localStorage + cookie (no tracking)
- 📱 **Mobile-optimized** - Works great on phones

### For Admin (You)
- 📬 **Push notifications** - Get ntfy alerts on your phone instantly
- 💻 **Mobile admin UI** - Reply from your phone at `/admin.html`
- 🔐 **Password-protected** - Simple Bearer auth for admin endpoints
- 📊 **Thread management** - See all conversations, message counts, page context
- ⚡ **Live updates** - SSE keeps admin UI in sync
- 🎨 **Win98 aesthetic** - Matches your site's retro vibe

## Quick Start

### Development
```bash
make install    # Install dependencies
make dev        # Start local server at http://localhost:3000
```

### Testing
```bash
make test       # Quick API tests
make test-full  # Full integration test
bun test/conversation-loop.ts  # Simulate back-and-forth messages
```

### Deployment
```bash
make deploy     # Deploy to clifford
```

## Architecture

### Tech Stack
- **Runtime:** Bun (3x faster than Node)
- **Framework:** Hono (12KB, blazing fast)
- **Storage:** JSONL append-only files (simple, debuggable)
- **Real-time:** Server-Sent Events (instant updates)
- **Notifications:** ntfy.sh (push to phone)

### Data Flow

```
Visitor sends message
  ↓ (POST /api/feedback)
Server stores in JSONL
  ├→ Broadcasts via SSE to visitor's open tabs
  └→ Sends ntfy push to your phone

You reply from admin UI
  ↓ (POST /api/admin/threads/{id}/reply)
Server stores reply
  └→ Broadcasts via SSE to visitor's open tabs
    → Visitor sees it instantly (or badge if tab closed)
```

### File Structure

```
drose_io/
├── server/
│   ├── index.ts                  # Main server
│   ├── feedback.ts               # Feedback handler
│   ├── api/
│   │   ├── threads.ts            # Thread management API
│   │   └── sse.ts                # SSE endpoints
│   ├── storage/
│   │   └── threads.ts            # JSONL storage layer
│   ├── sse/
│   │   └── connection-manager.ts # SSE connection tracking
│   └── notifications/
│       ├── notifier.ts           # Abstract interface
│       ├── ntfy.ts               # ntfy.sh integration
│       └── twilio.ts             # Twilio SMS (optional)
├── public/
│   ├── index.html                # Main site
│   ├── admin.html                # Admin UI
│   └── assets/js/
│       ├── scripts.js            # Site animations
│       └── feedback-widget-v2.js # Feedback widget with SSE
├── data/
│   ├── threads/                  # JSONL conversation files
│   └── blocked/                  # Blocked visitor IDs
├── test/
│   ├── run-tests.ts              # Quick API tests
│   ├── integration-test.ts       # Full flow test
│   └── conversation-loop.ts      # Stress test simulator
├── Makefile                      # Task runner
└── docker-compose.yml            # Production deployment
```

## API Endpoints

### Public Endpoints
- `POST /api/feedback` - Send feedback (ping or message)
- `GET /api/threads/:visitorId/messages` - Get conversation history
- `GET /api/threads/:visitorId/stream` - SSE stream for live updates
- `GET /api/threads/:visitorId/check` - Poll for new messages (fallback)

### Admin Endpoints (requires Bearer auth)
- `POST /api/admin/threads/:visitorId/reply` - Reply to visitor
- `GET /api/admin/threads` - List all conversations
- `GET /api/admin/stream` - SSE stream for admin live updates

### Utility
- `GET /api/health` - Health check + connection stats

## Configuration

### Environment Variables

```bash
# ntfy (push notifications to your phone)
NTFY_SERVER=https://ntfy.sh
NTFY_TOPIC=drose-io-feedback

# Admin access
ADMIN_PASSWORD=your_secure_password_here

# Optional: Twilio (SMS)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_MESSAGING_SID=...
TWILIO_TO_PHONE=+1234567890

# Server
PORT=3000
```

## Admin Usage

### Web UI (Recommended)
1. Visit: `http://5.161.97.53:8080/admin.html`
2. Login with `ADMIN_PASSWORD`
3. See all conversations
4. Click a thread → reply inline
5. Live updates via SSE

### CLI (Quick Replies)
```bash
# Reply to a visitor
curl -X POST http://5.161.97.53:8080/api/admin/threads/{visitorId}/reply \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${ADMIN_PASSWORD}" \
  -d '{"text":"Your reply here"}'

# List all threads
curl http://5.161.97.53:8080/api/admin/threads \
  -H "Authorization: Bearer ${ADMIN_PASSWORD}" | jq

# View a conversation
curl http://5.161.97.53:8080/api/threads/{visitorId}/messages | jq
```

### Notification Flow
1. Visitor sends message → ntfy notification on your phone
2. Tap notification → Opens admin UI
3. Reply → Visitor gets it instantly (SSE or notification box)

## Storage

### Thread Files
- Location: `data/threads/{visitorId}.jsonl`
- Format: One JSON object per line
- Backup: Just copy the directory

```bash
# View a thread
cat data/threads/{visitorId}.jsonl | jq

# Backup threads
tar -czf threads-backup.tar.gz data/threads/

# Find threads by content
grep -r "search term" data/threads/
```

### Blocking Visitors
```bash
# Block a visitor
touch data/blocked/{visitorId}

# API will return 403 Forbidden for blocked visitors
```

## Testing

### Automated Test Suite
```bash
# Quick tests (4 tests, ~2 seconds)
make test

# Full integration test (8 tests, ~5 seconds)
make test-full

# Stress test (configurable iterations)
ITERATIONS=10 DELAY_MS=500 bun test/conversation-loop.ts
```

### Manual Testing
1. Open site: http://5.161.97.53:8080
2. Click feedback button
3. Send a message
4. Open admin: http://5.161.97.53:8080/admin.html
5. Reply to the message
6. Check visitor's browser - should see reply instantly

## Performance

- **Latency:** <100ms for message delivery (SSE push)
- **Storage:** ~200 bytes per message (JSONL)
- **Connections:** Handles 100s of concurrent SSE streams
- **Throughput:** Rate limited to 10 requests/hour per IP

## Security

- Admin password in environment variable
- Rate limiting on feedback endpoint
- Visitor blocking via filesystem
- No PII collected (optional device ID only)
- CORS enabled for API endpoints

## Roadmap

- [x] Move to Coolify for proper deployment
- [x] Add SSL certificate via Let's Encrypt
- [x] Point drose.io DNS to clifford
- [ ] Enable Twilio when toll-free verification completes
- [ ] Add advanced fingerprinting (optional)
- [ ] Add email notification option
- [ ] Create CLI tool for managing threads

## License

MIT
