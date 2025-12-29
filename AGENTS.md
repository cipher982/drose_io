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

## Creature System (Pepper)

An ambient AI pet that wanders the page, reacts to mouse movements, and reflects real-world state.

### Files
| File | Purpose |
|------|---------|
| `public/assets/js/creature.js` | Main logic: state machine, sprite animation, mouse tracking |
| `public/assets/css/creature.css` | Styles and CSS animations for each state |
| `public/assets/images/pepper_spritesheet_v2.png` | Current sprite sheet (400xNpx, 7 animations) |
| `public/assets/images/pepper_spritesheet_v2.json` | Sprite metadata |
| `scripts/process_sprites.py` | Sprite extraction from AI-generated sheets |
| `server/api/creature.ts` | `/api/creature/state` endpoint (stub, ready for Life Hub) |
| `docs/sprite-processing.md` | **Full sprite processing guide** |
| `docs/creature-spec.md` | Creature behavior specification |

### States
- **idle**: Standing, gentle bob animation
- **wander**: Walking to random positions (5-15s intervals)
- **flee**: Running away when mouse is close (<120px)
- **curious**: Alert pose when mouse is nearby (120-300px)
- **sleep**: Lying down (triggered by low energy + night)
- **happy**: Face animation with bounce (on click)

### Data Integration (Future)
The `/api/creature/state` endpoint is stubbed. To enable real data:
1. Uncomment Life Hub API calls in `server/api/creature.ts`
2. Creature will reflect Whoop recovery, server health, location, git activity

### Updating Sprites

**See `docs/sprite-processing.md` for full guide.**

Quick workflow for new AI-generated sprite sheets:
```bash
# 1. Copy new sheet and run processor
cp ~/Downloads/new_sprites.png public/assets/images/pepper_spritesheet_v2_raw.png
uv run --with pillow python scripts/process_sprites.py

# 2. Update creature.js with printed config, bump ?v=N

# 3. Hard refresh to test
```

Common issues:
- **Magenta outline**: Widen HSV hue range in script
- **Size jumping between animations**: Adjust `ANIMATION_SCALE` in script
- **Wrong cells**: Update `ANIMATION_MAP` coordinates

## Local Development

```bash
bun run dev  # Starts server with Umami injection
```
