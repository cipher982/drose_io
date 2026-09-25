/**
 * Pepper on Telegram. Two kinds of chat:
 *
 * - David's desk: a private supergroup with Topics ("Pepper's Desk"). Each
 *   visitor who reached David gets a topic. David replying in a topic is how he
 *   answers that visitor. This is his only inbox.
 * - Visitors, privately: a visitor who taps t.me/<bot>?start=<token> links
 *   their Telegram to their conversation; David's replies arrive there and
 *   anything they send goes to David.
 *
 * One webhook, POST /api/pepper/telegram, authenticated by Telegram's
 * X-Telegram-Bot-Api-Secret-Token header (= PEPPER_TELEGRAM_WEBHOOK_SECRET, its own
 * secret: the email webhook's secret sits in a URL, so it must not open this door).
 */
import type { Context } from 'hono';
import { getVisitor, updateVisitor, append, visitorByToken, visitorByTopic, visitorByTelegramChat } from './conversation';
import { deliverDavidReply, visitorWroteBack } from './deliver';
import * as world from './world';

const cfg = {
  token: () => Bun.env.PEPPER_TELEGRAM_BOT_TOKEN || '',
  username: () => Bun.env.PEPPER_TELEGRAM_BOT_USERNAME || '',
  desk: () => Number(Bun.env.PEPPER_TELEGRAM_DESK_CHAT_ID || 0),
  david: () => Number(Bun.env.PEPPER_TELEGRAM_DAVID_USER_ID || 0),
};

export function isTelegramConfigured(): boolean {
  return !!(cfg.token() && cfg.desk() && cfg.david());
}

async function call<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description || res.status}`);
  return data.result as T;
}

export function deepLink(token: string): string | null {
  return cfg.token() && cfg.username() ? `https://t.me/${cfg.username()}?start=${token}` : null;
}

/** The visitor's desk topic, created the first time they reach David. */
export async function topicFor(id: string, name: string): Promise<number> {
  const existing = getVisitor(id)?.topicId;
  if (existing) return existing;
  const topic = await call<{ message_thread_id: number }>('createForumTopic', {
    chat_id: cfg.desk(),
    name: (name.replace(/\s+/g, ' ').trim() || `visitor ${id.slice(0, 6)}`).slice(0, 120),
  });
  updateVisitor(id, { topicId: topic.message_thread_id });
  return topic.message_thread_id;
}

export async function postToDesk(topicId: number, text: string): Promise<void> {
  await call('sendMessage', { chat_id: cfg.desk(), message_thread_id: topicId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } });
}

export async function sendToVisitor(chatId: number, text: string): Promise<void> {
  await call('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } });
}

export async function registerWebhook(url: string): Promise<void> {
  await call('setWebhook', { url, secret_token: Bun.env.PEPPER_TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'] });
}

// ---- David's commands in the General topic ----------------------------------------

async function sendDesk(text: string): Promise<void> {
  await call('sendMessage', { chat_id: cfg.desk(), text: text.slice(0, 4000), link_preview_options: { is_disabled: true } });
}

async function deskCommand(text: string): Promise<void> {
  const [cmd, ...args] = text.trim().split(/\s+/);
  if (cmd === '/world') {
    const w = world.project();
    const log = world.events().filter(e => e.kind !== 'undo').slice(-8)
      .map(e => `${e.id} ${e.kind} ${'item' in e ? e.item : 'part' in e ? e.part : 'target' in e ? `${e.target}=${e.value}` : ''}`.trim());
    await sendDesk(`${world.describeWorld(w)}\n\nrecent events:\n${log.join('\n')}\n\n/undo <id> · /pause · /resume · /give <item> [color]`);
  } else if (cmd === '/undo' && args[0]) {
    await sendDesk(world.undo(args[0]) ? `undone: ${args[0]}` : `no event ${args[0]}`);
  } else if (cmd === '/pause' || cmd === '/resume') {
    world.setPaused(cmd === '/pause');
    await sendDesk(cmd === '/pause' ? 'pepper put his tools down.' : 'pepper is back to work.');
  } else if (cmd === '/give' && args[0]) {
    const r = world.give('david', 'david', args[0], args[1]);
    await sendDesk(r.ok ? `gave ${args.join(' ')}${r.built ? ' (he used it right away)' : ''}` : `couldn't: ${r.reason}`);
  }
}

// ---- inbound ----------------------------------------------------------------

export async function handleUpdate(update: any): Promise<void> {
  const msg = update?.message;
  if (!msg?.chat) return;
  const text: string = (msg.text || msg.caption || '').trim();

  // David, in his desk. Only his messages, only inside a visitor's topic.
  if (msg.chat.id === cfg.desk()) {
    if (msg.from?.id !== cfg.david() || !text) return;
    if (!msg.message_thread_id) { await deskCommand(text); return; }
    const id = visitorByTopic(msg.message_thread_id);
    if (!id) return;
    const r = await deliverDavidReply(id, text);
    const reached = [r.live && 'on the site', r.email === 'sent' && 'by email', r.telegram === 'sent' && 'on telegram'].filter(Boolean);
    const failed = [r.email === 'failed' && 'email', r.telegram === 'failed' && 'telegram'].filter(Boolean);
    await postToDesk(msg.message_thread_id, (reached.length
      ? `✓ delivered ${reached.join(', ')}`
      : "saved. they're not on the site and left no email or telegram, so they'll see it if they come back.")
      + (failed.length ? ` (failed: ${failed.join(', ')})` : ''));
    return;
  }

  if (msg.chat.type !== 'private') return;
  const chatId: number = msg.chat.id;

  const start = text.match(/^\/start(?:\s+([0-9a-f]{24}))?$/i);
  if (start) {
    const id = start[1] ? visitorByToken(start[1]) : null;
    if (!id) {
      await sendToVisitor(chatId, "hi! i'm pepper, david's dog. come say hi at https://drose.io and i'll carry messages to him from there *wag*");
      return;
    }
    updateVisitor(id, { telegramChatId: chatId });
    append(id, { kind: 'telegram-linked', ts: Date.now() });
    await sendToVisitor(chatId, "hi! it's pepper *wag* when david writes back i'll bring it here. anything else for him? just type it.");
    const topicId = getVisitor(id)?.topicId;
    if (topicId && isTelegramConfigured()) await postToDesk(topicId, '📱 They connected Telegram. Your replies reach them there too.');
    return;
  }

  const id = visitorByTelegramChat(chatId);
  if (!id) {
    await sendToVisitor(chatId, "hi! i'm pepper. find me at https://drose.io and tell me what to carry to david *tilt*");
    return;
  }
  if (!text) return;
  const status = await visitorWroteBack(id, text.slice(0, 4000), 'telegram');
  await sendToVisitor(chatId,
    status === 'sent' ? 'carried it to david *wag*'
      : status === 'limited' ? "that's a lot of notes for one day. david will see the ones i already carried *tilt*"
        : "my paws slipped, but it's saved. david will still see it *tilt*");
}

/** POST /api/pepper/telegram */
export async function handleTelegramWebhook(c: Context) {
  const secret = Bun.env.PEPPER_TELEGRAM_WEBHOOK_SECRET;
  if (!secret || c.req.header('x-telegram-bot-api-secret-token') !== secret) return c.json({ error: 'forbidden' }, 403);
  const update = await c.req.json().catch(() => null);
  // Answer Telegram immediately so a slow SES call cannot trigger its retries.
  handleUpdate(update).catch(e => console.error('pepper telegram update failed:', e));
  return c.json({ ok: true });
}
