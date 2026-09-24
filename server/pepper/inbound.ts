/**
 * Visitor replies to Pepper's email. The swarmlet.com mail Worker spools raw
 * MIME for pepper@ / pepper+<key>@ into the pepper-mail-spool R2 bucket under
 * pending/. This poller drains it: the reply key in the recipient binds the
 * message to a thread; anything without a valid key is quarantined.
 *
 * Senders are the public, so nothing here is authorization: the key only says
 * which thread the text belongs to, and the text goes to David as data.
 */
import PostalMime from 'postal-mime';
import { visitorByReplyKey } from './store';
import { visitorWroteBack } from './relay';

const POLL_MS = 30_000;
const MAX_BYTES = 256 * 1024;
const KEY_RE = /pepper\+([0-9a-f]{24})@/i;

export function isInboundConfigured(): boolean {
  return !!(Bun.env.PEPPER_R2_ACCESS_KEY_ID && Bun.env.PEPPER_R2_SECRET_ACCESS_KEY && Bun.env.PEPPER_R2_ENDPOINT);
}

function client() {
  return new Bun.S3Client({
    accessKeyId: Bun.env.PEPPER_R2_ACCESS_KEY_ID!,
    secretAccessKey: Bun.env.PEPPER_R2_SECRET_ACCESS_KEY!,
    endpoint: Bun.env.PEPPER_R2_ENDPOINT!,
    bucket: Bun.env.PEPPER_R2_BUCKET || 'pepper-mail-spool',
  });
}

/** Drop the quoted history mail clients append under a reply. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^On .{4,200}wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^_{8,}$/.test(line.trim())) break;
    if (/^From: .+/.test(line) && out.length > 0) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export interface ParsedReply {
  replyKey: string | null;
  text: string;
  skip?: string;
}

export async function parseInbound(raw: ArrayBuffer | Uint8Array): Promise<ParsedReply> {
  const email = await PostalMime.parse(raw);
  const headers = new Map(email.headers.map(h => [h.key.toLowerCase(), h.value]));
  const from = (email.from?.address || '').toLowerCase();

  if (/^(mailer-daemon|postmaster)@/.test(from) || headers.get('auto-submitted')?.toLowerCase().startsWith('auto-')) {
    return { replyKey: null, text: '', skip: 'automated' };
  }
  if (from.endsWith('@drose.io') && from.startsWith('pepper@')) {
    return { replyKey: null, text: '', skip: 'loop' };
  }

  const recipients = [
    ...(email.to || []), ...(email.cc || []),
    { address: headers.get('delivered-to') || '' }, { address: headers.get('x-original-to') || '' },
  ].map(a => ('address' in a ? a.address : '') || '').join(' ');
  const replyKey = recipients.match(KEY_RE)?.[1]?.toLowerCase() || null;

  const body = email.text || (email.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  return { replyKey, text: stripQuoted(body).slice(0, 4000) };
}

async function drainOnce(): Promise<void> {
  const s3 = client();
  const listing = await s3.list({ prefix: 'pending/', maxKeys: 50 });
  for (const obj of listing.contents || []) {
    const key = obj.key;
    const name = key.slice('pending/'.length);
    let dest = 'quarantine/';
    try {
      if ((obj.size || 0) > MAX_BYTES) throw new Error('too large');
      const raw = await s3.file(key).arrayBuffer();
      const parsed = await parseInbound(raw);
      const vid = parsed.replyKey ? visitorByReplyKey(parsed.replyKey) : null;
      if (parsed.skip) {
        console.log(`pepper inbound ${name}: skipped (${parsed.skip})`);
      } else if (vid && parsed.text) {
        await visitorWroteBack(vid, parsed.text, 'email');
        dest = 'archive/';
      } else {
        console.log(`pepper inbound ${name}: no thread for key ${parsed.replyKey}`);
      }
      await s3.write(dest + name, raw);
    } catch (error) {
      // A message that cannot be read now will not be readable next pass
      // either; park it rather than retry it every 30 seconds forever.
      console.error(`pepper inbound ${name} failed:`, error);
      try {
        await s3.write('quarantine/' + name, await s3.file(key).arrayBuffer());
      } catch {
        continue; // R2 itself is failing; leave it in pending/
      }
    }
    await s3.delete(key);
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startInboundPoller(): void {
  if (timer || !isInboundConfigured()) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await drainOnce();
    } catch (error) {
      console.error('pepper inbound poll failed:', error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, POLL_MS);
  tick();
  console.log('📬 Pepper inbound mail poller started');
}
