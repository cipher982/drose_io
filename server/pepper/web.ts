/**
 * Every HTTP route Pepper has. Mounted at /api/pepper in server/index.ts,
 * plus two root-level handlers exported below (/m/:token, inbox health).
 *
 *   POST /hello             page load: remember the visit, return a one-line thought
 *   GET  /day               Pepper's current mood and status lines (day.ts)
 *   GET  /fleet             David's agents right now, public repos only (fleet.ts)
 *   GET  /world             the dog house (world.ts); POST /world/give hands him an item
 *   POST /chat              visitor says something; Pepper answers (maybe relays)
 *   GET  /history           the visitor's conversation for the chat panel
 *   POST /contact           visitor leaves an email for David's reply
 *   GET  /stream            SSE; event 'david' when David replies
 *   POST /email/:secret     SNS -> inbound email (see email.ts)
 *   POST /telegram          Telegram webhook (see telegram.ts)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';
import { append, read, messages, getVisitor, ensureVisitor, visitorByToken, isValidVisitorId, isValidEmail, inboxHealth, safePage } from './conversation';
import { askPepper, isModelConfigured } from './pepper';
import { relayToDavid, recordContact, connectLive } from './deliver';
import { handleEmailWebhook } from './email';
import { handleTelegramWebhook, deepLink } from './telegram';
import { handleHello, loadMemory } from './hello';
import { getDay } from './day';
import { getFleet } from './fleet';
import { project, needs, describeWorld, give, suggest, fromLabel, marksBy, ITEMS, COLORS, DECOR, COLORED, type World } from './world';

const app = new Hono();

// ---- rate limits: per visitor, per IP, and a daily fuse on model calls ------

const WINDOW = 10 * 60_000;
const hits = new Map<string, number[]>();
const DAILY_MODEL_CALLS = Number(Bun.env.PEPPER_DAILY_LIMIT || 2000);
let day = { start: Date.now(), calls: 0 };

function limited(key: string, max: number): boolean {
  if (Bun.env.TEST_MODE === 'true') return false;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter(t => now - t < WINDOW);
  if (recent.length >= max) return true;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) hits.clear(); // crude bound; a flood just resets the window
  return false;
}

function modelBudgetLeft(): boolean {
  if (Date.now() - day.start > 86_400_000) day = { start: Date.now(), calls: 0 };
  return day.calls++ < DAILY_MODEL_CALLS;
}

const clientIp = (c: Context) =>
  c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

// Gifts to the dog house, per IP per day. The per-visitor cap in world.ts is
// easy to dodge with a fresh visitor id; this one is not.
const GIFTS_PER_IP_PER_DAY = 8;
let gifts = { day: '', byIp: new Map<string, number>() };
function giftAllowed(c: Context): boolean {
  if (Bun.env.TEST_MODE === 'true') return true;
  const today = new Date().toISOString().slice(0, 10);
  if (gifts.day !== today) gifts = { day: today, byIp: new Map() };
  const ip = clientIp(c);
  const n = gifts.byIp.get(ip) || 0;
  if (n >= GIFTS_PER_IP_PER_DAY) return false;
  gifts.byIp.set(ip, n + 1);
  return true;
}

const relayed = (id: string) => read(id).some(e => e.kind === 'relay' && e.status !== 'limited');

const DAYS = (ms: number) => Math.floor(ms / 86_400_000);

/** What Pepper remembers about this visitor: how well he knows them, and their marks on his house. */
async function remembered(id: string): Promise<string[]> {
  const m = await loadMemory(id).catch(() => null);
  const visits = m?.visits || 0;
  const since = m ? DAYS(Date.now() - Date.parse(m.lastVisit)) : 0;
  const lines = [visits <= 1 ? '- this looks like their first visit' : visits > 10 ? '- a regular; you know them well' : `- they've been by before${since >= 1 ? `, last ${since === 1 ? 'yesterday' : `${since} days ago`}` : ''}`];
  const marks = marksBy(id);
  if (marks.length) lines.push(`- on your dog house: ${marks.join('; ')}`);
  return lines;
}

async function situation(id: string, page: string): Promise<string> {
  const v = getVisitor(id);
  return [
    'SITUATION (from the server, not the visitor):',
    `- visitor is on page: ${page}`,
    `- server time: ${new Date().toUTCString()}`,
    `- notes already carried to david: ${read(id).filter(e => e.kind === 'relay' && e.status === 'sent').length}`,
    `- visitor email on file: ${v?.email ? 'yes' : 'no'}`,
    `- visitor linked telegram: ${v?.telegramChatId ? 'yes' : 'no'}`,
    '',
    'THIS VISITOR (see MEMORY):',
    ...(await remembered(id)),
    '',
    'DOG HOUSE RIGHT NOW:',
    describeWorld(),
  ].join('\n');
}

