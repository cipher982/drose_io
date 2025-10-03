import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { connectionManager } from '../sse/connection-manager';
import { getMessages } from '../storage/threads';

/**
 * SSE stream for visitor's own thread
 * GET /api/threads/:visitorId/stream
 */
export function streamVisitorThread(c: Context) {
  const { visitorId } = c.req.param();

  return streamSSE(c, async (stream) => {
    // Register connection
    const { cleanup, connection } = connectionManager.registerVisitor(visitorId, stream as any);

    // Send initial messages
    const messages = getMessages(visitorId);
    if (messages.length > 0) {
      await stream.writeSSE({
        data: JSON.stringify({ type: 'init', messages }),
      });
    }

    // Keep connection alive with periodic pings
    const keepAliveInterval = setInterval(async () => {
      try {
        await stream.writeSSE({ comment: 'ping' });
        // Update lastActivity to prevent cleanup
        connection.lastActivity = Date.now();
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 15000);

    // Keep stream open indefinitely
    // The abortSignal will handle cleanup when client disconnects
    try {
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepAliveInterval);
          cleanup();
          resolve(null);
        });
      });
    } catch (error) {
      clearInterval(keepAliveInterval);
      cleanup();
    }
  });
}

/**
 * SSE stream for admin (all thread updates)
 * GET /api/admin/stream
 */
export function streamAdminUpdates(c: Context) {
  // Check auth (from header or query param for SSE)
  const authHeader = c.req.header('authorization');
  const authQuery = c.req.query('auth');
  const adminPassword = Bun.env.ADMIN_PASSWORD || 'changeme';

  const providedAuth = authHeader?.replace('Bearer ', '') || authQuery;

  if (!providedAuth || providedAuth !== adminPassword) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return streamSSE(c, async (stream) => {
    // Register admin connection
    const { cleanup, connection } = connectionManager.registerAdmin(stream as any);

    // Keep connection alive
    const keepAliveInterval = setInterval(async () => {
      try {
        await stream.writeSSE({ comment: 'ping' });
        // Update lastActivity to prevent cleanup
        connection.lastActivity = Date.now();
      } catch (error) {
        clearInterval(keepAliveInterval);
      }
    }, 15000);

    // Keep stream open indefinitely
    try {
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepAliveInterval);
          cleanup();
          resolve(null);
        });
      });
    } catch (error) {
      clearInterval(keepAliveInterval);
      cleanup();
    }
  });
}
