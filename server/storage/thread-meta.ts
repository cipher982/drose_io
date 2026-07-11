import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { isValidVisitorId } from './threads';

const isTestMode = Bun.env.TEST_MODE === 'true';
const THREADS_DIR = Bun.env.THREADS_DIR || (isTestMode ? './data/threads/test' : './data/threads');
const META_PATH = join(THREADS_DIR, 'thread-meta.json');

if (!existsSync(THREADS_DIR)) {
  mkdirSync(THREADS_DIR, { recursive: true });
}

export interface ThreadMetaEntry {
  continueToken: string;
  contactEmail?: string;
  createdAt: number;
  updatedAt: number;
}

interface ThreadMetaFile {
  byVisitor: Record<string, ThreadMetaEntry>;
  byToken: Record<string, string>; // token -> visitorId
}

function writeJsonAtomic(path: string, data: unknown): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  renameSync(tmp, path);
}

function emptyMeta(): ThreadMetaFile {
  return { byVisitor: {}, byToken: {} };
}

function loadMeta(): ThreadMetaFile {
  if (!existsSync(META_PATH)) return emptyMeta();
  try {
    const parsed = JSON.parse(readFileSync(META_PATH, 'utf-8'));
    if (!parsed || typeof parsed !== 'object') return emptyMeta();
    return {
      byVisitor: parsed.byVisitor && typeof parsed.byVisitor === 'object' ? parsed.byVisitor : {},
      byToken: parsed.byToken && typeof parsed.byToken === 'object' ? parsed.byToken : {},
    };
  } catch (error) {
    console.error('Failed to load thread-meta.json:', error);
    return emptyMeta();
  }
}

function saveMeta(meta: ThreadMetaFile): void {
  writeJsonAtomic(META_PATH, meta);
}

function generateContinueToken(): string {
  return randomBytes(24).toString('base64url');
}

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function getThreadMeta(visitorId: string): ThreadMetaEntry | null {
  if (!isValidVisitorId(visitorId)) return null;
  return loadMeta().byVisitor[visitorId] || null;
}

export function getVisitorIdByContinueToken(token: string): string | null {
  if (!token || token.length < 16 || token.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return loadMeta().byToken[token] || null;
}

/**
 * Ensure continue token exists; optionally set/update contact email.
 */
export function upsertThreadMeta(
  visitorId: string,
  options?: { contactEmail?: string }
): ThreadMetaEntry {
  if (!isValidVisitorId(visitorId)) {
    throw new Error('Invalid visitorId');
  }

  const meta = loadMeta();
  const now = Date.now();
  let entry = meta.byVisitor[visitorId];

  if (!entry) {
    let token = generateContinueToken();
    while (meta.byToken[token]) {
      token = generateContinueToken();
    }
    entry = {
      continueToken: token,
      createdAt: now,
      updatedAt: now,
    };
    meta.byVisitor[visitorId] = entry;
    meta.byToken[token] = visitorId;
  }

  if (options?.contactEmail !== undefined) {
    const email = options.contactEmail.trim().toLowerCase();
    if (email && !isValidEmail(email)) {
      throw new Error('Invalid email');
    }
    if (email) {
      entry.contactEmail = email;
    }
    entry.updatedAt = now;
  }

  meta.byVisitor[visitorId] = entry;
  saveMeta(meta);
  return entry;
}

export function clearThreadMeta(visitorId: string): void {
  if (!isValidVisitorId(visitorId)) return;
  const meta = loadMeta();
  const entry = meta.byVisitor[visitorId];
  if (!entry) return;
  delete meta.byToken[entry.continueToken];
  delete meta.byVisitor[visitorId];
  saveMeta(meta);
}

export function continueUrlForToken(token: string): string {
  const base = (Bun.env.PUBLIC_BASE_URL || 'https://drose.io').replace(/\/$/, '');
  return `${base}/m/${token}`;
}
