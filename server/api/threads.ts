import type { Context } from 'hono';
import { getMessages, getUnreadCount, appendMessage, generateMessageId, listThreads, getVisitorMetadata, deleteThread } from '../storage/threads';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';

/**
 * Check for new messages (polling endpoint)
 * GET /api/threads/:visitorId/check?since=messageId
 */
export async function checkThreadMessages(c: Context) {
  try {
    const { visitorId } = c.req.param();
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
    const { text } = await c.req.json();

    if (!text || !text.trim()) {
      return c.json({ error: 'text required' }, 400);
    }

    // Create reply message
    const messageId = generateMessageId();
    const message = {
      id: messageId,
      from: 'david' as const,
      text: text.trim(),
      ts: Date.now(),
    };

    // Append to thread
    appendMessage(visitorId, message);

    console.log('✅ Reply sent:', { visitorId, messageId });

    return c.json({
      success: true,
      messageId,
    });
  } catch (error) {
    console.error('Error replying:', error);
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

    // Sort by last activity
    threads.sort((a, b) => b.lastSeen - a.lastSeen);

    // Add last message for each thread
    const threadsWithMessages = threads.map(thread => {
      const messages = getMessages(thread.visitorId);
      const lastMessage = messages[messages.length - 1];

      return {
        ...thread,
        lastMessage,
        unreadFromVisitor: messages.filter(m => m.from === 'visitor').length -
          messages.filter(m => m.from === 'david').length,
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
