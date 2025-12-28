# drose.io Personal Portfolio

Personal portfolio and blog site with Zerg glass theme aesthetic.

## Stack
- **Runtime**: Bun + Hono (TypeScript)
- **Frontend**: Static HTML (Homepage/Admin) + SSR (Blog)
- **Storage**: JSONL (Messaging) + Markdown (Blog)
- **Deployment**: Coolify on clifford (auto-deploy on git push)

## Architecture Details

### Blog System
- **Storage**: Markdown files in `content/blog/` with YAML frontmatter.
- **Rendering**: Server-side rendered (SSR) via `server/routes/blog-public.ts` using `marked` and `highlight.js`.
- **Styling**: Injected CSS in `renderPage` combined with global `tokens.css`.
- **Admin**: Full CRUD API in `server/api/blog.ts` with atomic writes to prevent corruption.

### Messaging (Direct Message)
- **Storage**: `data/threads/{visitorId}.jsonl` (one line per message).
- **Real-time**: SSE via `server/api/sse.ts` and `server/sse/connection-manager.ts`.
- **Notifications**: `ntfy` for push, `twilio` for SMS (if configured).

## Critical Gotchas

### Cloudflare Caching
CSS and static assets are aggressively cached. When updating styles or the feedback widget:
1. **Always bump cache-busting params** in `index.html` and `renderPage` (blog): `?v=4` → `?v=5`.
2. Changes won't show until you do this, even after deploy.
3. Verify with: `curl -sI "https://drose.io/assets/css/styles.css?v=X" | grep cf-cache`.

### Umami Injection
The script `scripts/inject-umami.ts` modifies static HTML files (`public/index.html`, `public/admin.html`) at build time. 
- **Dev Conflict**: If editing these files while the dev server runs, the file may be modified mid-edit. Re-read before editing if this happens.
- **SSR Injection**: For the blog, injection happens at request time via `server/umami.ts`.

### Feedback Widget
The floating "Are you human?" button loads from a **separate template**:
- `public/assets/templates/feedback-widget.html`.
- Has its own inline `<style>` block.
- **Easy to forget when restyling** - it won't inherit main CSS changes.

## Design System

### File Architecture
The CSS is split with specific purposes - understand before editing:

| File | Purpose |
|------|---------|
| `tokens.css` | Design tokens (colors, spacing, shadows, motion). |
| `win98-theme.css` | **Misleading name** - this is the glass/void theme base. |
| `styles.css` | Homepage-specific styles (cards, hero, footer). |

### Current Theme: "Zerg Glass"
Despite the filename, this is NOT Windows 98 style. The design uses:
- **Void backgrounds**: Deep blacks (`#030305`) with layered effects.
- **Glass morphism**: `backdrop-filter: blur()` on cards/panels.
- **Neon accents**: Indigo (`#6366f1`), cyan (`#06b6d4`), pink (`#ec4899`), purple (`#a855f7`).
- **Animated backgrounds**: Grid pulse, nebula drift, particle twinkle via `::before`/`::after`.

### Adding New Components
Follow these patterns:
```css
/* Glass panel */
background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%);
backdrop-filter: blur(12px);
border: 1px solid rgba(255,255,255,0.08);

/* Hover glow */
box-shadow: 0 0 20px rgba(99, 102, 241, 0.3);

/* Accent bar (appears on hover) */
.element::before {
  background: linear-gradient(180deg, #06b6d4, #6366f1);
  opacity: 0;
}
.element:hover::before { opacity: 1; }
```

## Local Development

```bash
bun run dev  # Starts server with Umami injection
```
