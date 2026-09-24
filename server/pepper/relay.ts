/**
 * Moving messages between the three parties: visitor, Pepper, David.
 *
 * Every message meant for David lands in data/threads (the inbox of record,
 * watched by Sauron) and, when the desk is configured, in the visitor's
 * Telegram topic. David's replies go back to wherever the visitor can be
 * reached: the live page (SSE), email, and their Telegram chat with Pepper.
 */
import { appendMessage, generateMessageId, setLastRead } from '../storage/threads';
import { connectionManager } from '../sse/connection-manager';
import { upsertThreadMeta, getThreadMeta, continueUrlForToken } from '../storage/thread-meta';
import { notifications } from '../notifications';
import { sendPushNotification } from '../api/push';
import { sendVisitorReplyEmail, isVisitorEmailConfigured } from '../notifications/visitor-email';
import { appendChat, ensureVisitor, updateVisitor, readChat } from './store';
import { isDeskConfigured, createTopic, postToTopic, sendPrivate } from './telegram';
import { isPepperMailConfigured, sendNoteReceipt, sendDavidReply } from './mail';

const DAY = 86_400_000;
const RELAYS_PER_VISITOR_PER_DAY = 3;
const RELAYS_GLOBAL_PER_DAY = 40;
let globalRelays: number[] = [];

export type RelayStatus = 'sent' | 'failed' | 'limited';

function underRelayLimit(vid: string): boolean {
  if (Bun.env.TEST_MODE === 'true') return true;
  const now = Date.now();
  globalRelays = globalRelays.filter(t => now - t < DAY);
  const mine = (ensureVisitor(vid).relays || []).filter(t => now - t < DAY);
  return mine.length < RELAYS_PER_VISITOR_PER_DAY && globalRelays.length < RELAYS_GLOBAL_PER_DAY;
}

function topicName(vid: string, summary: string): string {
  const s = summary.replace(/\s+/g, ' ').trim();
  return (s || `visitor ${vid.slice(0, 6)}`).slice(0, 120);
}

async function ensureTopic(vid: string, summary: string): Promise<number> {
  const v = ensureVisitor(vid);
  if (v.topicId) return v.topicId;
  const topicId = await createTopic(topicName(vid, summary));
  updateVisitor(vid, { topicId });
  return topicId;
}

export async function relayToDavid(opts: {
  vid: string;
  message: string;
  summary: string;
  page: string;
  referrer?: string;
}): Promise<RelayStatus> {
  const { vid, message, summary, page } = opts;
  if (!underRelayLimit(vid)) return 'limited';

  appendMessage(vid, { id: generateMessageId(), from: 'visitor', text: message, ts: Date.now(), page });
  upsertThreadMeta(vid);
  const v = ensureVisitor(vid);
  updateVisitor(vid, {
    relays: [...(v.relays || []), Date.now()].slice(-20),
    summary: summary || v.summary,
    referrer: opts.referrer || v.referrer,
  });
  globalRelays.push(Date.now());

  const chatTurns = readChat(vid).filter(e => e.from === 'visitor').length;
  const briefing = [
    '🐾 Someone is asking for you.',
    summary ? `Wants: ${summary}` : null,
    opts.referrer ? `Came from: ${opts.referrer}` : null,
    `Page: ${page}`,
    `Chat so far: ${chatTurns} message${chatTurns === 1 ? '' : 's'} with Pepper`,
    '',
    `“${message}”`,
    '',
    'Reply in this topic and Pepper delivers it.',
  ].filter(l => l !== null).join('\n');

  try {
    if (isDeskConfigured()) {
      const topicId = await ensureTopic(vid, summary);
      await postToTopic(topicId, briefing);
    } else {
      await notifications.sendAll(`💬 Pepper relayed a message\n\n${summary}\n\n"${message}"`);
      await sendPushNotification('Pepper relayed a message', message, vid);
    }
    return 'sent';
  } catch (error) {
    // The thread write above already succeeded, so the message is not lost:
    // it is in the inbox and Sauron's stale-unread watchdog will surface it.
    console.error('pepper relay notify failed:', error);
    return 'failed';
  }
}

export async function recordContact(vid: string, email: string): Promise<void> {
  const meta = upsertThreadMeta(vid, { contactEmail: email });
  const v = ensureVisitor(vid);
  const lastNote = [...readChat(vid)].reverse().find(e => e.from === 'visitor' && e.relay === 'sent');
  if (isPepperMailConfigured() && lastNote) {
    try {
      await sendNoteReceipt({
        to: email,
        replyKey: v.replyKey,
        note: lastNote.text,
        continueUrl: continueUrlForToken(meta.continueToken),
      });
    } catch (error) {
      console.error('pepper receipt email failed:', error);
    }
  }
  if (isDeskConfigured() && v.topicId) {
    await postToTopic(v.topicId, `✉️ They left an email: ${email}. Your replies go there too.`).catch(e =>
      console.error('pepper topic post failed:', e));
  }
}

/** A visitor wrote back by email or Telegram: straight to David, no model. */
export async function visitorWroteBack(vid: string, text: string, via: 'email' | 'telegram'): Promise<void> {
  appendMessage(vid, { id: generateMessageId(), from: 'visitor', text, ts: Date.now(), page: `(${via})` });
  appendChat(vid, { from: 'visitor', text, ts: Date.now(), via, relay: 'sent' });
  try {
    if (isDeskConfigured()) {
      const topicId = await ensureTopic(vid, ensureVisitor(vid).summary || '');
      await postToTopic(topicId, `(${via}) ${text}`);
    } else {
      await notifications.sendAll(`💬 Visitor wrote back by ${via}\n\n"${text}"`);
    }
  } catch (error) {
    console.error('pepper write-back notify failed:', error);
  }
}

export interface DeliveryReport {
  messageId: string;
  live: boolean;
  email: 'sent' | 'failed' | 'none';
  telegram: 'sent' | 'failed' | 'none';
}

/** David answered (from Telegram or /admin). Deliver everywhere we can. */
export async function deliverDavidReply(vid: string, text: string): Promise<DeliveryReport> {
  const message = { id: generateMessageId(), from: 'david' as const, text, ts: Date.now() };
  appendMessage(vid, message); // also pushes to the live page over SSE
  appendChat(vid, { from: 'david', text, ts: message.ts });
  setLastRead(vid, message.id);

  const report: DeliveryReport = { messageId: message.id, live: connectionManager.getVisitorCount(vid) > 0, email: 'none', telegram: 'none' };
  const meta = getThreadMeta(vid);
  const v = ensureVisitor(vid);

  if (meta?.contactEmail && (isPepperMailConfigured() || isVisitorEmailConfigured())) {
    try {
      if (isPepperMailConfigured()) {
        await sendDavidReply({
          to: meta.contactEmail,
          replyKey: v.replyKey,
          reply: text,
          continueUrl: continueUrlForToken(meta.continueToken),
        });
      } else {
        const r = await sendVisitorReplyEmail({ to: meta.contactEmail, replyText: text, continueUrl: continueUrlForToken(meta.continueToken) });
        if (!r.sent) throw new Error('visitor email not configured');
      }
      report.email = 'sent';
    } catch (error) {
      console.error('pepper reply email failed:', error);
      report.email = 'failed';
    }
  }

  if (v.telegramChatId) {
    try {
      await sendPrivate(v.telegramChatId, `*drops letter* david wrote back:\n\n${text}\n\n— David`);
      report.telegram = 'sent';
    } catch (error) {
      console.error('pepper telegram delivery failed:', error);
      report.telegram = 'failed';
    }
  }
  return report;
}
