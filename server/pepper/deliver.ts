/**
 * The one place that knows every channel. Messages move three ways:
 *
 *   visitor -> David   relayToDavid / visitorWroteBack: into the conversation
 *                      file, then to David's Telegram desk topic.
 *   David -> visitor   deliverDavidReply: live page (SSE), email, and the
 *                      visitor's own Telegram, whichever they have.
 *
 * If the desk is not configured or Telegram is down, nothing is lost: the
 * relay is in the conversation file and Sauron's stale-unread watchdog
 * (GET /api/admin/inbox/health) pages David about it.
 */
import { append, read, ensureVisitor, getVisitor, updateVisitor, relayCount, messages, type RelayStatus } from './conversation';
import { isEmailConfigured, sendEmail, noteReceipt, davidReplyEmail } from './email';
import { isTelegramConfigured, topicFor, postToDesk, sendToVisitor } from './telegram';

const DAY = 86_400_000;
const RELAYS_PER_VISITOR_PER_DAY = 5; // write-backs count too
const RELAYS_GLOBAL_PER_DAY = 40;
const WRITE_BACKS_PER_VISITOR_PER_DAY = 10; // counts every note, first relay included
let globalRelays: number[] = [];

export const continueUrl = (token: string) =>
  `${(Bun.env.PUBLIC_BASE_URL || 'https://drose.io').replace(/\/$/, '')}/m/${token}`;

// ---- live page: SSE connections per visitor ---------------------------------

type Push = (event: string, data: unknown) => void;
const live = new Map<string, Set<Push>>();

export function connectLive(id: string, push: Push): () => void {
  if (!live.has(id)) live.set(id, new Set());
  live.get(id)!.add(push);
  return () => {
    live.get(id)?.delete(push);
    if (!live.get(id)?.size) live.delete(id);
  };
}

export function liveStats() {
  let total = 0;
  for (const set of live.values()) total += set.size;
  return { visitors: live.size, total };
}

// ---- visitor -> David -------------------------------------------------------

export async function relayToDavid(opts: { id: string; message: string; summary: string; page: string; referrer?: string }): Promise<RelayStatus> {
  const { id, message, summary, page } = opts;
  const now = Date.now();
  globalRelays = globalRelays.filter(t => now - t < DAY);
  const limited = Bun.env.TEST_MODE !== 'true'
    && (relayCount(id, now - DAY) >= RELAYS_PER_VISITOR_PER_DAY || globalRelays.length >= RELAYS_GLOBAL_PER_DAY);
  if (limited) {
    append(id, { kind: 'relay', summary, message, status: 'limited', ts: now });
    return 'limited';
  }
  globalRelays.push(now);
  const v = updateVisitor(id, { summary: summary || getVisitor(id)?.summary, referrer: opts.referrer || getVisitor(id)?.referrer });

  const chatTurns = messages(id).filter(m => m.from === 'visitor').length;
  const lines = ['🐾 Someone is asking for you.'];
  if (summary) lines.push(`Wants: ${summary.replace(/\s+/g, ' ')}`);
  if (v.referrer) lines.push(`Came from: ${v.referrer}`);
  lines.push(`Page: ${page}`, `Chat so far: ${chatTurns} message${chatTurns === 1 ? '' : 's'} with Pepper`);
  lines.push('', `“${message}”`, '', 'Reply in this topic and Pepper delivers it.');
  const briefing = lines.join('\n');

  // 'sent' means David's phone got it. Without the desk it is still saved and
  // Sauron's stale-unread watchdog will surface it, but it was not delivered.
  let status: RelayStatus = 'failed';
  if (isTelegramConfigured()) {
    try {
      await postToDesk(await topicFor(id, summary), briefing);
      status = 'sent';
    } catch (error) {
      console.error('pepper relay to desk failed:', error);
    }
  } else {
    console.warn('pepper relay saved, but the Telegram desk is not configured');
  }
  // The relay event is what puts this visitor in David's inbox, so it is
  // written even when the desk post failed.
  append(id, { kind: 'relay', summary, message, status, ts: Date.now() });
  return status;
}

/** The visitor left an email: remember it, send a receipt quoting their note, tell David. */
export async function recordContact(id: string, email: string): Promise<void> {
  const v = updateVisitor(id, { email });
  append(id, { kind: 'contact', email, ts: Date.now() });
  const lastNote = read(id).filter(e => e.kind === 'relay' && e.status === 'sent').at(-1) as { message: string } | undefined;
  if (isEmailConfigured() && lastNote) {
    await sendEmail({ to: email, token: v.token, ...noteReceipt(lastNote.message, continueUrl(v.token)) })
      .catch(e => console.error('pepper receipt email failed:', e));
  }
  if (isTelegramConfigured() && v.topicId) {
    await postToDesk(v.topicId, `✉️ They left an email: ${email}. Your replies go there too.`)
      .catch(e => console.error('pepper desk post failed:', e));
  }
}

/** The visitor wrote back by email or Telegram: straight to David, no model involved. */
export async function visitorWroteBack(id: string, text: string, via: 'email' | 'telegram'): Promise<RelayStatus> {
  const now = Date.now();
  append(id, { kind: 'message', from: 'visitor', text, ts: now, via });
  globalRelays = globalRelays.filter(t => now - t < DAY);
  if (Bun.env.TEST_MODE !== 'true'
    && (relayCount(id, now - DAY) >= WRITE_BACKS_PER_VISITOR_PER_DAY || globalRelays.length >= RELAYS_GLOBAL_PER_DAY)) {
    append(id, { kind: 'relay', summary: `wrote back by ${via}`, message: text, status: 'limited', ts: now });
    return 'limited';
  }
  globalRelays.push(now);
  let status: RelayStatus = 'failed';
  if (isTelegramConfigured()) {
    try {
      await postToDesk(await topicFor(id, getVisitor(id)?.summary || ''), `(${via}) ${text}`);
      status = 'sent';
    } catch (error) {
      console.error('pepper write-back to desk failed:', error);
    }
  }
  append(id, { kind: 'relay', summary: `wrote back by ${via}`, message: text, status, ts: Date.now() });
  return status;
}

// ---- David -> visitor -------------------------------------------------------

export interface Delivery {
  live: boolean;
  email: 'sent' | 'failed' | 'none';
  telegram: 'sent' | 'failed' | 'none';
}

export async function deliverDavidReply(id: string, text: string): Promise<Delivery> {
  const ts = Date.now();
  append(id, { kind: 'message', from: 'david', text, ts });
  const v = ensureVisitor(id);
  const report: Delivery = { live: false, email: 'none', telegram: 'none' };

  for (const push of live.get(id) || []) {
    push('david', { text, ts });
    report.live = true;
  }
  if (v.email && isEmailConfigured()) {
    try {
      await sendEmail({ to: v.email, token: v.token, ...davidReplyEmail(text, continueUrl(v.token)) });
      report.email = 'sent';
    } catch (error) {
      console.error('pepper reply email failed:', error);
      report.email = 'failed';
    }
  }
  if (v.telegramChatId && isTelegramConfigured()) {
    try {
      await sendToVisitor(v.telegramChatId, `*drops letter* david wrote back:\n\n${text}\n\n— David`);
      report.telegram = 'sent';
    } catch (error) {
      console.error('pepper telegram delivery failed:', error);
      report.telegram = 'failed';
    }
  }
  return report;
}
