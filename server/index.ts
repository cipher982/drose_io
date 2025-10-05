import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { handleFeedback } from './feedback';
import { checkThreadMessages, getThreadMessages, replyToThread, listAllThreads, deleteThreadById } from './api/threads';
import { streamVisitorThread, streamAdminUpdates } from './api/sse';
import { connectionManager } from './sse/connection-manager';
import { subscribeToPush, getVapidPublicKey } from './api/push';

const app = new Hono();

// CORS for API endpoints
app.use('/api/*', cors());

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

// Push notification routes
app.get('/api/push/vapid-public-key', getVapidPublicKey);

// Health check
app.get('/api/health', (c) => c.json({
  status: 'ok',
  timestamp: Date.now(),
  connections: connectionManager.getStats(),
}));

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
