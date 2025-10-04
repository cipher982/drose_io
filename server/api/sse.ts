import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { connectionManager } from '../sse/connection-manager';
import { getMessages } from '../storage/threads';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';

/**
 * SSE stream for visitor's own thread
 * GET /api/threads/:visitorId/stream
 */
export function streamVisitorThread(c: Context) {
  const { visitorId } = c.req.param();

  // Disable Cloudflare/nginx buffering for SSE
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');

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
  const password = extractAuthPassword(c);
  if (!isValidAdminPassword(password)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const requestMeta = {
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown',
    ua: c.req.header('user-agent') || 'unknown',
  };
  console.log('🔌 Admin SSE request', requestMeta);

  // Disable Cloudflare/nginx buffering for SSE
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');

  return streamSSE(c, async (stream) => {
    // Register admin connection
    const { cleanup, connection } = connectionManager.registerAdmin(stream as any);

    try {
      await stream.writeSSE({
        event: 'status',
        data: JSON.stringify({ type: 'ready', timestamp: Date.now() })
      });
    } catch (error) {
      console.error('Failed to send initial admin SSE status event', error);
    }

    // Keep connection alive
    const keepAliveInterval = setInterval(async () => {
      try {
        await stream.writeSSE({ event: 'ping', data: Date.now().toString() });
        // Update lastActivity to prevent cleanup
        connection.lastActivity = Date.now();
      } catch (error) {
        console.warn('Admin SSE keepalive failed', error);
        clearInterval(keepAliveInterval);
      }
    }, 15000);

    // Keep stream open indefinitely
    try {
      await new Promise((resolve) => {
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(keepAliveInterval);
          cleanup();
          console.log('🔌 Admin SSE client aborted', requestMeta);
          resolve(null);
        });
      });
    } catch (error) {
      clearInterval(keepAliveInterval);
      cleanup();
      console.error('Admin SSE stream failed', error);
    }
  });
}
