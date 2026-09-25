/**
 * The only store. One append-only file per visitor holds everything that
 * happened in their conversation; visitors.json holds the few facts needed to
 * reach them. Nothing else in the app keeps conversation state.
 *
 *   data/pepper/conversations/<visitorId>.jsonl
 *   data/pepper/visitors.json
 *
 * David's inbox is computed from the conversations, never stored.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

export const DATA_DIR = Bun.env.PEPPER_DIR || './data/pepper';
const CONVERSATIONS = join(DATA_DIR, 'conversations');
const VISITORS = join(DATA_DIR, 'visitors.json');

mkdirSync(CONVERSATIONS, { recursive: true });

export type From = 'visitor' | 'pepper' | 'david';
export type Via = 'web' | 'option' | 'email' | 'telegram';
export type RelayStatus = 'sent' | 'failed' | 'limited';

export type Entry =
  | { kind: 'message'; from: From; text: string; ts: number; via?: Via; options?: string[] }
  | { kind: 'relay'; summary: string; message: string; status: RelayStatus; ts: number }
  | { kind: 'contact'; email: string; ts: number }
  | { kind: 'telegram-linked'; ts: number }
  | { kind: 'world'; text: string; ts: number };      // what this visitor did for the dog house

export interface Visitor {
  /** 24 lowercase hex. The /m/ link, the Telegram start= payload, and pepper+<token>@ all use it. */
  token: string;
  email?: string;
  telegramChatId?: number;
  topicId?: number;
  summary?: string;
  referrer?: string;
  createdAt: number;
}

/** Visitor ids come from the browser; keep them to a safe filename alphabet. */
export function isValidVisitorId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id);
}

/** A same-site path and nothing else: it ends up in David's briefing and the prompt. */
export function safePage(raw: unknown): string {
  const p = String(raw || '/').slice(0, 200);
  return /^\/[A-Za-z0-9\-._~/%]*$/.test(p) ? p : '/';
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ---- visitors ---------------------------------------------------------------

function loadVisitors(): Record<string, Visitor> {
  if (!existsSync(VISITORS)) return {};
  try {
    return JSON.parse(readFileSync(VISITORS, 'utf-8'));
  } catch (error) {
    console.error('pepper visitors.json unreadable:', error);
    return {};
  }
}

function saveVisitors(all: Record<string, Visitor>): void {
  const tmp = `${VISITORS}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n');
  renameSync(tmp, VISITORS);
}

export function newToken(): string {
  return randomBytes(12).toString('hex');
}

export function getVisitor(id: string): Visitor | null {
  return loadVisitors()[id] || null;
}

/** Returns the visitor record, creating it (and its token) on first contact. */
export function ensureVisitor(id: string): Visitor {
  const all = loadVisitors();
  if (!all[id]) {
    all[id] = { token: newToken(), createdAt: Date.now() };
    saveVisitors(all);
  }
  return all[id];
}

export function updateVisitor(id: string, patch: Partial<Visitor>): Visitor {
  const all = loadVisitors();
  all[id] = { ...(all[id] || { token: newToken(), createdAt: Date.now() }), ...patch };
  saveVisitors(all);
  return all[id];
}

function findVisitor(match: (v: Visitor) => boolean): string | null {
  for (const [id, v] of Object.entries(loadVisitors())) if (match(v)) return id;
  return null;
}

export const visitorByToken = (token: string) => findVisitor(v => v.token === token.toLowerCase());
export const visitorByTopic = (topicId: number) => findVisitor(v => v.topicId === topicId);
export const visitorByTelegramChat = (chatId: number) => findVisitor(v => v.telegramChatId === chatId);

// ---- conversations ----------------------------------------------------------

const file = (id: string) => join(CONVERSATIONS, `${id}.jsonl`);

export function append(id: string, entry: Entry): void {
  if (!isValidVisitorId(id)) throw new Error('invalid visitor id');
  appendFileSync(file(id), JSON.stringify(entry) + '\n');
}

export function read(id: string): Entry[] {
  if (!isValidVisitorId(id) || !existsSync(file(id))) return [];
  return readFileSync(file(id), 'utf-8')
    .split('\n')
    .filter(Boolean)
    .flatMap(line => {
      try {
        return [JSON.parse(line) as Entry];
      } catch {
        return [];
      }
    });
}

export function messages(id: string) {
  return read(id).filter((e): e is Extract<Entry, { kind: 'message' }> => e.kind === 'message');
}

export function relayCount(id: string, sinceMs = 0): number {
  return read(id).filter(e => e.kind === 'relay' && e.status !== 'limited' && e.ts >= sinceMs).length;
}

// ---- David's inbox (computed) -----------------------------------------------

/**
 * Relays David has not answered yet: every relay newer than his latest reply.
 * A visitor "needs David" when this is non-empty.
 */
export function unansweredRelays(id: string): number[] {
  const entries = read(id);
  // Order in the log, not timestamps: a write-back can land in the same millisecond as his reply.
  const lastDavid = entries.findLastIndex(e => e.kind === 'message' && e.from === 'david');
  return entries.filter((e, i) => i > lastDavid && e.kind === 'relay' && e.status !== 'limited').map(e => e.ts);
}

export function allVisitorIds(): string[] {
  return existsSync(CONVERSATIONS)
    ? readdirSync(CONVERSATIONS).filter(f => f.endsWith('.jsonl')).map(f => f.slice(0, -6))
    : [];
}

/**
 * Shape is load-bearing: Sauron's stale-unread watchdog reads unreadTotal and
 * oldestUnreadAgeSec. openThreadCount is every conversation that ever reached
 * David, answered or not.
 */
export function inboxHealth() {
  const ids = allVisitorIds();
  let unreadTotal = 0;
  let threads = 0;
  let oldest: { id: string; since: number } | null = null;
  for (const id of ids) {
    if (!read(id).some(e => e.kind === 'relay')) continue; // never reached David
    threads++;
    const waiting = unansweredRelays(id);
    unreadTotal += waiting.length;
    if (waiting.length && (!oldest || waiting[0] < oldest.since)) oldest = { id, since: waiting[0] };
  }
  return {
    ok: true as const,
    unreadTotal,
    openThreadCount: threads,
    oldestUnreadAgeSec: oldest ? Math.max(0, Math.floor((Date.now() - oldest.since) / 1000)) : null,
    oldestUnreadVisitorId: oldest?.id ?? null,
  };
}
