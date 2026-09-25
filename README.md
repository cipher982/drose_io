# drose.io

Personal portfolio, writing site, and Pepper, a dog who runs the front desk.
Visitors chat with Pepper; when they want me, he carries the message to my
Telegram and brings my reply back on the site, by email, or on Telegram.

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
- **Public pages:** `templates/index.html`, rendered
  at boot (analytics injection, latest-posts list, asset content hashes). Other
  static files are served from `public/`.
- **Blog:** server-rendered from `content/blog/`. Not Markdown — each post is a
  directory with `meta.json` and an `index.html` fragment.
- **Pepper:** `server/pepper/`. One JSONL conversation per visitor under
  `data/pepper/`; channels are the web chat (SSE for live replies), email
  (AWS SES on `agents.drose.io`), and Telegram. See `AGENTS.md`.

```
server/
  index.ts              entry point, routes, cache headers
  render/               boot-time page rendering, asset hashing
  fingerprint.ts        deployment identity
  blog/                 loader, layout, RSS, sitemap, assets
  pepper/               Pepper: conversation store, model, channels, routes
  api/                  analytics
templates/              index.html (rendered, not served raw)
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

- `POST /api/pepper/hello` — arrival thought (and visit memory); `GET /api/pepper/day` — his mood and status lines
- `POST /api/pepper/chat`, `GET /api/pepper/history`, `POST /api/pepper/contact`
- `GET /api/pepper/stream` — David's replies, live (SSE)
- `GET /m/:token` — continue a conversation from an email link
- `GET /api/health` — liveness
- `GET /api/version` — deployment fingerprint

Webhooks: `POST /api/pepper/telegram`, `POST /api/pepper/email/:secret` (SNS).

Admin (Bearer auth): `GET /api/admin/inbox/health`,
`GET /api/admin/analytics/{summary,insights,deep}`.

## Configuration

See `.env.example`. Every Pepper channel switches off when its variables are
unset. `UMAMI_ENABLED`, `UMAMI_WEBSITE_ID`, `UMAMI_DOMAINS` drive analytics
injection at render time, so they must be present in the running container,
not at image build.

## License

MIT
