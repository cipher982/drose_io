## Deployment
- Deployed to clifford VPS via Coolify
- Main portfolio site serving drose.io
- Bun + Hono backend with static frontend

## Sitemaps
- Main sitemap index: `https://drose.io/sitemap.xml`
- Architecture (flattened to avoid nested indexing):
  ```
  sitemap.xml (INDEX)
  ├── portfolio-sitemap.xml (5 main pages: home, aitools, floodmap, collector, agent-zoom)
  ├── aitools/sitemaps/sitemap-static.xml (AI Tools homepage)
  ├── aitools/sitemaps/sitemap-tools.xml (535+ tool pages)
  ├── aitools/sitemaps/sitemap-categories.xml (category pages)
  └── aitools/sitemaps/sitemap-comparisons.xml (comparison pages)
  ```
- Total: 567 pages discovered by Google Search Console
- HEAD request workaround implemented in `server/index.ts` to fix Hono serveStatic bug
- All XML files return proper `Content-Length` headers for Google crawler compatibility

## Key Files
- `public/sitemap.xml` - Main sitemap index (manually maintained)
- `public/portfolio-sitemap.xml` - Portfolio pages sitemap (manually maintained)
- `server/index.ts` - HEAD request middleware for XML files
