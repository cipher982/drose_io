import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { handleFeedback } from './feedback';
import { checkThreadMessages, getThreadMessages, replyToThread, listAllThreads, deleteThreadById, markThreadRead, getInboxHealth } from './api/threads';
import { streamVisitorThread, streamAdminUpdates } from './api/sse';
import { connectionManager } from './sse/connection-manager';
import { subscribeToPush, getVapidPublicKey } from './api/push';
import { blogIndex, blogPost, blogRss, blogAsset, blogSitemap } from './blog/routes';
import { hnDigestIndex, hnDigestPost, hnDigestRss, hnDigestSitemap } from './digests/hn';
import { getCreatureState } from './api/creature';
import creatureVisit from './api/creature-visit';
import creatureThink from './api/creature-think';
import { handleAnalyticsSummary, handleAnalyticsInsights, handleAnalyticsDeep } from './api/analytics';
import { continueThreadGet, continueThreadPost } from './continue/routes';
import { homePage, adminPage } from './render/pages';
import { computeFingerprint, fingerprintFileCount } from './fingerprint';
import { join } from 'path';

const app = new Hono();

const REPO_ROOT = join(import.meta.dir, '..');
const FINGERPRINT = computeFingerprint(REPO_ROOT);
const FINGERPRINT_FILES = fingerprintFileCount(REPO_ROOT);
const STARTED_AT = new Date().toISOString();

// CORS for API endpoints
app.use('/api/*', cors());

// Cache-Control: immutable for hashed asset URLs (?v=...), short TTL for HTML.
// Registered early so it wraps all downstream routes/handlers.
app.use('/*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' || !c.res || c.res.status !== 200) return;
  if (c.res.headers.has('Cache-Control')) return;

  const path = c.req.path;
  const hasVersion = c.req.query('v');

  if (hasVersion && /\.(css|js|png|jpe?g|gif|webp|svg|woff2?|ico)$/i.test(path)) {
    c.res.headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }
  if (path === '/' || path === '/admin' || path.startsWith('/blog') || path.startsWith('/digests') || path.endsWith('.html')) {
    c.res.headers.set('Cache-Control', 'public, max-age=300, must-revalidate');
    return;
  }
  if (/\.(png|jpe?g|gif|webp|svg|woff2?|ico)$/i.test(path)) {
    c.res.headers.set('Cache-Control', 'public, max-age=86400, must-revalidate');
  }
});

// API routes
app.post('/api/feedback', handleFeedback);

// Thread routes
app.get('/api/threads/:visitorId/check', checkThreadMessages);
app.get('/api/threads/:visitorId/messages', getThreadMessages);
app.get('/api/threads/:visitorId/stream', streamVisitorThread);

// Admin routes
app.post('/api/admin/threads/:visitorId/reply', replyToThread);
app.post('/api/admin/threads/:visitorId/read', markThreadRead);
app.get('/api/admin/threads', listAllThreads);
app.get('/api/admin/inbox/health', getInboxHealth);
app.delete('/api/admin/threads/:visitorId', deleteThreadById);
app.get('/api/admin/stream', streamAdminUpdates);
app.post('/api/admin/push-subscribe', subscribeToPush);

// Creature API
app.get('/api/creature/state', getCreatureState);
app.route('/api/creature', creatureVisit);
app.route('/api/creature', creatureThink);

// Push notification routes
app.get('/api/push/vapid-public-key', getVapidPublicKey);

// Continue conversation (secret token; no cookie grant)
app.get('/m/:token', continueThreadGet);
app.post('/m/:token', continueThreadPost);

// Rendered pages. These must stay ahead of serveStatic so nothing can serve an
// unrendered template, and the templates live outside public/ so there is
// nothing unrendered to serve in the first place.
const HTML_HEADERS = { 'Content-Type': 'text/html; charset=utf-8' } as const;

app.get('/', (c) => c.body(homePage(), 200, HTML_HEADERS));
app.get('/index.html', (c) => c.body(homePage(), 200, HTML_HEADERS));

// /admin.html is requested by the service worker and by push notification
// click-through, so both spellings have to render.
app.get('/admin', (c) => c.body(adminPage(), 200, HTML_HEADERS));
app.get('/admin.html', (c) => c.body(adminPage(), 200, HTML_HEADERS));

// Analytics dashboard (admin-gated)
app.get('/api/admin/analytics/summary', handleAnalyticsSummary);
app.get('/api/admin/analytics/insights', handleAnalyticsInsights);
app.get('/api/admin/analytics/deep', handleAnalyticsDeep);
app.get('/analytics', serveStatic({ path: './public/analytics.html' }));

// Public blog routes
app.get('/blog', blogIndex);
app.get('/blog/rss.xml', blogRss);
app.get('/blog/sitemap.xml', blogSitemap);
app.get('/blog/:slug/assets/:path{.+}', blogAsset);
app.get('/blog/:slug', blogPost);

// Public digest routes
app.get('/digests/hn', hnDigestIndex);
app.get('/digests/hn/rss.xml', hnDigestRss);
app.get('/digests/hn/sitemap.xml', hnDigestSitemap);
app.get('/digests/hn/:slug', hnDigestPost);

// Health check
app.get('/api/health', (c) => c.json({
  status: 'ok',
  timestamp: Date.now(),
  connections: connectionManager.getStats(),
}));

// Deployment identity. scripts/smoke.ts compares this against the local
// checkout, so a stale deploy fails verification even when every route is 200.
app.get('/api/version', (c) => c.json({
  fingerprint: FINGERPRINT,
  files: FINGERPRINT_FILES,
  startedAt: STARTED_AT,
}));

// Fix HEAD requests for XML files (Hono serveStatic bug workaround)
// Google Search Console uses HEAD requests to check sitemaps before fetching
// Without this, serveStatic returns content-length: 0 for HEAD requests
app.use('*', async (c, next) => {
  if (c.req.method === 'HEAD' && c.req.path.endsWith('.xml')) {
    const filePath = `./public${c.req.path}`;
    const file = Bun.file(filePath);

    if (await file.exists()) {
      return new Response(null, {
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': file.size.toString(),
          'Cache-Control': c.req.path.includes('sitemap') ? 'public, max-age=3600' : 'public, max-age=86400',
        },
      });
    }
  }

  await next();
});

// Serve static files (CSS, JS, images)
app.use('/*', serveStatic({ root: './public' }));

// Fallback to the rendered homepage for SPA routing
app.get('/*', (c) => c.body(homePage(), 200, HTML_HEADERS));

const port = parseInt(Bun.env.PORT || '3000');
console.log(`🚀 Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // Max allowed by Bun for SSE connections
};
