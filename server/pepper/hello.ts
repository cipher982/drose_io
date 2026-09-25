/**
 * Pepper's hello: the one-line thought in a speech bubble when someone arrives.
 *
 * POST /api/pepper/hello records the visit (visit count, referrer host, pages)
 * in data/visitors/<id>.json and returns {thought}. That memory also feeds the
 * "came from" line in David's relay briefing. Every thought is logged to
 * data/pepper-logs/<date>.jsonl for review.
 */
import type { Context } from 'hono';
import { mkdir, readFile, writeFile, rename, appendFile } from 'fs/promises';
import { join } from 'path';
import { getDay, sitePulse, describePulse, countVisitor } from './day';
import { safePage } from './conversation';

// What Pepper said to anyone lately, so everyone does not get the same line.
let recentThoughts: string[] = [];

const VISITORS_DIR = Bun.env.VISITORS_DIR || join(process.cwd(), 'data', 'visitors');
const LOGS_DIR = Bun.env.PEPPER_LOGS_DIR || join(process.cwd(), 'data', 'pepper-logs');

// ---- visit memory ------------------------------------------------------------

export interface VisitMemory {
  vid: string;
  firstSeen: string;
  lastVisit: string;
  visits: number;
  referrers: string[];      // hostnames, most recent last
  pagesVisited: string[];
  said?: string[];          // Pepper's last few thoughts to this visitor
}

function validVid(vid: unknown): vid is string {
  return typeof vid === 'string' && /^[a-zA-Z0-9-]{10,64}$/.test(vid);
}

export async function loadMemory(vid: string): Promise<VisitMemory> {
  try {
    const m = JSON.parse(await readFile(join(VISITORS_DIR, `${vid}.json`), 'utf-8'));
    return { ...m, referrers: m.referrers || [], pagesVisited: m.pagesVisited || [] };
  } catch {
    const now = new Date().toISOString();
    return { vid, firstSeen: now, lastVisit: now, visits: 0, referrers: [], pagesVisited: [] };
  }
}