// ---- chat -------------------------------------------------------------------

app.post('/chat', async (c) => {
  const body = await c.req.json().catch(() => null);
  const id = String(body?.visitorId || '');
  const text = String(body?.text || '').trim();
  const page = safePage(body?.page);
  const via = body?.via === 'option' ? 'option' : 'web';

  if (!isValidVisitorId(id)) return c.json({ error: 'invalid visitorId' }, 400);
  if (!text || text.length > 1000) return c.json({ error: 'text must be 1-1000 characters', say: "that's a lot for a small dog. can you keep it under 1000 characters? *tilt*" }, 400);
  if (limited(`v:${id}`, 20) || limited(`ip:${clientIp(c)}`, 60)) {
    return c.json({ error: 'rate limited', say: "whoa, slow down! my paws can't type that fast *pant*" }, 429);
  }

  append(id, { kind: 'message', from: 'visitor', text, ts: Date.now(), via });
  // Failures still answer in Pepper's voice, and the answer is kept so a
  // reload shows the same conversation the visitor saw.
  const fail = (status: 502 | 503, say: string) => {
    append(id, { kind: 'message', from: 'pepper', text: say, ts: Date.now() });
    return c.json({ error: status === 503 ? 'unavailable' : 'model failed', say }, status);
  };
  if (!isModelConfigured() || !modelBudgetLeft()) return fail(503, "my nose isn't working right now. try again in a bit? *yawn*");

  let reply;
  try {
    reply = await askPepper(read(id), await situation(id, page));
  } catch (error) {
    console.error('pepper chat failed:', error);
    return fail(502, 'i lost my train of thought. say that again? *tilt*');
  }

  let relayStatus = null;
  if (reply.relay) {
    const memory = await loadMemory(id).catch(() => null);
    relayStatus = await relayToDavid({ id, ...reply.relay, page, referrer: memory?.referrers?.at(-1) });
    if (relayStatus === 'limited') {
      reply.say = "i've already carried a few notes to david today and i don't want to bury him. try again tomorrow? *tilt*";
      reply.options = [];
    }
  }
  // The dog house: rules and limits are in world.ts; the model only proposed.
  let worldResult: { text: string; built: boolean } | null = null;
  if (reply.world) {
    const from = fromLabel(body?.timezone);
    const r = !giftAllowed(c) ? { ok: false as const, reason: 'limited' as const } : reply.world.action === 'give'
      ? give(id, from, reply.world.item, reply.world.color)
      : suggest(id, from, reply.world.target, reply.world.value);
    if (r.ok) {
      const built = 'built' in r && !!r.built && (r.built as any).source === r.event.id; // he used *their* gift
      const what = reply.world.action === 'give'
        ? `visitor gave ${reply.world.color ? reply.world.color + ' ' : ''}${reply.world.item}${built ? ' and pepper used it right away' : ''}`
        : `visitor suggested ${reply.world.target.replace('_', ' ')}: ${reply.world.value}`;
      append(id, { kind: 'world', text: what, ts: Date.now() });
      worldResult = { text: what, built };
    } else {
      reply.say = r.reason === 'limited'
        ? "that's so kind, but you've already helped a lot today. come back tomorrow? *wag*"
        : r.reason === 'full' ? "i've got plenty of those already! maybe something else? *tilt*"
          : "hmm, i can't use that one. i can use planks, bricks, shingles, paint, or little decorations *tilt*";
    }
  }

  // After the relay, so the receipt email can quote the note just carried.
  if (reply.contact_email) await recordContact(id, reply.contact_email);

  append(id, { kind: 'message', from: 'pepper', text: reply.say, ts: Date.now(), options: reply.options });
  const email = getVisitor(id)?.email || null;
  return c.json({
    say: reply.say,
    options: reply.options,
    relay: relayStatus ? { status: relayStatus } : null,
    askContact: relayStatus === 'sent' && !email,
    telegramLink: relayStatus === 'sent' ? deepLink(ensureVisitor(id).token) : null,
    contactEmail: email,
    world: worldResult ? { ...worldResult, state: publicWorld(id) } : null,
  });
});

app.get('/history', (c) => {
  const id = c.req.query('visitorId') || '';
  if (!isValidVisitorId(id)) return c.json({ error: 'invalid visitorId' }, 400);
  const v = getVisitor(id);
  const wasRelayed = relayed(id);
  return c.json({
    messages: messages(id).map(({ from, text, ts }) => ({ from, text, ts })),
    contactEmail: v?.email || null,
    relayed: wasRelayed,
    telegramLink: wasRelayed && v ? deepLink(v.token) : null,
  });
});

