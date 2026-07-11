import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { connectionManager } from '../sse/connection-manager';
import { clearThreadMeta } from './thread-meta';

const isTestMode = Bun.env.TEST_MODE === 'true';
const THREADS_DIR = Bun.env.THREADS_DIR || (isTestMode ? './data/threads/test' : './data/threads');
const MAX_THREAD_SIZE = 1024 * 1024; // 1MB
const BLOCKED_DIR = Bun.env.BLOCKED_DIR || (isTestMode ? './data/blocked/test' : './data/blocked');
const READ_STATE_PATH = join(THREADS_DIR, 'read-state.json');

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

export interface ThreadReadEntry {
  lastReadMessageId?: string;
}

export type ReadStateMap = Record<string, ThreadReadEntry>;

export interface InboxHealthSummary {
  ok: true;
  unreadTotal: number;
  openThreadCount: number;
  oldestUnreadAgeSec: number | null;
  oldestUnreadVisitorId: string | null;
}

/** Safe visitor/thread ids: no path separators or traversal. */
export function isValidVisitorId(visitorId: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(visitorId);
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

function loadReadState(): ReadStateMap {
  if (!existsSync(READ_STATE_PATH)) {
    return {};
  }

  try {
    const raw = readFileSync(READ_STATE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as ReadStateMap;
  } catch (error) {
    console.error('Failed to load read-state.json:', error);
    return {};
  }
}

function saveReadState(state: ReadStateMap): void {
  writeJsonAtomic(READ_STATE_PATH, state);
}

export function getThreadReadState(visitorId: string): ThreadReadEntry {
  return loadReadState()[visitorId] || {};
}

/**
 * Append a message to a visitor's thread
 */
export function appendMessage(visitorId: string, message: Message): void {
  if (!isValidVisitorId(visitorId)) {
    throw new Error('Invalid visitorId');
  }

  const threadPath = join(THREADS_DIR, `${visitorId}.jsonl`);

  // Check file size before appending — archive full history, keep recent tail live
  if (existsSync(threadPath)) {
    const stats = statSync(threadPath);
    if (stats.size > MAX_THREAD_SIZE) {
      const archivePath = `${threadPath}.${Date.now()}.archive`;
      const content = readFileSync(threadPath, 'utf-8');
      writeFileSync(archivePath, content);
      const lines = content.split('\n').filter(line => line.trim());
      const keep = lines.slice(-200);
      writeFileSync(threadPath, keep.length ? keep.join('\n') + '\n' : '');
    }
  }

  // Append message as JSONL
  const line = JSON.stringify(message) + '\n';
  appendFileSync(threadPath, line, 'utf-8');

  // Broadcast to SSE connections
  if (message.from === 'david') {
    connectionManager.notifyVisitor(visitorId, {
      type: 'new-message',
      message,
    });
  } else {
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
  if (!isValidVisitorId(visitorId)) {
    return [];
  }

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
 * Admin unread: visitor messages after lastReadMessageId (all visitor msgs if never read).
 */
export function getUnreadFromVisitor(visitorId: string): number {
  const messages = getMessages(visitorId);
  if (messages.length === 0) return 0;

  const { lastReadMessageId } = getThreadReadState(visitorId);
  let startIndex = 0;
  if (lastReadMessageId) {
    const idx = messages.findIndex(m => m.id === lastReadMessageId);
    if (idx !== -1) {
      startIndex = idx + 1;
    }
  }

  return messages.slice(startIndex).filter(m => m.from === 'visitor').length;
}

/**
 * Mark thread read up to messageId (default: latest message).
 */
export function setLastRead(
  visitorId: string,
  messageId?: string
): { lastReadMessageId: string | null; unreadFromVisitor: number } {
  if (!isValidVisitorId(visitorId)) {
    throw new Error('Invalid visitorId');
  }

  const messages = getMessages(visitorId);
  if (messages.length === 0) {
    return { lastReadMessageId: null, unreadFromVisitor: 0 };
  }

  const targetId = messageId || messages[messages.length - 1].id;
  if (!messages.some(m => m.id === targetId)) {
    throw new Error('messageId not found in thread');
  }

  const state = loadReadState();
  state[visitorId] = {
    ...state[visitorId],
    lastReadMessageId: targetId,
  };
  saveReadState(state);

  return {
    lastReadMessageId: targetId,
    unreadFromVisitor: getUnreadFromVisitor(visitorId),
  };
}

export function clearReadState(visitorId: string): void {
  const state = loadReadState();
  if (!(visitorId in state)) return;
  delete state[visitorId];
  saveReadState(state);
}

/**
 * Oldest unread visitor message timestamp for a thread, or null if none.
 */
function getOldestUnreadVisitorTs(visitorId: string): number | null {
  const messages = getMessages(visitorId);
  if (messages.length === 0) return null;

  const { lastReadMessageId } = getThreadReadState(visitorId);
  let startIndex = 0;
  if (lastReadMessageId) {
    const idx = messages.findIndex(m => m.id === lastReadMessageId);
    if (idx !== -1) startIndex = idx + 1;
  }

  const unreadVisitor = messages.slice(startIndex).filter(m => m.from === 'visitor');
  if (unreadVisitor.length === 0) return null;
  return unreadVisitor[0].ts;
}

export function getInboxHealthSummary(): InboxHealthSummary {
  const threads = listThreads();
  let unreadTotal = 0;
  let oldestUnreadAgeSec: number | null = null;
  let oldestUnreadVisitorId: string | null = null;
  const now = Date.now();

  for (const thread of threads) {
    const unread = getUnreadFromVisitor(thread.visitorId);
    unreadTotal += unread;
    if (unread === 0) continue;

    const oldestTs = getOldestUnreadVisitorTs(thread.visitorId);
    if (oldestTs == null) continue;

    const ageSec = Math.max(0, Math.floor((now - oldestTs) / 1000));
    if (oldestUnreadAgeSec === null || ageSec > oldestUnreadAgeSec) {
      oldestUnreadAgeSec = ageSec;
      oldestUnreadVisitorId = thread.visitorId;
    }
  }

  return {
    ok: true,
    unreadTotal,
    openThreadCount: threads.length,
    oldestUnreadAgeSec,
    oldestUnreadVisitorId,
  };
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
  if (!isValidVisitorId(visitorId)) return false;
  const blockedPath = join(BLOCKED_DIR, visitorId);
  return existsSync(blockedPath);
}

/**
 * Delete a thread and all its messages
 */
export function deleteThread(visitorId: string): boolean {
  if (!isValidVisitorId(visitorId)) {
    return false;
  }

  const threadPath = join(THREADS_DIR, `${visitorId}.jsonl`);

  if (!existsSync(threadPath)) {
    return false;
  }

  try {
    unlinkSync(threadPath);
    for (const name of readdirSync(THREADS_DIR)) {
      if (name.startsWith(`${visitorId}.jsonl.`) && name.endsWith('.archive')) {
        unlinkSync(join(THREADS_DIR, name));
      }
    }
    clearReadState(visitorId);
    clearThreadMeta(visitorId);

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
