import type { Notifier } from './notifier';
import { TwilioNotifier } from './twilio';
import { NtfyNotifier } from './ntfy';

/**
 * Notification manager that handles multiple notification channels
 */
class NotificationManager {
  private notifiers: Notifier[] = [];

  constructor() {
    // Register all available notifiers
    this.register(new TwilioNotifier());
    this.register(new NtfyNotifier());
  }

  /**
   * Register a notifier
   */
  register(notifier: Notifier): void {
    this.notifiers.push(notifier);
  }

  /**
   * Get all configured notifiers
   */
  getConfigured(): Notifier[] {
    return this.notifiers.filter(n => n.isConfigured());
  }

  /**
   * Send notification to all configured channels
   * Continues even if some fail
   */
  async sendAll(message: string): Promise<void> {
    const configured = this.getConfigured();

    if (configured.length === 0) {
      console.warn('⚠️  No notification channels configured');
      return;
    }

    const results = await Promise.allSettled(
      configured.map(async (notifier) => {
        try {
          await notifier.send(message);
        } catch (error) {
          console.error(`❌ ${notifier.getName()} failed:`, error);
          throw error;
        }
      })
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`✅ Notifications: ${succeeded} sent, ${failed} failed`);
  }
}

// Export singleton instance
export const notifications = new NotificationManager();
