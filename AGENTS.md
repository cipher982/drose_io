# drose.io

Personal portfolio, public writing site, and Pepper, the visitor agent. One
developer, agent-assisted. Not a service anyone pays for: downtime is cheap,
wrong content is expensive.

## Common tasks

```bash
make dev          # run locally on :3000
make test         # unit tests, no server needed
make deploy       # deploy to clifford, then verify it
make smoke        # verify prod matches this checkout
```

**Publish a post.** Create `content/blog/<slug>/` with an `index.html` fragment
and a `meta.json`:

```json
{
  "title": "Post Title",
  "slug": "<must equal the directory name>",
  "summary": "One or two sentences, shown on /blog and in RSS.",
  "publishedAt": "2026-07-24T12:00:00.000Z",
  "tags": ["llm", "infra"],
  "status": "published",
  "heroImage": "/blog/<slug>/assets/figures/hero.png"
}
```

Required: `title`, `slug`, `summary`, `publishedAt`, `status`. Optional:
`updatedAt`, `tags`, `heroImage`. Validated in `server/blog/loader.ts` — a bad
`meta.json` throws at load with the reason. Nothing else needs editing: the
index, RSS, sitemap, and homepage list all derive from it.

**Unpublish.** Set `"status": "draft"`. See Publishing states below.

**Add images to a post.** Drop them in `content/blog/<slug>/assets/`, then
`make optimize-images` (idempotent; generates `.webp` siblings).

**Recurring or automated content** goes in its own collection, not
`content/blog/`. `content/digests/` + `server/digests/hn.ts` is the worked
example, served at `/digests/hn` with its own feed and sitemap.

## Stack

- Runtime: Bun + Hono, TypeScript run directly (no build step, no bundler, no
  `tsconfig.json`).
- Public pages: templates in `templates/` rendered at boot; other static files
  served from `public/`.
