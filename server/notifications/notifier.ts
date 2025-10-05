/**
 * Abstract notification interface
 */
export interface Notifier {
  /**
   * Send a notification message
   * @param message The message content
   * @returns Promise that resolves when sent
   */
  send(message: string): Promise<void>;

  /**
   * Check if this notifier is properly configured
   */
  isConfigured(): boolean;

  /**
   * Get the name of this notifier
   */
  getName(): string;
}
