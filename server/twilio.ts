const TWILIO_ACCOUNT_SID = Bun.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = Bun.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_MESSAGING_SID = Bun.env.TWILIO_MESSAGING_SID || '';
const TWILIO_TO_PHONE = Bun.env.TWILIO_TO_PHONE || '';

export async function sendSMS(message: string): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_MESSAGING_SID || !TWILIO_TO_PHONE) {
    console.warn('⚠️  Twilio configuration incomplete, skipping SMS');
    return;
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;

  const formData = new URLSearchParams();
  formData.append('To', TWILIO_TO_PHONE);
  formData.append('MessagingServiceSid', TWILIO_MESSAGING_SID);
  formData.append('Body', message);

  const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Twilio API error: ${response.status} ${error}`);
  }

  const data = await response.json();
  console.log(`SMS sent with SID: ${data.sid}`);
}
