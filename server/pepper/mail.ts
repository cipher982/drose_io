/**
 * Pepper's email. Outbound through SES as pepper@drose.io; every message sets
 * Reply-To: pepper+<replyKey>@swarmlet.com, whose inbox is the swarmlet.com
 * mail edge (see inbound.ts). drose.io's own MX stays with Google, untouched.
 */
import { sesSend } from './ses';

const cfg = {
  from: () => Bun.env.PEPPER_MAIL_FROM || 'Pepper <pepper@drose.io>',
  replyDomain: () => Bun.env.PEPPER_REPLY_DOMAIN || 'swarmlet.com',
  creds: () => ({
    accessKeyId: Bun.env.PEPPER_SES_ACCESS_KEY_ID || '',
    secretAccessKey: Bun.env.PEPPER_SES_SECRET_ACCESS_KEY || '',
    region: Bun.env.PEPPER_SES_REGION || 'us-east-1',
  }),
};

export function isPepperMailConfigured(): boolean {
  const c = cfg.creds();
  return !!(c.accessKeyId && c.secretAccessKey);
}

export function replyAddress(replyKey: string): string {
  return `pepper+${replyKey}@${cfg.replyDomain()}`;
}

function quote(text: string): string {
  return text.split('\n').map(l => `> ${l}`).join('\n');
}

export async function sendNoteReceipt(opts: { to: string; replyKey: string; note: string; continueUrl: string }) {
  return sesSend(cfg.creds(), {
    from: cfg.from(),
    to: opts.to,
    replyTo: replyAddress(opts.replyKey),
    subject: 'Your note to David',
    text: [
      "hi! it's pepper, david's dog from drose.io.",
      '',
      "i carried your note to david. when he writes back, his reply comes to this address.",
      '',
      quote(opts.note),
      '',
      'want to add something? just reply to this email and i\'ll carry it over.',
      `or pick up the chat on the site: ${opts.continueUrl}`,
      '',
      '— pepper',
    ].join('\n'),
  });
}

export async function sendDavidReply(opts: { to: string; replyKey: string; reply: string; continueUrl: string }) {
  return sesSend(cfg.creds(), {
    from: cfg.from(),
    to: opts.to,
    replyTo: replyAddress(opts.replyKey),
    subject: 'Re: Your note to David',
    text: [
      'david wrote back:',
      '',
      opts.reply,
      '',
      '— David',
      '',
      '---',
      "reply to this email and pepper will carry it back to him,",
      `or continue on the site: ${opts.continueUrl}`,
    ].join('\n'),
  });
}