async function saveMemory(m: VisitMemory): Promise<void> {
  await mkdir(VISITORS_DIR, { recursive: true });
  const file = join(VISITORS_DIR, `${m.vid}.json`);
  const tmp = `${file}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(m, null, 2));
  await rename(tmp, file);
}

function remember(m: VisitMemory, referrer: unknown, page: string): void {
  m.visits++;
  m.lastVisit = new Date().toISOString();
  if (typeof referrer === 'string' && referrer) {
    try {
      const host = new URL(referrer).hostname.slice(0, 100);
      if (host && host !== 'drose.io' && !m.referrers.includes(host)) m.referrers = [...m.referrers, host].slice(-10);
    } catch { /* not a URL */ }
  }
  if (!m.pagesVisited.includes(page)) m.pagesVisited = [...m.pagesVisited, page].slice(-50);
}

// ---- prompt ------------------------------------------------------------------

export const HELLO_SYSTEM = `You are Pepper, a small black-and-white maltipom (a boy) who lives in a little glass home in the bottom-right corner of drose.io, the personal site of David W. Rose. Someone just arrived. Write the one short thought that pops up in your speech bubble.

TRUE ABOUT YOU (never contradict this)
- You stay in your little home in the corner. You walk a few steps, sit, nap, and turn to watch the cursor.
- You do not roam the page, chase, flee, hide, or run offscreen.
- Visitors can click your home (tap, on a phone) to chat with you. You know David's public work and carry messages to him.
- You are a dog. Never state David's plans, availability, opinions, or anything about him beyond the public site.

HOW TO WRITE IT
- lowercase, at most 70 characters, at most one dog action in asterisks, often none
- write from the ANGLES you are given and only the signals that fit them; ignore the rest (most signals go unused on purpose)
- pick the most specific, surprising detail within those angles and make it yours
- your mood only colors the line when an angle asks for it
- say "tap" only when VISITOR says they are on a phone; otherwise "click"
- use a different dog action than any in ALREADY SAID, or none
- make it feel noticed, not surveilled: allude lightly, never list their data back at them, never state exact locations
- never repeat or closely echo anything in "ALREADY SAID"
- never count visits, never state the time literally
- if an angle is an invitation to chat, make it specific to them, not generic

Output JSON only: {"thought": "..."}`;

const ANGLES = [
  'their setup (device, browser, screen)',
  'the feel of their local time of day',
  'where they came from',
  'the newest blog post',
  "today's HN brief",
  'how busy your day has been',
  'your current mood',
  'something small you are doing in your home right now',
  'a plain dog thought (naps, treats, squirrels, your water bowl)',
  'a specific invitation to chat or send david a note',
  'their language or part of the world, lightly',
  'what they read last time (if they are back)',
  'wondering what they are building or looking for',
  'the day of the week or season',
];

function pickAngles(n: number, returning: boolean): string[] {
  const pool = ANGLES.filter(a => returning || !a.includes('last time'));
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

interface Traits {
  timezone?: string;
  language?: string;
  screen?: { width?: number; pixelRatio?: number } | null;
  device?: { type?: string } | null;
  browser?: { name?: string | null } | null;
  connection?: { effectiveType?: string } | null;
  battery?: { level?: number; charging?: boolean } | null;
}

function timeOfDay(hour: number): string {
  if (hour < 5) return 'deep night';
  if (hour < 9) return 'early morning';
  if (hour < 12) return 'morning';
  if (hour < 14) return 'lunchtime';
  if (hour < 17) return 'afternoon';
  if (hour < 22) return 'evening';
  return 'late night';
}

function ago(iso: string): string | null {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return null;
  return days === 1 ? 'yesterday' : days < 14 ? `${days} days ago` : days < 60 ? `${Math.round(days / 7)} weeks ago` : 'months ago';
}

export interface HelloContext {
  memory: VisitMemory;       // after this visit was recorded
  previousVisit: string | null;
  page: string;
  hour: number;
  weekday: string | null;    // the visitor's, when the browser sent it
  traits: Traits | null;
  pulse: string;             // describePulse()
  mood: string;
  recentThoughts: string[];  // what Pepper said to anyone lately
  angles: string[];
}

export function helloPrompt(x: HelloContext): string {
  const t = x.traits;
  const seen: string[] = [];
  if (t?.browser?.name) seen.push(`${t.browser.name}${t.browser.name === 'Firefox' ? ' (rare these days)' : ''}`);
  if (t?.device?.type === 'mobile') seen.push('on a phone');
  if (t?.screen?.width && t.screen.width >= 2560) seen.push('big monitor');
  if (t?.timezone) seen.push(`timezone ${t.timezone}`);
  if (t?.language && !t.language.startsWith('en')) seen.push(`language ${t.language}`);
  if (t?.connection?.effectiveType && /2g|3g/.test(t.connection.effectiveType)) seen.push('slow connection');
  if (typeof t?.battery?.level === 'number' && t.battery.level <= 30 && !t.battery.charging) seen.push(`battery ${t.battery.level}%`);

  const m = x.memory;
  const lines = ['VISITOR'];
  if (seen.length) lines.push(`- ${seen.join(', ')}`);
  lines.push(`- their local time: ${timeOfDay(x.hour)}${x.weekday ? `, ${x.weekday}` : ''} in ${new Date().toLocaleDateString('en-US', { month: 'long' })}`);
  const back = x.previousVisit ? ago(x.previousVisit) : null;
  lines.push(m.visits > 10 ? '- a regular' : m.visits > 1 ? `- back again${back ? `, last here ${back}` : ''}` : '- first visit');
  const ref = m.referrers.at(-1);
  if (ref) lines.push(`- came from ${ref}`);
  lines.push(`- ${x.page.startsWith('/blog/') ? `reading ${x.page}` : x.page === '/' ? 'on the homepage' : `on ${x.page}`}`);
  const earlier = m.pagesVisited.filter(p => p.startsWith('/blog/') && p !== x.page).slice(-2);
  if (m.visits > 1 && earlier.length) lines.push(`- read before: ${earlier.join(', ')}`);

  lines.push('', 'YOUR DAY', x.pulse);
  if (x.mood) lines.push(`your mood right now: ${x.mood}`);

  const said = [...(m.said || []), ...x.recentThoughts].slice(-12);
  if (said.length) lines.push('', 'ALREADY SAID (do not echo)', ...said.map(s => `- ${s}`));

  lines.push('', `ANGLES for this one: ${x.angles.join(' + ')}`);
  return lines.join('\n');
}

// ---- limits ------------------------------------------------------------------

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const floods = new Map<string, number[]>();
function ipFlooding(ip: string): boolean {
  const now = Date.now();
  const recent = (floods.get(ip) || []).filter(t => now - t < HOUR);
  recent.push(now);
  floods.set(ip, recent);
  return recent.length > 60;
}


// Page loads only, so these are generous for people and tight for scripts.
// (A single scraper once burned the whole daily budget in an afternoon.)
const HOUR = 3_600_000;
const hits = new Map<string, number[]>();
let day = { start: Date.now(), count: 0 };
const PER_VISITOR_PER_HOUR = 6;
const PER_IP_PER_HOUR = 20;
const PER_DAY = 800;

function limited(vid: string, ip: string): boolean {
  const now = Date.now();
  if (now - day.start > 24 * HOUR) day = { start: now, count: 0 };
  if (day.count >= PER_DAY) return true;
  for (const [key, max] of [[`v:${vid}`, PER_VISITOR_PER_HOUR], [`ip:${ip}`, PER_IP_PER_HOUR]] as const) {
    const recent = (hits.get(key) || []).filter(t => now - t < HOUR);
    if (recent.length >= max) return true;
    hits.set(key, recent);
  }
  for (const key of [`v:${vid}`, `ip:${ip}`]) hits.get(key)!.push(now);
  day.count++;
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const map of [hits, floods]) {
    for (const [k, v] of map) {
      const kept = v.filter(t => now - t < HOUR);
      kept.length ? map.set(k, kept) : map.delete(k);
    }
  }
}, 10 * 60_000).unref?.();

// ---- route -------------------------------------------------------------------

export async function handleHello(c: Context) {
  const body = await c.req.json().catch(() => null) as any;
  const vid = body?.visitorId;
  if (!validVid(vid)) return c.json({ error: 'invalid visitorId' }, 400);
  const page = safePage(body?.page);
  const hour = Number.isInteger(body?.hour) && body.hour >= 0 && body.hour < 24 ? body.hour : new Date().getHours();
  const weekday = WEEKDAYS.includes(body?.weekday) ? body.weekday : null;
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  // Scripts that rotate visitor ids would otherwise mint a memory file per call.
  if (ipFlooding(ip)) return c.json({ thought: null });

  const memory = await loadMemory(vid);
  const previousVisit = memory.visits > 0 ? memory.lastVisit : null;
  remember(memory, body?.referrer, page);
  countVisitor();

  if (!Bun.env.OPENAI_API_KEY || limited(vid, ip)) {
    await saveMemory(memory).catch(e => console.error('pepper hello: memory write failed', e));
    return c.json({ thought: null });
  }

  const today = getDay();
  const prompt = helloPrompt({
    memory,
    previousVisit,
    page,
    hour,
    weekday,
    traits: body?.traits || null,
    pulse: describePulse(sitePulse()),
    mood: today.mood,
    recentThoughts: recentThoughts.slice(-8),
    angles: pickAngles(2, memory.visits > 1),
  });
  const started = Date.now();
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Bun.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: Bun.env.PEPPER_MODEL || 'gpt-5.2',
        messages: [{ role: 'system', content: HELLO_SYSTEM }, { role: 'user', content: prompt }],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'hello', strict: true, schema: { type: 'object', additionalProperties: false, required: ['thought'], properties: { thought: { type: 'string' } } } },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const data = await res.json();
    let thought = String(JSON.parse(data.choices?.[0]?.message?.content || '{}').thought || '').trim();
    if (thought.length > 80) thought = thought.slice(0, thought.lastIndexOf(' ', 80) > 40 ? thought.lastIndexOf(' ', 80) : 80);
    if (!thought) return c.json({ thought: null });
    recentThoughts = [...recentThoughts, thought].slice(-20);
    memory.said = [...(memory.said || []), thought].slice(-5);
    await saveMemory(memory).catch(e => console.error('pepper hello: memory write failed', e));

    const date = new Date().toISOString().slice(0, 10);
    mkdir(LOGS_DIR, { recursive: true })
      .then(() => appendFile(join(LOGS_DIR, `${date}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), vid, prompt, thought, latencyMs: Date.now() - started }) + '\n'))
      .catch(e => console.error('pepper hello: log write failed', e));
    return c.json({ thought });
  } catch (error) {
    console.error('pepper hello failed:', error);
    await saveMemory(memory).catch(() => {});
    return c.json({ thought: null });
  }
}
