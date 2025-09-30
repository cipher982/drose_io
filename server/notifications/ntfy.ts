import type { Notifier } from './notifier';

export class NtfyNotifier implements Notifier {
  private server: string;
  private topic: string;

  constructor() {
    this.server = Bun.env.NTFY_SERVER || 'https://ntfy.sh';
    this.topic = Bun.env.NTFY_TOPIC || '';
  }

  getName(): string {
    return 'ntfy';
  }

  isConfigured(): boolean {
    return !!this.topic;
  }

  async send(message: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('ntfy not configured');
    }

    const url = `${this.server}/${this.topic}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Title': 'drose.io Feedback',
        'Priority': 'default',
        'Tags': 'speech_balloon',
      },
      body: message,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ntfy error: ${response.status} ${error}`);
    }

    console.log(`🔔 ntfy notification sent to ${this.topic}`);
  }
}
