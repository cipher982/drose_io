import { Hono } from 'hono';
import { isValidVisitorId, isBlocked } from '../storage/threads';
import { getThreadMeta, isValidEmail, getVisitorIdByContinueToken } from '../storage/thread-meta';
import { loadVisitor } from '../lib/visitor-memory';
import { appendChat, readChat, getVisitor, updateVisitor, visitorByTopic, visitorByTelegramChat } from './store';
import { pepperReply, isLlmConfigured } from './llm';
import { relayToDavid, recordContact, visitorWroteBack, deliverDavidReply } from './relay';
import { tg, deepLink, postToTopic, sendPrivate, isDeskConfigured } from './telegram';

const app = new Hono();

// ---- rate limits: per visitor, per IP, and a global daily fuse on model calls
const WINDOW = 10 * 60_000;
const hits = new Map<string, number[]>();
let dayStart = Date.now();
let dayCount = 0;
const DAILY_MODEL_CALLS = Number(Bun.env.PEPPER_DAILY_LIMIT || 2000);

function limited(key: string, max: number): boolean {
  if (Bun.env.TEST_MODE === 'true') return false;
  const now = Date.now();
  const list = (hits.get(key) || []).filter(t => now - t < WINDOW);
  if (list.length >= max) return true;
  list.push(now);
  hits.set(key, list);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) {
    const kept = v.filter(t => now - t < WINDOW);
    kept.length ? hits.set(k, kept) : hits.delete(k);
  }
}, 5 * 60_000).unref?.();

function modelBudgetLeft(): boolean {
  if (Date.now() - dayStart > 86_400_000) { dayStart = Date.now(); dayCount = 0; }
  return dayCount++ < DAILY_MODEL_CALLS;
}

