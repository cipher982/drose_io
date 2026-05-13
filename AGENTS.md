# drose.io

Personal portfolio, direct-message inbox, and public writing site.

## Stack

- Runtime: Bun + Hono, TypeScript modules.
- Frontend: static homepage/admin files in `public/`, SSR for public writing routes.
- Storage: JSONL for visitor threads; raw HTML content directories for public posts.
- Deploy: Coolify on `clifford`, auto-deploys from `main`.

## Content Model

The public blog is **not Markdown-backed**.

- Blog posts live in `content/blog/{slug}/meta.json` + `index.html`.
- `server/blog/loader.ts` loads those files; `server/blog/layout.ts` renders `/blog` and `/blog/:slug`.
- Keep `meta.slug` equal to the directory name.
- Use `publishedAt` for the original publication date and `updatedAt` for later revisions.
- Substantial post refreshes should update the rendered dates/schema and sitemap `lastmod`.

For side collections, keep them out of `content/blog` unless they should appear in the main blog index/RSS.

## Important Files

- `server/index.ts` wires routes, caching behavior, static files, and health checks.
- `server/blog/*` handles public blog loading, layout, RSS, and post assets.
- `server/api/threads.ts`, `server/api/sse.ts`, and `server/sse/connection-manager.ts` handle direct messages.
- `scripts/inject-umami.ts` mutates `public/index.html` and `public/admin.html` at build/dev start.
- `public/assets/templates/feedback-widget.html` owns the floating feedback widget markup/styles.
- Pepper lives in `public/assets/js/creature.js`, `public/assets/css/creature.css`, `server/api/creature.ts`, and `public/assets/images/pepper_spritesheet_v2.*`.

## Gotchas

- Cloudflare caches versioned static assets aggressively. When changing CSS/JS/template assets, ensure version params are bumped by the existing build flow or by the touched references.
- Re-read static HTML before editing if a dev server is running; Umami injection can rewrite it.
- `win98-theme.css` is the glass/void theme base despite the old name.
- Do not assume README/admin UI references to blog CRUD are current; verify backend routes before relying on them.
- `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Style

- Follow the existing Zerg Glass theme: dark void backgrounds, glass panels, restrained neon accents.
- Use `tokens.css` variables where practical.
- Keep route/content additions small and crawlable; prefer a separate collection over polluting `/blog` when content is recurring or automated.

## Local Commands

```bash
bun run dev
bun run build
make test
```
