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
    let cleanup: (() => void) | null = null;
    let keepAliveInterval: NodeJS.Timeout | null = null;

    try {
      // Register connection - store the writable stream
      cleanup = connectionManager.registerVisitor(visitorId, stream as any);

      // Send initial messages
      const messages = getMessages(visitorId);
      if (messages.length > 0) {
        await stream.writeSSE({
          data: JSON.stringify({ type: 'init', messages }),
        });
      }

      // Keep connection alive with periodic pings
      keepAliveInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ comment: 'ping' });
        } catch (error) {
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          if (cleanup) cleanup();
        }
      }, 15000);

      // Stream will stay open until client disconnects
      await stream.sleep(Number.MAX_SAFE_INTEGER);

    } catch (error) {
      console.log(`Stream error for visitor ${visitorId.substring(0, 8)}:`, error);
    } finally {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (cleanup) cleanup();
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
    let cleanup: (() => void) | null = null;
    let keepAliveInterval: NodeJS.Timeout | null = null;

    try {
      // Register admin connection
      cleanup = connectionManager.registerAdmin(stream as any);

      // Keep connection alive
      keepAliveInterval = setInterval(async () => {
        try {
          await stream.writeSSE({ comment: 'ping' });
        } catch (error) {
          if (keepAliveInterval) clearInterval(keepAliveInterval);
          if (cleanup) cleanup();
        }
      }, 15000);

      // Stream will stay open
      await stream.sleep(Number.MAX_SAFE_INTEGER);

    } catch (error) {
      console.log('Admin stream error:', error);
    } finally {
      if (keepAliveInterval) clearInterval(keepAliveInterval);
      if (cleanup) cleanup();
    }
  });
}
