import type { Context } from 'hono';
import {
  getMessages,
  getUnreadCount,
  appendMessage,
  generateMessageId,
  listThreads,
  deleteThread,
  getUnreadFromVisitor,
  setLastRead,
  getInboxHealthSummary,
  isValidVisitorId,
} from '../storage/threads';
import { getThreadMeta, continueUrlForToken } from '../storage/thread-meta';
import { sendVisitorReplyEmail } from '../notifications/visitor-email';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';

/**
 * Check for new messages (polling endpoint)
 * GET /api/threads/:visitorId/check?since=messageId
 */
export async function checkThreadMessages(c: Context) {
  try {
    const { visitorId } = c.req.param();
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: 'Invalid visitorId' }, 400);
    }
    const since = c.req.query('since') || undefined;

    const messages = getMessages(visitorId, since);
    const unreadCount = getUnreadCount(visitorId, since);

    return c.json({
      messages,
      unreadCount,
      hasNew: messages.length > 0,
    });
  } catch (error) {
    console.error('Error checking messages:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Get all messages for a thread
 * GET /api/threads/:visitorId/messages
 */
export async function getThreadMessages(c: Context) {
  try {
    const { visitorId } = c.req.param();
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: 'Invalid visitorId' }, 400);
    }
    const messages = getMessages(visitorId);

    return c.json({ messages });
  } catch (error) {
    console.error('Error getting messages:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Reply to a thread (admin only)
 * POST /api/admin/threads/:visitorId/reply
 */
export async function replyToThread(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { visitorId } = c.req.param();
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: 'Invalid visitorId' }, 400);
    }
    const { text } = await c.req.json();

    if (!text || !text.trim()) {
      return c.json({ error: 'text required' }, 400);
    }

    const messageId = generateMessageId();
    const message = {
      id: messageId,
      from: 'david' as const,
      text: text.trim(),
      ts: Date.now(),
    };

    appendMessage(visitorId, message);

    const meta = getThreadMeta(visitorId);
    let emailStatus: 'sent' | 'skipped' | 'failed' | 'none' = 'none';
    if (meta?.contactEmail) {
      try {
        const result = await sendVisitorReplyEmail({
          to: meta.contactEmail,
          replyText: message.text,
          continueUrl: continueUrlForToken(meta.continueToken),
        });
        emailStatus = result.skipped ? 'skipped' : result.sent ? 'sent' : 'failed';
      } catch (error) {
        console.error('❌ Visitor reply email failed:', error);
        emailStatus = 'failed';
      }
    }

    console.log('✅ Reply sent:', { visitorId, messageId, emailStatus });

    return c.json({
      success: true,
      messageId,
      emailed: emailStatus === 'sent',
      emailStatus,
    });
  } catch (error) {
    console.error('Error replying:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Mark a thread as read (admin only)
 * POST /api/admin/threads/:visitorId/read
 */
export async function markThreadRead(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { visitorId } = c.req.param();
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: 'Invalid visitorId' }, 400);
    }

    let messageId: string | undefined;
    try {
      const body = await c.req.json();
      if (body && typeof body.messageId === 'string') {
        messageId = body.messageId;
      }
    } catch {
      // empty body is fine — mark latest
    }

    const result = setLastRead(visitorId, messageId);
    const health = getInboxHealthSummary();

    return c.json({
      success: true,
      ...result,
      unreadTotal: health.unreadTotal,
    });
  } catch (error: any) {
    if (error?.message === 'messageId not found in thread') {
      return c.json({ error: error.message }, 400);
    }
    console.error('Error marking thread read:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Inbox health summary for Sauron probes (admin only)
 * GET /api/admin/inbox/health
 */
export async function getInboxHealth(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return c.json(getInboxHealthSummary());
  } catch (error) {
    console.error('Error getting inbox health:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * List all threads (admin only)
 * GET /api/admin/threads
 */
export async function listAllThreads(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const threads = listThreads();

    threads.sort((a, b) => b.lastSeen - a.lastSeen);

    const threadsWithMessages = threads.map(thread => {
      const messages = getMessages(thread.visitorId);
      const lastMessage = messages[messages.length - 1];

      const threadMeta = getThreadMeta(thread.visitorId);
      return {
        ...thread,
        lastMessage,
        unreadFromVisitor: getUnreadFromVisitor(thread.visitorId),
        contactEmail: threadMeta?.contactEmail || null,
        continueToken: threadMeta?.continueToken || null,
      };
    });

    return c.json({ threads: threadsWithMessages });
  } catch (error) {
    console.error('Error listing threads:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Delete a thread (admin only)
 * DELETE /api/admin/threads/:visitorId
 */
export async function deleteThreadById(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { visitorId } = c.req.param();
    if (!isValidVisitorId(visitorId)) {
      return c.json({ error: 'Invalid visitorId' }, 400);
    }

    const deleted = deleteThread(visitorId);

    if (!deleted) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error('Error deleting thread:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
