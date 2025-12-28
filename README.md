# drose.io - Personal Portfolio & Feedback System

A real-time personal portfolio with a "Zerg Glass" aesthetic and integrated messaging system. Visitors can send direct messages that land on my phone instantly, and I can reply via a mobile-optimized admin interface.

## 🌌 Zerg Glass Theme
The site uses a modern glassmorphism design system ("Zerg Glass") featuring:
- **Void Backgrounds**: Deep blacks (`#030305`) with layered grid and nebula effects.
- **Glass Morphism**: High-blur backdrops for panels and cards.
- **Neon Accents**: Indigo, cyan, pink, and purple glows.
- **Animated Motion**: Grid pulses, nebula drifts, and dramatic hover transitions.

## Features

### For Visitors
- 👋 **One-click interaction** - "I'm a real person" button to prove humanity.
- 💬 **Direct Messaging** - Send messages that persist across browser sessions.
- 🔴 **Live Replies** - See when I reply in real-time via Server-Sent Events (SSE).
- ✍️ **Engineering Blog** - Read long-form thoughts on AI agents and agentic systems.
- ⚡ **Instant Updates** - No refreshing needed for conversation updates.

### For Admin (You)
- 📬 **Dual Notifications** - Get ntfy push alerts AND optional Twilio SMS.
- 💻 **Mobile Admin UI** - Reply, manage threads, and publish blog posts from `/admin.html`.
- 🔐 **Secure Access** - Simple Bearer authentication for all admin operations.
- 📝 **Blog Management** - Create, edit, and publish Markdown posts with ease.
- 📊 **Real-time Monitoring** - Live connection stats and thread management.

## Quick Start

### Development
```bash
bun install    # Install dependencies
bun run dev    # Start development server with Umami injection
```

### Testing
```bash
make test       # Quick API tests
make test-full  # Full integration test
make test-e2e   # Playwright end-to-end tests
```

### Deployment
Deployment is handled automatically by **Coolify** on `clifford` (prod VPS) upon pushing to the `main` branch.

## Architecture

### Tech Stack
- **Runtime:** Bun (Blazing fast TS execution)
- **Framework:** Hono (Lightweight and fast web framework)
- **Frontend:** Static HTML + CSS Tokens + Build-time script injection
- **Storage:** JSONL append-only files (Simple, transparent, no DB required)
- **Real-time:** Server-Sent Events (Native, efficient live updates)
- **Notifications:** ntfy.sh & Twilio SMS

### File Structure

```
drose_io/
├── server/
│   ├── index.ts                  # Main entry point
│   ├── api/                      # API endpoint handlers
│   │   ├── blog.ts               # Blog management
│   │   ├── threads.ts            # Messaging logic
│   │   └── sse.ts                # Real-time streaming
│   ├── storage/                  # Data persistence layer
│   └── routes/                   # SSR routes (e.g., Blog)
├── public/
│   ├── index.html                # Homepage
│   ├── admin.html                # Admin Dashboard
│   └── assets/
│       ├── css/                  # Zerg Glass design system
│       └── js/                   # Real-time widget logic
├── content/
│   └── blog/                     # Markdown post storage
├── data/
│   ├── threads/                  # Conversation history
│   └── blocked/                  # Visitor blocklist
├── scripts/
│   └── inject-umami.ts           # Build-time analytics injection
└── Makefile                      # Task automation
```

## API Endpoints

### Public
- `POST /api/feedback` - Send initial ping or message.
- `GET /api/threads/:visitorId/messages` - Get history.
- `GET /api/threads/:visitorId/stream` - Live message stream (SSE).
- `GET /blog` - View all published posts.
- `GET /blog/:slug` - Read a specific post.

### Admin (Requires Bearer Auth)
- `GET /api/admin/threads` - List all active conversations.
- `POST /api/admin/threads/:visitorId/reply` - Send reply to visitor.
- `DELETE /api/admin/threads/:visitorId` - Archive/delete thread.
- `GET /api/admin/blog/posts` - List all posts (including drafts).
- `POST /api/admin/blog/posts` - Create new post.
- `PATCH /api/admin/blog/posts/:slug` - Update post content/status.

## Configuration

### Environment Variables
- `ADMIN_PASSWORD`: For admin dashboard access.
- `NTFY_TOPIC`: For mobile push notifications.
- `UMAMI_WEBSITE_ID`: For analytics injection.
- `TWILIO_*`: (Optional) For SMS notification fallbacks.

## License
MIT
