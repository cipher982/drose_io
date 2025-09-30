import type { Notifier } from './notifier';

export class TwilioNotifier implements Notifier {
  private accountSid: string;
  private authToken: string;
  private messagingSid: string;
  private toPhone: string;

  constructor() {
    this.accountSid = Bun.env.TWILIO_ACCOUNT_SID || '';
    this.authToken = Bun.env.TWILIO_AUTH_TOKEN || '';
    this.messagingSid = Bun.env.TWILIO_MESSAGING_SID || '';
    this.toPhone = Bun.env.TWILIO_TO_PHONE || '';
  }

  getName(): string {
    return 'Twilio';
  }

  isConfigured(): boolean {
    return !!(this.accountSid && this.authToken && this.messagingSid && this.toPhone);
  }

  async send(message: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('Twilio not configured');
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

    const formData = new URLSearchParams();
    formData.append('To', this.toPhone);
    formData.append('MessagingServiceSid', this.messagingSid);
    formData.append('Body', message);

    const auth = btoa(`${this.accountSid}:${this.authToken}`);

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
    console.log(`📱 Twilio SMS sent with SID: ${data.sid}`);
  }
}
