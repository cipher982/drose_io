/**
 * Every HTTP route Pepper has. Mounted at /api/pepper in server/index.ts,
 * plus two root-level handlers exported below (/m/:token, inbox health).
 *
 *   POST /hello             page load: remember the visit, return a one-line thought
 *   GET  /day               Pepper's current mood and status lines (day.ts)
 *   GET  /fleet             David's agents right now, public repos only (fleet.ts)
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

const relayed = (id: string) => read(id).some(e => e.kind === 'relay' && e.status !== 'limited');

function situation(id: string, page: string): string {
  const v = getVisitor(id);
  return [
    'SITUATION (from the server, not the visitor):',
    `- visitor is on page: ${page}`,
    `- server time: ${new Date().toUTCString()}`,
    `- notes already carried to david: ${read(id).filter(e => e.kind === 'relay' && e.status === 'sent').length}`,
    `- visitor email on file: ${v?.email ? 'yes' : 'no'}`,
    `- visitor linked telegram: ${v?.telegramChatId ? 'yes' : 'no'}`,
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
    reply = await askPepper(read(id), situation(id, page));
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
