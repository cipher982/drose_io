# drose.io

Personal portfolio, writing site, and a direct-message inbox. Visitors can send
messages that land on my phone; I reply from a mobile admin page.

Live at [drose.io](https://drose.io).

## Quick start

```bash
bun install
make dev        # http://localhost:3000
make test       # unit tests, no server required
```

There is no build step. Bun runs the TypeScript directly.

## Deploy

```bash
make deploy     # deploy to clifford, then verify
make smoke      # verify only
```

`make deploy` syncs the working tree to `clifford` via `manual-app`, rebuilds
the container, and then runs `scripts/smoke.ts` against production. Smoke
compares a fingerprint of the local `server/`, `templates/`, `public/`, and
`content/` trees against `/api/version`, so a deploy that silently no-ops fails
the check instead of looking successful. It also fetches every blog asset and
compares bytes, and checks that the HN archive index, every brief, RSS feed,
and sitemap match this checkout.

Ordinary site changes still deploy with `make deploy`. HN brief commits under
`content/digests/hn/` trigger `.github/workflows/deploy-hn-archive.yml`, which
deploys the exact current `main` commit and runs the same production smoke test
in GitHub Actions. The HN publisher is not granted host or Docker access.

## Architecture

- **Runtime:** Bun + Hono
- **Public pages:** `templates/index.html` and `templates/admin.html`, rendered
  at boot (analytics injection, latest-posts list, asset content hashes). Other
  static files are served from `public/`.
- **Blog:** server-rendered from `content/blog/`. Not Markdown — each post is a
  directory with `meta.json` and an `index.html` fragment.
- **Storage:** append-only JSONL under `data/`. No database.
- **Real-time:** Server-Sent Events for live replies.
- **Notifications:** ntfy, with optional Twilio SMS.

```
server/
  index.ts              entry point, routes, cache headers
  render/               boot-time page rendering, asset hashing
  fingerprint.ts        deployment identity
  blog/                 loader, layout, RSS, sitemap, assets
  api/                  threads, SSE, push, analytics, creature
  storage/              JSONL persistence
templates/              index.html, admin.html (rendered, not served raw)
public/                 CSS, JS, images, static XML
content/blog/<slug>/    meta.json + index.html + assets/
scripts/
  smoke.ts              post-deploy verification
  figures/              generators for blog figures containing numbers
```

## Writing

A post is `content/blog/<slug>/meta.json` plus an `index.html` fragment.
`status` is `published` or `draft`; drafts 404 and drop out of `/blog`, RSS, and
the sitemap, but remain readable at `?preview=1`. The blog index, feeds,
sitemap, and homepage list are all derived from `meta.json`.

There is no admin CRUD UI for posts. Posts are edited as files.

See `AGENTS.md` for the full content model, date conventions, and the figure
and citation rules.

## API

Public:

- `POST /api/feedback` — send a ping or message
- `GET /api/threads/:visitorId/messages` — history
- `GET /api/threads/:visitorId/stream` — live updates (SSE)
- `GET /api/health` — liveness
- `GET /api/version` — deployment fingerprint

Admin (Bearer auth):

- `GET /api/admin/threads`, `POST /api/admin/threads/:visitorId/reply`,
  `POST /api/admin/threads/:visitorId/read`,
  `DELETE /api/admin/threads/:visitorId`
- `GET /api/admin/stream`, `GET /api/admin/inbox/health`
- `GET /api/admin/analytics/{summary,insights,deep}`

## Configuration

- `ADMIN_PASSWORD` — admin access
- `NTFY_SERVER`, `NTFY_TOPIC` — push notifications
- `UMAMI_ENABLED`, `UMAMI_WEBSITE_ID`, `UMAMI_DOMAINS` — analytics. Injection
  happens at render time, so these must be present in the running container,
  not at image build.
- `TWILIO_*` — optional SMS fallback

## License

MIT