app.post('/contact', async (c) => {
  const body = await c.req.json().catch(() => null);
  const id = String(body?.visitorId || '');
  const email = String(body?.email || '').trim().toLowerCase();
  if (!isValidVisitorId(id)) return c.json({ error: 'invalid visitorId' }, 400);
  if (!isValidEmail(email)) return c.json({ error: "that doesn't look like an email address" }, 400);
  if (limited(`contact:${id}`, 5)) return c.json({ error: 'too many tries, wait a few minutes' }, 429);
  await recordContact(id, email);
  return c.json({ ok: true, email });
});

app.get('/stream', (c) => {
  const id = c.req.query('visitorId') || '';
  if (!isValidVisitorId(id)) return c.json({ error: 'invalid visitorId' }, 400);
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache');
  return streamSSE(c, async (stream) => {
    const disconnect = connectLive(id, (event, data) => {
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {});
    });
    const keepAlive = setInterval(() => stream.writeSSE({ event: 'ping', data: '' }).catch(() => {}), 15000);
    await new Promise<void>(resolve => c.req.raw.signal.addEventListener('abort', () => resolve()));
    clearInterval(keepAlive);
    disconnect();
  });
});

app.post('/hello', handleHello);
app.get('/day', (c) => {
  const d = getDay();
  c.header('Cache-Control', 'public, max-age=60');
  return c.json({ mood: d.mood, statuses: d.statuses });
});
// ---- the dog house --------------------------------------------------------------

function publicWorld(visitorId?: string, w: World = project()) {
  const { version, paused, parts, complete, completedAt, wallMaterial, wallColor, roofColor, doorColor, roofStyle, pile, decor, wishlist, ideas, helpers, recent, lastBuild } = w;
  return { version, paused, parts, complete, completedAt, wallMaterial, wallColor, roofColor, doorColor, roofStyle, pile, decor, wishlist, ideas, helpers, recent, lastBuild, needs: needs(w), yours: visitorId ? marksBy(visitorId) : [] };
}

app.get('/world', (c) => {
  c.header('Cache-Control', 'no-cache');
  const id = c.req.query('visitorId') || '';
  return c.json({ ...publicWorld(isValidVisitorId(id) ? id : undefined), catalog: { items: ITEMS, colors: COLORS, decor: DECOR, colored: COLORED } });
});

app.post('/world/give', async (c) => {
  const body = await c.req.json().catch(() => null);
  const id = String(body?.visitorId || '');
  if (!isValidVisitorId(id)) return c.json({ error: 'invalid visitorId' }, 400);
  if (limited(`ip:${clientIp(c)}`, 60)) return c.json({ error: 'rate limited' }, 429);
  if (!giftAllowed(c)) return c.json({ ok: false, reason: 'limited', state: publicWorld(id) });
  const r = give(id, fromLabel(body?.timezone), body?.item, body?.color);
  if (!r.ok) return c.json({ ok: false, reason: r.reason, state: publicWorld(id) }, r.reason === 'invalid' ? 400 : 200);
  const usedIt = (r.built as any)?.source === r.event.id; // he used *their* gift, not something already in the pile
  const text = `visitor gave ${(r.event as any).color ? (r.event as any).color + ' ' : ''}${(r.event as any).item}${usedIt ? ' and pepper used it right away' : ''}`;
  append(id, { kind: 'world', text, ts: Date.now() });
  return c.json({ ok: true, built: usedIt, state: publicWorld(id) });
});

app.get('/fleet', async (c) => {
  c.header('Cache-Control', 'public, max-age=30');
  return c.json(await getFleet());
});
app.post('/email/:secret', handleEmailWebhook);
app.post('/telegram', handleTelegramWebhook);

export default app;

// ---- root-level routes ------------------------------------------------------

/** GET /m/:token — the continue link in Pepper's emails: restore the visitor and open the chat. */
export function continuePage(c: Context) {
  const token = c.req.param('token') || '';
  const id = /^[0-9a-f]{24}$/i.test(token) ? visitorByToken(token) : null;
  if (!id) return c.redirect('/?pepper=open', 302);
  const html = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Pepper</title>
<script>try{localStorage.setItem('__vid',${JSON.stringify(id)})}catch(e){}document.cookie='__vid=${id};path=/;max-age=315360000;samesite=lax';location.replace('/?pepper=open')</script>
<a href="/?pepper=open">Continue to drose.io</a>`;
  return c.html(html, 200, { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
}

/** GET /api/admin/inbox/health — Sauron's stale-unread watchdog. */
export function inboxHealthRoute(c: Context) {
  if (!isValidAdminPassword(extractAuthPassword(c))) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(inboxHealth());
}
