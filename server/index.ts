import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { handleFeedback } from './feedback';

const app = new Hono();

// CORS for API endpoints
app.use('/api/*', cors());

// API routes
app.post('/api/feedback', handleFeedback);

// Health check
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// Serve static files (HTML, CSS, JS, images)
app.use('/*', serveStatic({ root: './public' }));

// Fallback to index.html for SPA routing
app.get('/*', serveStatic({ path: './public/index.html' }));

const port = parseInt(Bun.env.PORT || '3000');
console.log(`🚀 Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
