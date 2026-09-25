/**
 * Pepper's day: what's going on around him, and how he feels about it.
 *
 * sitePulse() gathers cheap live signals (newest post, today's HN brief, how
 * many people dropped by, notes carried, whether David answered anyone).
 * getDay() turns that into a mood and a handful of status lines per activity
 * with one model call, cached for 20 minutes and shared by every visitor.
 * The status lines only ever describe what the sprite is actually doing, so
 * the home in the corner never claims something that isn't happening.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { publishedPosts } from '../blog/loader';
import { read, allVisitorIds } from './conversation';

export type Activity = 'walk' | 'sit' | 'idle' | 'lie' | 'alert';
export interface Day {
  mood: string;
  statuses: Record<Activity, string[]>;
  at: number;
}

const DEFAULT_STATUSES: Record<Activity, string[]> = {
  walk: ['sniffing around'],
  sit: ['sitting pretty'],
  idle: ['hanging out'],
  lie: ['napping'],
  alert: ['watching you'],
};

// ---- live signals ------------------------------------------------------------

let visitors = { day: '', count: 0 };
export function countVisitor(): number {
  const today = new Date().toISOString().slice(0, 10);
  if (visitors.day !== today) visitors = { day: today, count: 0 };
  return ++visitors.count;
}

function latestHnBrief(): { date: string; gist: string } | null {
  const dir = join(process.cwd(), 'content', 'digests', 'hn');
  if (!existsSync(dir)) return null;
  const days = readdirSync(dir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
  for (const d of days.slice(0, 5)) {
    try {
      const m = JSON.parse(readFileSync(join(dir, d, 'meta.json'), 'utf-8'));
      if (m.status !== 'published') continue;
      const gist = String(m.summary || '').split(/(?<=[.!?])\s/)[0].slice(0, 220);
      return { date: d, gist };
    } catch { /* skip a bad brief */ }
  }
  return null;
}

export interface Pulse {
  newestPost: { title: string; date: string; url: string } | null;
  hnBrief: { date: string; gist: string } | null;
  visitorsToday: number;
  notesCarriedToday: number;
  davidRepliedToday: boolean;
}

let pulseCache: { at: number; pulse: Pulse } | null = null;

export function sitePulse(): Pulse {
  if (pulseCache && Date.now() - pulseCache.at < 5 * 60_000) {
    return { ...pulseCache.pulse, visitorsToday: visitors.count };
  }
  const post = publishedPosts()[0];
  const since = new Date(); since.setHours(0, 0, 0, 0);
  let notes = 0;
  let replied = false;
  for (const id of allVisitorIds()) {
    for (const e of read(id)) {
      if (e.ts < since.getTime()) continue;
      if (e.kind === 'relay' && e.status === 'sent') notes++;
      if (e.kind === 'message' && e.from === 'david') replied = true;
    }
  }
  const pulse: Pulse = {
    newestPost: post ? { title: post.meta.title, date: post.meta.publishedAt.slice(0, 10), url: `https://drose.io/blog/${post.meta.slug}` } : null,
    hnBrief: latestHnBrief(),
    visitorsToday: visitors.count,
    notesCarriedToday: notes,
    davidRepliedToday: replied,
  };
  pulseCache = { at: Date.now(), pulse };
  return pulse;
}

export function describePulse(p: Pulse): string {
  const lines = [];
  if (p.newestPost) lines.push(`newest blog post: "${p.newestPost.title}" (${p.newestPost.date})`);
  if (p.hnBrief) lines.push(`today's HN brief (${p.hnBrief.date}): ${p.hnBrief.gist}`);
  lines.push(`people who dropped by today so far: ${p.visitorsToday}`);
  lines.push(`notes you carried to david today: ${p.notesCarriedToday}`);
  if (p.davidRepliedToday) lines.push('david answered someone today');
  return lines.join('\n');
}

// ---- the day, written by the model --------------------------------------------

