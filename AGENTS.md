# drose.io

Personal portfolio, direct-message inbox, and public writing site. One
developer, agent-assisted. Not a service anyone pays for: downtime is cheap,
wrong content is expensive.

## Stack

- Runtime: Bun + Hono, TypeScript run directly (no build step, no bundler, no
  `tsconfig.json`).
- Public pages: templates in `templates/` rendered at boot; other static files
  served from `public/`.
- Blog: SSR from `content/blog/`.
- Storage: JSONL under `data/` for visitor threads.
- Deploy: `make deploy` (manual-app to `clifford`). Nothing auto-deploys.

## Content model

The blog is **not Markdown-backed**.

- A post is `content/blog/{slug}/meta.json` + `index.html` (a fragment, not a
  full document — the layout supplies `<html>`, head, and chrome).
- Post assets live in `content/blog/{slug}/assets/` and are served at
  `/blog/{slug}/assets/...`.
- `meta.slug` must equal the directory name.
- `server/blog/loader.ts` loads posts; `server/blog/layout.ts` renders them.
- `/blog`, RSS, the sitemap, and the homepage "Latest Writing" list are all
  derived from `meta.json`. Never hand-edit them.

### Publishing states

`meta.json` `status` is `published` or `draft`.

- `draft` → the post 404s and disappears from `/blog`, RSS, and the sitemap.
  Readable at `/blog/{slug}?preview=1`.
- Unpublishing something is a one-word change to `status`. Prefer it over
  deleting a post or leaving a stub page up: a stub returns 200 and gets
  indexed as thin content at a URL you want to reuse.

### Dates

- `publishedAt` — original publication.
- `updatedAt` — later revision. Omit it if there hasn't been one.
- A full rewrite means a **new `publishedAt`, same slug**. Keeping the slug
  preserves inbound links and index entries; the new date is honest about when
  the writing happened.

### Figures and claims

- Any figure containing numbers gets a checked-in generator under
  `scripts/figures/`, with the source cited in its docstring. See
  `li2025-compounding.py`. A chart nobody can regenerate is a chart nobody can
  check, and one such chart shipped with a fabricated 400x error.
- Verify external claims (papers, model names, benchmark numbers) against the
  primary source before publishing. Model names in particular are easy to
  hallucinate.

## Deploy

```bash
make deploy                          # deploy + verify
make smoke                           # verify only
BASE=http://localhost:3000 make smoke # verify a local instance
```

`make deploy` runs manual-app and then `scripts/smoke.ts`, which checks that
production is serving **this** checkout:

- `/api/version` fingerprint matches a hash of the local `server/`,
  `templates/`, `public/`, and `content/` trees
- `/blog` lists exactly the locally published slugs
- every published post is 200, every draft is 404, every draft preview is 200
- every post asset matches local bytes, fetched with a cache-busting param

That last check exists because `assets/demos/data/*.json` 404'd in production
for months while correct in git, and `/api/health` reported ok the whole time.

## Gotchas

- **Anchor ignore and exclude patterns.** An unanchored `data/` in rsync or
  gitignore matches *every* directory named `data` at any depth. That is the
  bug above.
- **Cloudflare keeps serving deleted assets.** A removed file can return 200
  from cache for a while. Purge if it matters.
- The custom analytics dashboard is `/analytics`; `analytics.drose.io` is the
  upstream Umami service and must stay public for embedded scripts.
- `win98-theme.css` is the glass/void theme base despite the name.
- Templates live outside `public/` on purpose. Moving them back would let the
  static middleware serve an unrendered page with raw markers in it.
- Umami is injected between `<!-- UMAMI_START -->` / `<!-- UMAMI_END -->` in
  `templates/index.html` at render time. It renders empty when `UMAMI_ENABLED`
  is unset, which is correct for local dev.
- `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Important files

- `server/index.ts` — routes, cache headers, health, version.
- `server/render/pages.ts` — renders `templates/*.html` at boot.
- `server/render/assets.ts` — `?v=` content hashes for CSS/JS.
- `server/fingerprint.ts` — deployment identity, shared by server and smoke.
- `scripts/smoke.ts` — post-deploy verification.
- `server/blog/*` — blog loading, layout, RSS, assets.
- `server/api/threads.ts`, `server/api/sse.ts`,
  `server/sse/connection-manager.ts` — direct messages.
- Pepper: `public/assets/js/creature.js`, `public/assets/css/creature.css`,
  `server/api/creature.ts`.

## Style

- Zerg Glass theme: dark void backgrounds, glass panels, restrained neon
  accents. Use `tokens.css` variables.
- Prose: plain and direct. No marketing cadence, no rhetorical flourish, no
  "not X, but Y" constructions. State what happened.
