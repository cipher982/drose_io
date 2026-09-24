/**
 * Pepper's Telegram side: David's "Pepper's Desk" group (one forum topic per
 * relayed visitor) and private chats with visitors who tapped the deep link.
 *
 * Config (all optional; without a token the desk is simply off):
 *   PEPPER_TELEGRAM_BOT_TOKEN, PEPPER_TELEGRAM_BOT_USERNAME
 *   PEPPER_TELEGRAM_DESK_CHAT_ID   the private supergroup with Topics enabled
 *   PEPPER_TELEGRAM_DAVID_USER_ID  only this user's desk messages count as David
 *   PEPPER_TELEGRAM_WEBHOOK_SECRET checked on every webhook call
 */

export const tg = {
  token: () => Bun.env.PEPPER_TELEGRAM_BOT_TOKEN || '',
  username: () => Bun.env.PEPPER_TELEGRAM_BOT_USERNAME || '',
  deskChatId: () => Number(Bun.env.PEPPER_TELEGRAM_DESK_CHAT_ID || 0),
  davidUserId: () => Number(Bun.env.PEPPER_TELEGRAM_DAVID_USER_ID || 0),
  webhookSecret: () => Bun.env.PEPPER_TELEGRAM_WEBHOOK_SECRET || '',
};

export function isDeskConfigured(): boolean {
  return !!(tg.token() && tg.deskChatId() && tg.davidUserId());
}

export async function tgCall<T = any>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${tg.token()}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description || res.status}`);
  return data.result as T;
}

/** t.me deep link that binds a visitor's Telegram to their thread. */
export function deepLink(startToken: string): string | null {
  const u = tg.username();
  return u && tg.token() ? `https://t.me/${u}?start=${startToken}` : null;
}

export async function createTopic(name: string): Promise<number> {
  const topic = await tgCall<{ message_thread_id: number }>('createForumTopic', {
    chat_id: tg.deskChatId(),
    name: name.slice(0, 128),
  });
  return topic.message_thread_id;
}

export async function postToTopic(topicId: number, text: string): Promise<void> {
  await tgCall('sendMessage', {
    chat_id: tg.deskChatId(),
    message_thread_id: topicId,
    text: text.slice(0, 4000),
    link_preview_options: { is_disabled: true },
  });
}

export async function sendPrivate(chatId: number, text: string): Promise<void> {
  await tgCall('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), link_preview_options: { is_disabled: true } });
}

/** Register the webhook. Idempotent; called at boot when a public URL is set. */
export async function ensureWebhook(url: string): Promise<void> {
  await tgCall('setWebhook', {
    url,
    secret_token: tg.webhookSecret() || undefined,
    allowed_updates: ['message'],
  });
}
