import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { handleFeedback } from './feedback';
import { checkThreadMessages, getThreadMessages, replyToThread, listAllThreads, deleteThreadById } from './api/threads';
import { streamVisitorThread, streamAdminUpdates } from './api/sse';
import { connectionManager } from './sse/connection-manager';
import { subscribeToPush, getVapidPublicKey } from './api/push';
import { blogIndex, blogPost, blogRss, blogAsset } from './blog/routes';
import { getCreatureState } from './api/creature';
import creatureVisit from './api/creature-visit';
import creatureThink from './api/creature-think';

const app = new Hono();

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
  if (path === '/' || path === '/admin' || path.startsWith('/blog') || path.endsWith('.html')) {
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
app.get('/api/admin/threads', listAllThreads);
app.delete('/api/admin/threads/:visitorId', deleteThreadById);
app.get('/api/admin/stream', streamAdminUpdates);
app.post('/api/admin/push-subscribe', subscribeToPush);

// Creature API
app.get('/api/creature/state', getCreatureState);
app.route('/api/creature', creatureVisit);
app.route('/api/creature', creatureThink);

// Push notification routes
app.get('/api/push/vapid-public-key', getVapidPublicKey);

// Admin page
app.get('/admin', serveStatic({ path: './public/admin.html' }));

// Public blog routes
app.get('/blog', blogIndex);
app.get('/blog/rss.xml', blogRss);
app.get('/blog/:slug/assets/:path{.+}', blogAsset);
app.get('/blog/:slug', blogPost);

// Health check
app.get('/api/health', (c) => c.json({
  status: 'ok',
  timestamp: Date.now(),
  connections: connectionManager.getStats(),
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

// Serve static files (HTML, CSS, JS, images)
app.use('/*', serveStatic({ root: './public' }));

// Fallback to index.html for SPA routing
app.get('/*', serveStatic({ path: './public/index.html' }));

const port = parseInt(Bun.env.PORT || '3000');
console.log(`🚀 Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // Max allowed by Bun for SSE connections
};