- Blog: SSR from `content/blog/`.
- Storage: JSONL under `data/` (Pepper's conversations). No database.
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

**Deploy syncs the working tree, not a git ref.** manual-app rsyncs the local
directory, so uncommitted changes go live and a push is not required. Commit
first if you want prod and `main` to agree.

`make deploy` runs manual-app and then `scripts/smoke.ts`, which checks that
production is serving **this** checkout:

- `/api/version` fingerprint matches a hash of the local `server/`,
  `templates/`, `public/`, `content/`, `scripts/`, `package.json` and
  `bun.lock`. Keep `TRACKED_DIRS` in `server/fingerprint.ts` in sync with what
  the Dockerfile copies, or a stale deploy can pass.
- `/blog` lists exactly the locally published slugs
- every published post is 200, every draft is 404, every draft preview is 200
- every post asset matches local bytes, fetched with a cache-busting param

That last check exists because `assets/demos/data/*.json` 404'd in production
for months while correct in git, and `/api/health` reported ok the whole time.

**When smoke fails.** A fingerprint mismatch means prod is not running this
code — usually the deploy failed partway, so read the manual-app output rather
than re-running. An asset mismatch with a matching fingerprint means the file
reached the container but is not being served, which points at the route or at
Cloudflare. Everything green except one post usually means bad `meta.json`.

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
- Local env comes from `.env` (see `.env.example`). Analytics, Pepper's
  channels and the admin password are all optional locally; each piece
  switches off when its variables are unset.
- `CLAUDE.md` is a symlink to this file. Edit `AGENTS.md`.

## Where to look next

- `README.md` — API endpoints, directory tree, configuration.
- `Makefile` — every supported command. If it is not there, it is not a
  supported workflow.
- `scripts/smoke.ts` — the executable definition of "working in production".
- Figure generators under `scripts/figures/` run via `uv` (Python), not Bun.

## Important files

- `server/index.ts` — routes, cache headers, health, version.
- `server/render/pages.ts` — renders `templates/*.html` at boot.
- `server/render/assets.ts` — `?v=` content hashes for CSS/JS.
- `server/fingerprint.ts` — deployment identity, shared by server and smoke.
- `scripts/smoke.ts` — post-deploy verification.
- `server/blog/*` — blog loading, layout, RSS, assets.
- `server/pepper/` — Pepper, the visitor agent (see "Pepper" below).
- `public/assets/js/pepper.js` + `public/assets/css/pepper.css` — Pepper on the
  page: his home in the corner, the sprite that lives in it, and the chat.

## Style

- Zerg Glass theme: dark void backgrounds, glass panels, restrained neon
  accents. Use `tokens.css` variables.
- Prose: plain and direct. No marketing cadence, no rhetorical flourish, no
  "not X, but Y" constructions. State what happened.

## Pepper

Pepper (a boy, he/him; a maltipom) is the homepage dog and David's front desk.
Visitors chat with him; he answers from public site content only, never speaks
for David, and carries messages to David when asked. David answers from
Telegram. There is no admin page.

```
 web chat (/api/pepper/chat)  ─┐                              ┌─► live page (SSE /api/pepper/stream)
 email  pepper@agents.drose.io ─┼─► data/pepper/conversations ─┼─► email (SES)
 telegram (visitor or desk)   ─┘     one file per visitor      └─► telegram (visitor chat, David's desk)
                                           deliver.ts decides where each message goes
```

`server/pepper/`, one file per job:

- `conversation.ts` — the only store. `data/pepper/conversations/<visitorId>.jsonl`
  (messages plus relay/contact/telegram-linked events) and
  `data/pepper/visitors.json` (token, email, Telegram chat, desk topic). One
  token per visitor is the `/m/<token>` link, the Telegram `start=` payload,
  and the reply address `pepper+<token>@agents.drose.io`. David's inbox is
  computed: a visitor waits on David when a relay is newer than his last reply.
- `pepper.ts` — prompt, site knowledge, the OpenAI call (`gpt-5.2`, override
  with `PEPPER_MODEL`). Costs money per turn; limits are in `web.ts`.
- `deliver.ts` — the only place that knows the channels: relay to David,
  record contact, deliver David's reply everywhere the visitor can be reached.
- `web.ts` — every HTTP route. `email.ts` and `telegram.ts` — one channel each,
  in and out.

Channels:

- **Email** is AWS SES both ways on `agents.drose.io` (its own MX record;
  drose.io's MX stays with Google). Inbound: SES receipt rule → SNS →
  `POST /api/pepper/email/<PEPPER_WEBHOOK_SECRET>`.
- **Telegram**: the bot's webhook is `POST /api/pepper/telegram`, registered at
  boot from `PUBLIC_BASE_URL`. David's private group "Pepper's Desk" has one
  topic per visitor; replying in a topic answers that visitor.
- **Sauron** watches `GET /api/admin/inbox/health` (stale unread relays) and
  `/api/pepper/history` (store readable). Keep both shapes.

Env (Infisical `ops-infra/prod`): `OPENAI_API_KEY`, `PEPPER_SES_ACCESS_KEY_ID`,
`PEPPER_SES_SECRET_ACCESS_KEY`, `PEPPER_WEBHOOK_SECRET`, `PEPPER_SNS_TOPIC_ARN`,
`PEPPER_TELEGRAM_BOT_TOKEN`, `PEPPER_TELEGRAM_BOT_USERNAME`,
`PEPPER_TELEGRAM_DESK_CHAT_ID`, `PEPPER_TELEGRAM_DAVID_USER_ID`,
`PUBLIC_BASE_URL`; optional `PEPPER_MODEL`, `PEPPER_MAIL_FROM`.

`data/` is a bind mount on clifford, not in the image, and excluded from
deploys. It holds real visitor conversations: never "clean it up".
`scripts/migrate-threads-to-pepper.ts` converted the old `data/threads` inbox.

## Misc subsystems

Rarely edited, so kept brief. Read the files before changing any of them.

**Pepper's home.** `public/assets/js/pepper.js` is one component: a glass
habitat fixed bottom-right where the sprite lives (wanders a little, sits, naps,
watches the cursor, runs off with a relayed note and back with David's letter),
and the chat panel that grows out of it. The whole habitat is the button. Under
`prefers-reduced-motion` he sits still. What he says is written by the model from live signals, never canned:
- `POST /api/pepper/hello` (`server/pepper/hello.ts`): the arrival thought. It
  gets the visitor's setup, local time, referrer, what they read before, what
  Pepper already said to them and to everyone lately, the site pulse, his mood,
  and two random angles. It also remembers the visit in `data/visitors/`;
  thoughts are logged to `data/pepper-logs/`.
- `GET /api/pepper/day` (`server/pepper/day.ts`): his mood and status lines per
  activity, one model call every 20 minutes shared by all visitors. A status
  only ever describes what the sprite is doing in that activity.
- `GET /api/pepper/fleet` (`server/pepper/fleet.ts`): David's agents right now
  from Longhouse, filtered to PUBLIC cipher982 repos (GitHub API list); private
  repos and all Zeta work never leave the module. Counts, repo names, providers
  and timings only, never titles or text. Polls at most once a minute and only
  while someone is looking. Needs `PEPPER_LONGHOUSE_TOKEN`.
- Fixed strings are limited to system states (delivery, contact card, errors).

**Pepper's dog house.** `server/pepper/world.ts` is his long-running project: a
dog house built over days from items and design ideas visitors give him (in chat,
or the "help him" palette in the panel). It is an append-only log in
`data/pepper/world/log.jsonl`; the world is a replay of it. Only a closed
catalog of items, colors and roof styles is accepted, so no visitor text is ever
shown to anyone else. A builder tick in the server works a step every 20-60
minutes, and when nobody has brought anything for a day he forages what he needs.
`public/assets/js/pepper.js` draws it as pixel art next to him. David controls it
from the General topic of Pepper's Desk: `/world`, `/undo <id>`, `/pause`,
`/resume`, `/give <item> [color]`.

**Analytics.** `/analytics` is a custom dashboard reading the Umami HTTP API
(`server/api/analytics.ts`, admin-gated), with an optional raw collector at
`ANALYTICS_COLLECTOR_URL`. It logs into Umami with admin credentials from env
and caches a token. Umami itself runs as a separate manual-app on clifford.
Treat pageview numbers as lower bounds: the per-path data is top-pages per
interval, so a missing post is not proven to be zero.
