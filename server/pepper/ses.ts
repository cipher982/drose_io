/**
 * Minimal SES v2 SendEmail over a hand-signed SigV4 request. No AWS SDK: the
 * site has no build step and one call does not justify one.
 */

export interface SesCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

export interface SesMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

const enc = new TextEncoder();

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(data));
  return toHex(hash);
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(data));
}

/** Returns the SES MessageId. Throws on any non-2xx. */
export async function sesSend(creds: SesCredentials, msg: SesMessage): Promise<string> {
  const payload = JSON.stringify({
    FromEmailAddress: msg.from,
    Destination: { ToAddresses: [msg.to] },
    ...(msg.replyTo ? { ReplyToAddresses: [msg.replyTo] } : {}),
    Content: {
      Simple: {
        Subject: { Data: msg.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: msg.text, Charset: 'UTF-8' } },
      },
    },
  });

  const { region } = creds;
  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = [
    'POST',
    path,
    '',
    `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`,
    signedHeaders,
    await sha256Hex(payload),
  ].join('\n');
  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  const kDate = await hmac(enc.encode('AWS4' + creds.secretAccessKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 'ses');
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const res = await fetch(`https://${host}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: payload,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`SES ${res.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body).MessageId || '';
  } catch {
    return '';
  }
}
