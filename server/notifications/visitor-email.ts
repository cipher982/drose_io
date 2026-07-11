/**
 * Optional SES mailer for visitor reply notifications.
 * Configure: VISITOR_MAIL_FROM, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
 * If unset, send is a no-op (continue link still works).
 */

function isConfigured(): boolean {
  return !!(
    Bun.env.VISITOR_MAIL_FROM &&
    Bun.env.AWS_ACCESS_KEY_ID &&
    Bun.env.AWS_SECRET_ACCESS_KEY &&
    (Bun.env.AWS_REGION || Bun.env.AWS_DEFAULT_REGION)
  );
}

export function isVisitorEmailConfigured(): boolean {
  return isConfigured();
}

async function hmac(key: BufferSource, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function sha256Hex(data: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Send a minimal reply notification: David's reply text + continue link only.
 */
export async function sendVisitorReplyEmail(options: {
  to: string;
  replyText: string;
  continueUrl: string;
}): Promise<{ sent: boolean; skipped?: boolean }> {
  if (!isConfigured()) {
    console.log('✉️  Visitor email skipped (SES not configured)');
    return { sent: false, skipped: true };
  }

  const region = Bun.env.AWS_REGION || Bun.env.AWS_DEFAULT_REGION || 'us-east-1';
  const from = Bun.env.VISITOR_MAIL_FROM!;
  const accessKey = Bun.env.AWS_ACCESS_KEY_ID!;
  const secretKey = Bun.env.AWS_SECRET_ACCESS_KEY!;

  const subject = 'David replied on drose.io';
  const bodyText = [
    'David replied to your message:',
    '',
    options.replyText,
    '',
    `Continue the conversation: ${options.continueUrl}`,
    '',
    '— drose.io',
  ].join('\n');

  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [options.to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: 'UTF-8' },
        Body: {
          Text: { Data: bodyText, Charset: 'UTF-8' },
        },
      },
    },
  });

  const host = `email.${region}.amazonaws.com`;
  const path = '/v2/email/outbound-emails';
  const method = 'POST';
  const service = 'ses';
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(payload);

  const canonicalHeaders =
    `content-type:application/json\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-date';
  const canonicalRequest = [
    method,
    path,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmac(new TextEncoder().encode('AWS4' + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, 'aws4_request');
  const signature = toHex(await hmac(kSigning, stringToSign));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Amz-Date': amzDate,
      Authorization: authorization,
    },
    body: payload,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`SES error ${response.status}: ${errText}`);
  }

  console.log('✉️  Visitor reply email sent to', options.to);
  return { sent: true };
}
