# drose.io Personal Portfolio

Personal portfolio and blog site.

## Stack
- **Backend**: Bun + Hono (TypeScript)
- **Frontend**: Static HTML with build-time injection
- **Server**: clifford (Hetzner VPS)
- **Deployment**: Coolify (auto-deploy on git push)
- **Coolify UUID**: `zgk0skw48ow8ook4kww4wkow`

## Umami Analytics

This repo uses **dual tracking**:
- **Portfolio dashboard** (`33e9b5a0-5fbf-474c-9d60-9bee34d577bd`) - tracks drose.io homepage only
- **Subpath projects** (floodmap, collector, pepper-place) - track to their own dashboards AND the portfolio aggregate

### Implementation Pattern

**Static pages** (`public/index.html`, `public/admin.html`):
- Injected at build time via `scripts/inject-umami.ts`
- Script tag added before server starts (see `package.json`)

**Dynamic blog routes** (`server/routes/blog-public.ts`):
- Uses `buildUmamiScript()` from `server/umami.ts`
- Generates script tag at request time

### Environment Variables

Required in Coolify:
```
UMAMI_WEBSITE_ID=33e9b5a0-5fbf-474c-9d60-9bee34d577bd
UMAMI_SCRIPT_SRC=https://analytics.drose.io/script.js
UMAMI_DOMAINS=drose.io
UMAMI_ENABLED=true
```

## Blog System

Blog posts are served from `server/routes/blog-public.ts`:
- Markdown files processed at runtime
- Umami tracking injected per request
- Routes: `/blog`, `/blog/:slug`

## Deployment

```bash
git push  # Auto-triggers Coolify rebuild on clifford
```

Check deployment:
```bash
ssh clifford "docker ps | grep drose"
curl -s https://drose.io/ | grep "analytics.drose.io"  # Verify Umami loaded
```

## Related Projects

Subpath projects under drose.io domain:
- **floodmap** - https://drose.io/floodmap (repo: ~/git/floodmap)
- **collector** - https://drose.io/collector (repo: ~/git/collector)
- **pepper-place** - https://drose.io/pepper (repo: ~/git/pepper-place)

Each has its own dedicated Umami dashboard + contributes to drose.io aggregate.