const DAY_SYSTEM = `You are writing the inner life of Pepper, a small black-and-white maltipom (a boy) who lives in a little glass home in the bottom-right corner of drose.io, David W. Rose's site. Visitors see a tiny status line next to his name that changes with what his sprite is doing.

Given the time and what's happening on the site, write his current mood and a few status lines for each activity. Each status is lowercase, 2-5 words, at most 26 characters, no punctuation at the end, no emoji. Make them specific and alive: react to the newest post, today's HN brief, how busy it is, the time of day. Keep them gentle and funny, never mean.

A status must describe what the sprite is visibly doing in that activity:
- walk: taking a few steps around his little home (sniffing, pacing, patrolling, investigating)
- sit: sitting still (guarding, pondering, waiting, listening)
- idle: standing around (hanging out, looking around, stretching)
- lie: lying down asleep (napping, dozing, dreaming about...)
- alert: head up, watching the visitor's cursor (watching you, curious, on duty)
He never leaves his home, chases, flees, or runs offscreen, and nothing in a status may place him anywhere on the page but his home. Do not mention David's plans or opinions.

JSON only.`;

const DAY_SCHEMA = {
  name: 'pepper_day',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['mood', 'walk', 'sit', 'idle', 'lie', 'alert'],
    properties: {
      mood: { type: 'string' },
      walk: { type: 'array', items: { type: 'string' } },
      sit: { type: 'array', items: { type: 'string' } },
      idle: { type: 'array', items: { type: 'string' } },
      lie: { type: 'array', items: { type: 'string' } },
      alert: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

const TTL = 20 * 60_000;
let day: Day | null = null;
let pending: Promise<Day> | null = null;

function cleanStatuses(list: unknown, fallback: string[]): string[] {
  if (!Array.isArray(list)) return fallback;
  const out = list
    .map(s => String(s).toLowerCase().replace(/[.!?…]+$/, '').trim())
    .filter(s => s && s.length <= 28 && !/[\u{1F300}-\u{1FAFF}]/u.test(s))
    .slice(0, 4);
  return out.length ? out : fallback;
}

async function writeDay(): Promise<Day> {
  const pulse = sitePulse();
  const now = new Date();
  const user = [
    `time where David lives (US Eastern): ${now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', hour: 'numeric', minute: '2-digit' })}`,
    'visitors arrive from every timezone, so keep the mood about your day, not about it being night for everyone',
    describePulse(pulse),
  ].join('\n');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Bun.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: Bun.env.PEPPER_MODEL || 'gpt-5.2',
      messages: [{ role: 'system', content: DAY_SYSTEM }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: DAY_SCHEMA },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`openai ${res.status}`);
  const data = await res.json();
  const raw = JSON.parse(data.choices?.[0]?.message?.content || '{}');
  return {
    mood: String(raw.mood || '').slice(0, 80),
    statuses: {
      walk: cleanStatuses(raw.walk, DEFAULT_STATUSES.walk),
      sit: cleanStatuses(raw.sit, DEFAULT_STATUSES.sit),
      idle: cleanStatuses(raw.idle, DEFAULT_STATUSES.idle),
      lie: cleanStatuses(raw.lie, DEFAULT_STATUSES.lie),
      alert: cleanStatuses(raw.alert, DEFAULT_STATUSES.alert),
    },
    at: Date.now(),
  };
}

/** The current day, refreshed in the background; never blocks on the model. */
export function getDay(): Day {
  const fresh = day && Date.now() - day.at < TTL;
  if (!fresh && !pending && Bun.env.OPENAI_API_KEY) {
    pending = writeDay()
      .then(d => (day = d))
      .catch(e => { console.error('pepper day failed:', e); return day || fallbackDay(); })
      .finally(() => { pending = null; });
  }
  return day || fallbackDay();
}

function fallbackDay(): Day {
  return { mood: '', statuses: DEFAULT_STATUSES, at: 0 };
}

/** Write a new day now (tests, or to see a prompt change without waiting 20 minutes). */
export async function refreshDay(): Promise<Day> {
  if (pending) await pending;
  day = await writeDay();
  return day;
}
