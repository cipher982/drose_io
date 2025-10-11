Main portfolio site at drose.io - landing page with links to projects (aitools, floodmap, collector, agent-zoom). Bun + Hono backend, static frontend.

- Deployed to clifford VPS via Coolify
- Sitemaps: flattened index at /sitemap.xml (avoids nested indexing error)
- HEAD request middleware in server/index.ts fixes Hono serveStatic bug for .xml files
