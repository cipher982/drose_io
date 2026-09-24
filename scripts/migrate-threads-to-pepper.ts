#!/usr/bin/env bun
/**
 * One-time migration: the old direct-message inbox (data/threads) into
 * Pepper's conversations (data/pepper).
 *
 *   bun run scripts/migrate-threads-to-pepper.ts [--data ./data] [--write]
 *
 * Dry run by default. Idempotent: a visitor whose conversation file already
 * exists is skipped. Old visitor DMs become visitor messages, David's replies
 * become David messages, and only DMs still unread per read-state.json get a
 * relay event, so the computed inbox matches what was unread before.
 * Visitors get new tokens, so old /m/<token> links stop resolving (they then
 * land on the homepage with the chat open).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

interface OldMessage { id: string; from: 'visitor' | 'david'; text: string; ts: number }

export interface MigrationResult {
  migrated: string[];
  skipped: string[];
  unreadRelays: number;
}

function readJson(path: string): any {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
}

export function migrate(dataDir: string, write: boolean): MigrationResult {
  const threadsDir = join(dataDir, 'threads');
  const pepperDir = join(dataDir, 'pepper');
  const convDir = join(pepperDir, 'conversations');
  const visitorsPath = join(pepperDir, 'visitors.json');
  const meta = readJson(join(threadsDir, 'thread-meta.json')).byVisitor || {};
  const readState = readJson(join(threadsDir, 'read-state.json'));
  const visitors = readJson(visitorsPath);
  const result: MigrationResult = { migrated: [], skipped: [], unreadRelays: 0 };

  const files = existsSync(threadsDir) ? readdirSync(threadsDir).filter(f => f.endsWith('.jsonl')) : [];
  for (const f of files) {
    const id = f.slice(0, -'.jsonl'.length);
    if (existsSync(join(convDir, f)) || visitors[id]) {
      result.skipped.push(id);
      continue;
    }
    const old: OldMessage[] = readFileSync(join(threadsDir, f), 'utf-8')
      .split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });

    const lastRead = readState[id]?.lastReadMessageId;
    const readUpTo = lastRead ? old.findIndex(m => m.id === lastRead) : -1;
    const entries: object[] = [];
    old.forEach((m, i) => {
      entries.push({ kind: 'message', from: m.from, text: m.text, ts: m.ts, ...(m.from === 'visitor' ? { via: 'web' } : {}) });
      if (m.from === 'visitor' && i > readUpTo) {
        entries.push({ kind: 'relay', summary: 'direct message (migrated)', message: m.text, status: 'sent', ts: m.ts });
        result.unreadRelays++;
      }
    });
    const email = meta[id]?.contactEmail;
    visitors[id] = { token: randomBytes(12).toString('hex'), ...(email ? { email } : {}), createdAt: old[0]?.ts ?? Date.now() };
    result.migrated.push(id);
    if (write) {
      mkdirSync(convDir, { recursive: true });
      writeFileSync(join(convDir, f), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    }
  }
  if (write && result.migrated.length) {
    mkdirSync(pepperDir, { recursive: true });
    const tmp = `${visitorsPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(visitors, null, 2) + '\n');
    renameSync(tmp, visitorsPath);
  }
  return result;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dataDir = args.includes('--data') ? args[args.indexOf('--data') + 1] : './data';
  const write = args.includes('--write');
  const r = migrate(dataDir, write);
  console.log(`${write ? 'migrated' : 'would migrate'} ${r.migrated.length} thread(s), skipped ${r.skipped.length} already present, ${r.unreadRelays} unread message(s) now waiting on David`);
  if (!write) console.log('dry run; pass --write to apply');
}