function clientIp(c: any): string {
  return c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function telegramLinkFor(vid: string): string | null {
  const meta = getThreadMeta(vid);
  return meta ? deepLink(meta.continueToken) : null;
}

function situation(vid: string, page: string): string {
  const v = getVisitor(vid);
  const meta = getThreadMeta(vid);
  return [
    'SITUATION (from the server, not the visitor):',
    `- visitor is on page: ${page}`,
    `- local time for David's server: ${new Date().toUTCString()}`,
    `- messages already carried to david: ${v?.relays?.length || 0}`,
    `- visitor email on file: ${meta?.contactEmail ? 'yes' : 'no'}`,
    `- visitor linked telegram: ${v?.telegramChatId ? 'yes' : 'no'}`,
  ].join('\n');
}

app.post('/chat', async (c) => {
  const body = await c.req.json().catch(() => null);
  const vid = String(body?.visitorId || '');
  const text = String(body?.text || '').trim();
  const page = String(body?.page || '/').slice(0, 200);
  const via = body?.via === 'option' ? 'option' : 'typed';

  if (!isValidVisitorId(vid)) return c.json({ error: 'invalid visitorId' }, 400);
  if (!text || text.length > 1000) return c.json({ error: 'text must be 1-1000 characters' }, 400);
  if (isBlocked(vid)) return c.json({ error: 'blocked', say: '*tilt* ...' }, 403);
  if (limited(`v:${vid}`, 20) || limited(`ip:${clientIp(c)}`, 60)) {
    return c.json({ error: 'rate limited', say: "whoa, slow down! my paws can't type that fast *pant*" }, 429);
  }

  appendChat(vid, { from: 'visitor', text, ts: Date.now(), via });

  if (!isLlmConfigured() || !modelBudgetLeft()) {
    return c.json({ error: 'unavailable', say: "my nose isn't working right now. try again in a bit? *yawn*" }, 503);
  }

  let reply;
  try {
    reply = await pepperReply(readChat(vid), situation(vid, page));
  } catch (error) {
    console.error('pepper chat failed:', error);
    return c.json({ error: 'model failed', say: 'i lost my train of thought. say that again? *tilt*' }, 502);
  }

  let relayStatus: 'sent' | 'failed' | 'limited' | null = null;
  if (reply.relay) {
    const memory = await loadVisitor(vid).catch(() => null);
    relayStatus = await relayToDavid({
      vid,
      message: reply.relay.message,
      summary: reply.relay.summary,
      page,
      referrer: memory?.referrers?.at(-1),
    });
    if (relayStatus === 'limited') {
      reply.say = "i've already carried a few notes to david today and i don't want to bury him. try again tomorrow? *tilt*";
      reply.options = [];
    }
  }

  // After the relay, so a receipt email can quote the note just carried.
  if (reply.contact_email) await recordContact(vid, reply.contact_email);

  appendChat(vid, { from: 'pepper', text: reply.say, ts: Date.now(), options: reply.options, relay: relayStatus || undefined });
  const contactEmail = getThreadMeta(vid)?.contactEmail || null;

  return c.json({
    say: reply.say,
    options: reply.options,
    relay: relayStatus ? { status: relayStatus } : null,
    askContact: relayStatus === 'sent' && !contactEmail,
    telegramLink: relayStatus === 'sent' ? telegramLinkFor(vid) : null,
    contactEmail,
  });
});

app.get('/history', (c) => {
  const vid = c.req.query('visitorId') || '';
  if (!isValidVisitorId(vid)) return c.json({ error: 'invalid visitorId' }, 400);
  const v = getVisitor(vid);
  const relayed = !!v?.relays?.length;
  return c.json({
    messages: readChat(vid).map(({ from, text, ts }) => ({ from, text, ts })),
    contactEmail: getThreadMeta(vid)?.contactEmail || null,
    relayed,
    telegramLink: relayed ? telegramLinkFor(vid) : null,
  });
});

app.post('/contact', async (c) => {
  const body = await c.req.json().catch(() => null);
  const vid = String(body?.visitorId || '');
  const email = String(body?.email || '').trim().toLowerCase();
  if (!isValidVisitorId(vid)) return c.json({ error: 'invalid visitorId' }, 400);
  if (!isValidEmail(email)) return c.json({ error: "that doesn't look like an email address" }, 400);
  if (limited(`contact:${vid}`, 5)) return c.json({ error: 'too many tries, wait a few minutes' }, 429);
  await recordContact(vid, email);
  return c.json({ ok: true, email });
});

// ---- Telegram webhook -------------------------------------------------------

export async function handleTelegramUpdate(update: any): Promise<void> {
  const msg = update?.message;
  if (!msg?.chat) return;
  const text: string = (msg.text || msg.caption || '').trim();

  // David, in Pepper's Desk.
  if (msg.chat.id === tg.deskChatId()) {
    if (msg.from?.id !== tg.davidUserId() || !text) return;
    const topicId = msg.message_thread_id;
    const vid = topicId ? visitorByTopic(topicId) : null;
    if (!vid) return; // General topic or an unknown one: not a reply
    const report = await deliverDavidReply(vid, text);
    const where = [report.live && 'on the site', report.email === 'sent' && 'by email', report.telegram === 'sent' && 'on telegram']
      .filter(Boolean).join(', ');
    const failed = [report.email === 'failed' && 'email', report.telegram === 'failed' && 'telegram'].filter(Boolean).join(', ');
    await postToTopic(topicId, where
      ? `✓ delivered ${where}${failed ? ` (failed: ${failed})` : ''}`
      : `saved to the thread. they're not on the site and left no email or telegram, so they'll see it only if they come back.${failed ? ` (failed: ${failed})` : ''}`);
    return;
  }

  // A visitor, privately.
  if (msg.chat.type !== 'private') return;
  const chatId: number = msg.chat.id;
  const start = text.match(/^\/start(?:\s+([A-Za-z0-9_-]{16,64}))?$/);
  if (start) {
    const vid = start[1] ? getVisitorIdByContinueToken(start[1]) : null;
    if (!vid) {
      await sendPrivate(chatId, "hi! i'm pepper, david's dog. come say hi at https://drose.io and i'll carry messages to him from there *wag*");
      return;
    }
    updateVisitor(vid, { telegramChatId: chatId });
    await sendPrivate(chatId, "hi! it's pepper *wag* your note is with david. when he writes back i'll bring it here. anything else for him? just type it.");
    const v = getVisitor(vid);
    if (isDeskConfigured() && v?.topicId) await postToTopic(v.topicId, '📱 They connected Telegram. Your replies reach them there too.');
    return;
  }
  const vid = visitorByTelegramChat(chatId);
  if (!vid) {
    await sendPrivate(chatId, "hi! i'm pepper. find me at https://drose.io and tell me what to carry to david *tilt*");
    return;
  }
  if (!text) return;
  await visitorWroteBack(vid, text.slice(0, 4000), 'telegram');
  await sendPrivate(chatId, 'carried it to david *wag*');
}

app.post('/telegram', async (c) => {
  const secret = tg.webhookSecret();
  if (!secret || c.req.header('x-telegram-bot-api-secret-token') !== secret) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const update = await c.req.json().catch(() => null);
  // Answer Telegram immediately; a slow SES call must not trigger its retries.
  handleTelegramUpdate(update).catch(e => console.error('pepper telegram update failed:', e));
  return c.json({ ok: true });
});

export default app;

