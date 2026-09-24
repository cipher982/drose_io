/**
 * Pepper's email: pepper@agents.drose.io, sent and received by AWS SES.
 *
 * Out: SES v2 SendEmail, From "Pepper <pepper@agents.drose.io>", Reply-To
 *      pepper+<token>@agents.drose.io so a reply finds its conversation.
 * In:  agents.drose.io MX -> SES receipt rule -> SNS topic -> HTTPS POST to
 *      /api/pepper/email/<PEPPER_WEBHOOK_SECRET>. The SNS message carries the
 *      raw MIME. drose.io's own MX stays with Google; nothing here touches it.
 */
import type { Context } from 'hono';
import PostalMime from 'postal-mime';
import { visitorByToken } from './conversation';
import { visitorWroteBack } from './deliver';

const FROM = () => Bun.env.PEPPER_MAIL_FROM || 'Pepper <pepper@agents.drose.io>';
const DOMAIN = 'agents.drose.io';

export function isEmailConfigured(): boolean {
  return !!(Bun.env.PEPPER_SES_ACCESS_KEY_ID && Bun.env.PEPPER_SES_SECRET_ACCESS_KEY);
}

export const replyAddress = (token: string) => `pepper+${token}@${DOMAIN}`;

// ---- outbound ---------------------------------------------------------------

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** SES v2 SendEmail with a hand-signed SigV4 request; one call does not justify the AWS SDK. */
export async function sendEmail(opts: { to: string; token: string; subject: string; text: string }): Promise<string> {
  const region = Bun.env.PEPPER_SES_REGION || 'us-east-1';
  const payload = JSON.stringify({
    FromEmailAddress: FROM(),
    Destination: { ToAddresses: [opts.to] },
    ReplyToAddresses: [replyAddress(opts.token)],
    Content: {
      Simple: {
        Subject: { Data: opts.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: opts.text, Charset: 'UTF-8' } },
      },
    },
  });
  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const signed = 'content-type;host;x-amz-date';
  const canonical = ['POST', path, '', `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`, signed, await sha256(payload)].join('\n');
  const scope = `${day}/${region}/ses/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256(canonical)].join('\n');
  let key: ArrayBuffer = await hmac(enc.encode('AWS4' + Bun.env.PEPPER_SES_SECRET_ACCESS_KEY), day);
  for (const part of [region, 'ses', 'aws4_request']) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${Bun.env.PEPPER_SES_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
    },
    body: payload,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SES ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).MessageId || '';
}

const quote = (text: string) => text.split('\n').map(l => `> ${l}`).join('\n');

export const noteReceipt = (note: string, continueUrl: string) => ({
  subject: 'Your note to David',
  text: [
    "hi! it's pepper, david's dog from drose.io.",
    '',
    'i carried your note to david. when he writes back, his reply comes to this address.',
    '',
    quote(note),
    '',
    "want to add something? just reply to this email and i'll carry it over.",
    `or pick up the chat on the site: ${continueUrl}`,
    '',
    '— pepper',
  ].join('\n'),
});

export const davidReplyEmail = (reply: string, continueUrl: string) => ({
  subject: 'Re: Your note to David',
  text: [
    'david wrote back:',
    '',
    reply,
    '',
    '— David',
    '',
    '---',
    'reply to this email and pepper will carry it back to him,',
    `or continue on the site: ${continueUrl}`,
  ].join('\n'),
});

// ---- inbound ----------------------------------------------------------------

/** Drop the quoted history mail clients append under a reply. */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim();
    if (/^>/.test(t) || /^On .{4,200}wrote:$/.test(t) || /^-{2,}\s*Original Message\s*-{2,}/i.test(t) || /^_{8,}$/.test(t)) break;
    if (/^From: .+/.test(line) && out.length > 0) break;
    out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const TOKEN_RE = /pepper\+([0-9a-f]{24})@agents\.drose\.io/i;

export interface InboundEmail {
  token: string | null;
  text: string;
  skip?: 'automated' | 'loop';
}

/** Raw MIME plus the envelope recipients SES saw. */
export async function parseEmail(raw: string, recipients: string[] = []): Promise<InboundEmail> {
  const email = await PostalMime.parse(raw);
  const headers = new Map(email.headers.map(h => [h.key.toLowerCase(), h.value]));
  const from = (email.from?.address || '').toLowerCase();
  if (/^(mailer-daemon|postmaster)@/.test(from) || /^auto-/i.test(headers.get('auto-submitted') || '')) {
    return { token: null, text: '', skip: 'automated' };
  }
  if (from.endsWith(`@${DOMAIN}`)) return { token: null, text: '', skip: 'loop' };

  const addresses = [...recipients, ...(email.to || []).map(a => a.address || ''), ...(email.cc || []).map(a => a.address || '')].join(' ');
  const token = addresses.match(TOKEN_RE)?.[1]?.toLowerCase() || null;
  const body = email.text || (email.html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  return { token, text: stripQuoted(body).slice(0, 4000) };
}

/**
 * POST /api/pepper/email/:secret — SNS delivers SES-received mail here.
 * The secret in the path is the authentication; the TopicArn check guards the
 * one-time subscription confirmation.
 */
export async function handleEmailWebhook(c: Context) {
  const secret = Bun.env.PEPPER_WEBHOOK_SECRET;
  if (!secret || c.req.param('secret') !== secret) return c.json({ error: 'forbidden' }, 403);

  const sns = await c.req.json().catch(() => null) as any;
  if (!sns?.Type) return c.json({ error: 'not an SNS message' }, 400);
  if (sns.TopicArn !== Bun.env.PEPPER_SNS_TOPIC_ARN) return c.json({ error: 'unexpected topic' }, 403);

  if (sns.Type === 'SubscriptionConfirmation') {
    const url = new URL(sns.SubscribeURL);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.amazonaws.com')) return c.json({ error: 'bad SubscribeURL' }, 400);
    await fetch(url);
    console.log('📬 Pepper email: SNS subscription confirmed');
    return c.json({ ok: true });
  }
  if (sns.Type !== 'Notification') return c.json({ ok: true });

  // Answer SNS right away; processing failures are logged, not retried.
  handleNotification(sns.Message).catch(e => console.error('pepper inbound email failed:', e));
  return c.json({ ok: true });
}

export async function handleNotification(message: string): Promise<void> {
  const n = JSON.parse(message);
  const receipt = n.receipt || {};
  if (receipt.spamVerdict?.status === 'FAIL' || receipt.virusVerdict?.status === 'FAIL') {
    console.log('pepper inbound email dropped: spam/virus verdict');
    return;
  }
  if (!n.content) {
    console.error('pepper inbound email has no content (SES action must use SNS with full content)');
    return;
  }
  const parsed = await parseEmail(n.content, receipt.recipients || []);
  if (parsed.skip) {
    console.log(`pepper inbound email skipped (${parsed.skip})`);
    return;
  }
  const id = parsed.token ? visitorByToken(parsed.token) : null;
  if (!id || !parsed.text) {
    console.log(`pepper inbound email: no conversation for token ${parsed.token}`);
    return;
  }
  await visitorWroteBack(id, parsed.text, 'email');
}
