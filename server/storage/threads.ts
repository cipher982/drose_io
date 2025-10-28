import { existsSync, mkdirSync, readFileSync, appendFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { connectionManager } from '../sse/connection-manager';

const isTestMode = Bun.env.TEST_MODE === 'true';
const THREADS_DIR = Bun.env.THREADS_DIR || (isTestMode ? './data/threads/test' : './data/threads');
const MAX_THREAD_SIZE = 1024 * 1024; // 1MB
const BLOCKED_DIR = Bun.env.BLOCKED_DIR || (isTestMode ? './data/blocked/test' : './data/blocked');

// Ensure directories exist
if (!existsSync(THREADS_DIR)) {
  mkdirSync(THREADS_DIR, { recursive: true });
}

if (!existsSync(BLOCKED_DIR)) {
  mkdirSync(BLOCKED_DIR, { recursive: true });
}

export interface Message {
  id: string;
  from: 'visitor' | 'david';
  text: string;
  ts: number;
  page?: string;
  read?: boolean;
}

export interface VisitorMetadata {
  visitorId: string;
  firstSeen: number;
  lastSeen: number;
  messageCount: number;
  pagesVisited: string[];
}

/**
 * Append a message to a visitor's thread
 */
export function appendMessage(visitorId: string, message: Message): void {
  const threadPath = join(THREADS_DIR, `${visitorId}.jsonl`);

  // Check file size before appending
  if (existsSync(threadPath)) {
    const stats = statSync(threadPath);
    if (stats.size > MAX_THREAD_SIZE) {
      // Archive old thread
      const archivePath = `${threadPath}.${Date.now()}.archive`;
      Bun.write(archivePath, Bun.file(threadPath));
    }
  }

  // Append message as JSONL
  const line = JSON.stringify(message) + '\n';
  appendFileSync(threadPath, line, 'utf-8');

  // Broadcast to SSE connections
  if (message.from === 'david') {
    // Notify visitor's active connections
    connectionManager.notifyVisitor(visitorId, {
      type: 'new-message',
      message,
    });
  } else {
    // Notify admin connections
    connectionManager.notifyAdmins('new-message', {
      visitorId,
      message,
    });
  }
}

/**
 * Get all messages for a visitor
 */
export function getMessages(visitorId: string, sinceId?: string): Message[] {
  const threadPath = join(THREADS_DIR, `${visitorId}.jsonl`);

  if (!existsSync(threadPath)) {
    return [];
  }

  const content = readFileSync(threadPath, 'utf-8');
  const messages = content
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line) as Message);

  if (sinceId) {
    const sinceIndex = messages.findIndex(m => m.id === sinceId);
    if (sinceIndex !== -1) {
      return messages.slice(sinceIndex + 1);
    }
  }

  return messages;
}

/**
 * Get unread count for visitor (messages from admin since lastSeenId)
 */
export function getUnreadCount(visitorId: string, lastSeenId?: string): number {
  const messages = getMessages(visitorId, lastSeenId);
  return messages.filter(m => m.from === 'david').length;
}

/**
 * Get visitor metadata
 */
export function getVisitorMetadata(visitorId: string): VisitorMetadata | null {
  const messages = getMessages(visitorId);

  if (messages.length === 0) {
    return null;
  }

  const pagesVisited = [...new Set(
    messages
      .filter(m => m.page)
      .map(m => m.page!)
  )];

  return {
    visitorId,
    firstSeen: messages[0].ts,
    lastSeen: messages[messages.length - 1].ts,
    messageCount: messages.length,
    pagesVisited,
  };
}

/**
 * List all active threads (for admin)
 */
export function listThreads(): VisitorMetadata[] {
  const files = readdirSync(THREADS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace('.jsonl', ''));

  return files
    .map(visitorId => getVisitorMetadata(visitorId))
    .filter(Boolean) as VisitorMetadata[];
}

/**
 * Check if visitor is blocked
 */
export function isBlocked(visitorId: string): boolean {
  const blockedPath = join(BLOCKED_DIR, visitorId);
  return existsSync(blockedPath);
}

/**
 * Delete a thread and all its messages
 */
export function deleteThread(visitorId: string): boolean {
  const threadPath = join(THREADS_DIR, `${visitorId}.jsonl`);

  if (!existsSync(threadPath)) {
    return false;
  }

  try {
    const fs = require('fs');
    fs.unlinkSync(threadPath);

    // Notify admin connections that thread was deleted
    connectionManager.notifyAdmins('thread-deleted', { visitorId });

    console.log('🗑️  Thread deleted:', visitorId);
    return true;
  } catch (error) {
    console.error('Error deleting thread:', error);
    return false;
  }
}

/**
 * Generate unique message ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
