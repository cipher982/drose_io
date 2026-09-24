/**
 * Pepper's own state, kept apart from data/threads on purpose.
 *
 * data/threads is David's inbox: Sauron's stale-unread watchdog pages on it, so
 * only messages meant for David belong there. Everything a visitor says to
 * Pepper lives in a per-visitor chat log here; a relay copies one message into
 * the thread.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

const ROOT = Bun.env.PEPPER_DIR || (Bun.env.TEST_MODE === 'true' ? './data/pepper-test' : './data/pepper');
const CHATS = join(ROOT, 'chats');
const META_PATH = join(ROOT, 'meta.json');

mkdirSync(CHATS, { recursive: true });

export type ChatFrom = 'visitor' | 'pepper' | 'david';

export interface ChatEntry {
  from: ChatFrom;
  text: string;
  ts: number;
  via?: 'typed' | 'option' | 'email' | 'telegram';
  options?: string[];
  relay?: 'sent' | 'failed' | 'limited';
}

export interface PepperVisitor {
  replyKey: string;
  topicId?: number;
  telegramChatId?: number;
  relays: number[]; // timestamps
  summary?: string;
  referrer?: string;
  createdAt: number;
}

interface MetaFile {
  byVisitor: Record<string, PepperVisitor>;
  byReplyKey: Record<string, string>;
  byTopic: Record<string, string>;
  byTelegramChat: Record<string, string>;
}

function load(): MetaFile {
  const empty: MetaFile = { byVisitor: {}, byReplyKey: {}, byTopic: {}, byTelegramChat: {} };
  if (!existsSync(META_PATH)) return empty;
  try {
    return { ...empty, ...JSON.parse(readFileSync(META_PATH, 'utf-8')) };
  } catch (error) {
    console.error('pepper meta unreadable:', error);
    return empty;
  }
}

function save(meta: MetaFile): void {
  const tmp = `${META_PATH}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(meta, null, 2) + '\n');
  renameSync(tmp, META_PATH);
}

// Lowercase only: the mail edge lowercases the recipient, so a mixed-case key
// in pepper+<key>@ would never match on the way back in.
function newReplyKey(): string {
  return randomBytes(12).toString('hex');
}

export function getVisitor(vid: string): PepperVisitor | null {
  return load().byVisitor[vid] || null;
}

export function ensureVisitor(vid: string): PepperVisitor {
  const meta = load();
  let v = meta.byVisitor[vid];
  if (!v) {
    v = { replyKey: newReplyKey(), relays: [], createdAt: Date.now() };
    meta.byVisitor[vid] = v;
    meta.byReplyKey[v.replyKey] = vid;
    save(meta);
  }
  return v;
}

export function updateVisitor(vid: string, patch: Partial<PepperVisitor>): PepperVisitor {
  const meta = load();
  const v = meta.byVisitor[vid] || { replyKey: newReplyKey(), relays: [], createdAt: Date.now() };
  Object.assign(v, patch);
  meta.byVisitor[vid] = v;
  meta.byReplyKey[v.replyKey] = vid;
  if (v.topicId) meta.byTopic[String(v.topicId)] = vid;
  if (v.telegramChatId) meta.byTelegramChat[String(v.telegramChatId)] = vid;
  save(meta);
  return v;
}

export function visitorByReplyKey(key: string): string | null {
  return load().byReplyKey[key.toLowerCase()] || null;
}

export function visitorByTopic(topicId: number): string | null {
  return load().byTopic[String(topicId)] || null;
}

export function visitorByTelegramChat(chatId: number): string | null {
  return load().byTelegramChat[String(chatId)] || null;
}

function chatPath(vid: string): string {
  return join(CHATS, `${vid}.jsonl`);
}

export function appendChat(vid: string, entry: ChatEntry): void {
  appendFileSync(chatPath(vid), JSON.stringify(entry) + '\n');
}

export function readChat(vid: string): ChatEntry[] {
  const p = chatPath(vid);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as ChatEntry];
      } catch {
        return [];
      }
    });
}
