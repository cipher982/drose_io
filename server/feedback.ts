import type { Context } from 'hono';
import { notifications } from './notifications';
import { appendMessage, getMessages, getUnreadCount, isBlocked, generateMessageId, getVisitorMetadata } from './storage/threads';
import { sendPushNotification } from './api/push';

// Simple in-memory rate limiting
const BYPASS_RATE_LIMIT = Bun.env.TEST_MODE === 'true';
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, maxRequests = 10, windowMs = 3600000): boolean {
  if (BYPASS_RATE_LIMIT) {
    return true;
  }

  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}

export async function handleFeedback(c: Context) {
  try {
    const body = await c.req.json();
    const { visitorId, type, text, page } = body;

    if (!visitorId) {
      return c.json({ error: 'visitorId required' }, 400);
    }

    // Check if blocked
    if (isBlocked(visitorId)) {
      return c.json({ error: 'Blocked' }, 403);
    }

    // Get IP for rate limiting
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

    // Rate limit check
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Create message
    const messageId = generateMessageId();
    const message = {
      id: messageId,
      from: 'visitor' as const,
      text: text || '',
      ts: Date.now(),
      page: page || '/',
    };

    // Store message in thread
    appendMessage(visitorId, message);

    console.log('📝 Message stored:', { visitorId, messageId, type, page });

    // Get visitor metadata for notifications
    const metadata = getVisitorMetadata(visitorId);

    // Send notifications for both pings and messages
    try {
      if (type === 'ping') {
        const notificationText = `👋 Someone pinged from ${page}\n\nVisitor: ${visitorId.substring(0, 8)}\nFirst seen: ${metadata ? new Date(metadata.firstSeen).toLocaleString() : 'now'}\nMessages: ${metadata?.messageCount || 1}`;
        await notifications.sendAll(notificationText);
        await sendPushNotification('New Ping!', `Someone pinged from ${page}`, visitorId);
      } else if (type === 'message' && text) {
        const notificationText = `💬 New message from ${visitorId.substring(0, 8)}\n\nPage: ${page}\nFirst seen: ${metadata ? new Date(metadata.firstSeen).toLocaleString() : 'now'}\nMessages: ${metadata?.messageCount || 1}\n\n"${text}"`;
        await notifications.sendAll(notificationText);
        await sendPushNotification('New Message!', text, visitorId);
      }
    } catch (error) {
      console.error('❌ Notification failed:', error);
      // Don't fail the request if notification fails
    }

    // Get today's ping count (simple demo - resets on restart)
    const todayKey = new Date().toISOString().split('T')[0];
    const countKey = `count-${todayKey}`;
    let count = parseInt(Bun.env[countKey] || '0');
    count++;
    Bun.env[countKey] = count.toString();

    return c.json({
      success: true,
      messageId,
      visitorId,
      count: type === 'ping' ? count : undefined,
    });
  } catch (error) {
    console.error('Error handling feedback:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
