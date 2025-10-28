import type { Context } from 'hono';
import webpush from 'web-push';
import { addSubscription, removeSubscription, getAllSubscriptions, touchSubscription } from '../storage/push-subscriptions';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';

// VAPID keys for web push
// In production, generate these once and store in env vars:
// npx web-push generate-vapid-keys
const vapidPublicKey = Bun.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = Bun.env.VAPID_PRIVATE_KEY || '';
const vapidEmail = Bun.env.VAPID_EMAIL || 'mailto:david@drose.io';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

/**
 * Subscribe to push notifications (admin only)
 * POST /api/admin/push-subscribe
 */
export async function subscribeToPush(c: Context) {
  try {
    const password = extractAuthPassword(c);
    if (!isValidAdminPassword(password)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const subscription = await c.req.json();

    // Persist subscription to disk
    addSubscription(subscription);

    console.log('✅ Push subscription added:', subscription.endpoint.substring(0, 50));

    return c.json({ success: true });
  } catch (error) {
    console.error('Error subscribing to push:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}

/**
 * Get VAPID public key
 * GET /api/push/vapid-public-key
 */
export async function getVapidPublicKey(c: Context) {
  if (!vapidPublicKey) {
    return c.json({ error: 'VAPID keys not configured' }, 500);
  }

  return c.json({ publicKey: vapidPublicKey });
}

/**
 * Send push notification to all subscribers
 */
export async function sendPushNotification(title: string, message: string, visitorId: string, options?: { preview?: string; badge?: string; vibrate?: number[] }) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('⚠️  VAPID keys not configured, skipping push notification');
    return;
  }

  // Truncate message to 100 chars for notification body
  const truncatedMessage = message.length > 100 ? message.substring(0, 97) + '...' : message;

  const payload = JSON.stringify({
    title,
    message: truncatedMessage,
    preview: options?.preview || message,
    visitorId,
    badge: options?.badge,
    vibrate: options?.vibrate || [200, 100, 200],
  });

  const subscriptions = getAllSubscriptions();
  const promises: Promise<any>[] = [];

  for (const sub of subscriptions) {
    const promise = webpush.sendNotification(sub, payload)
      .then(() => {
        // Update last used timestamp on success
        touchSubscription(sub.endpoint);
      })
      .catch((error: any) => {
        console.error('❌ Push notification failed for:', sub.endpoint.substring(0, 50), error.message);

        // Remove invalid/expired subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          removeSubscription(sub.endpoint);
          console.log('🗑️  Removed invalid subscription');
        }
      });

    promises.push(promise);
  }

  await Promise.allSettled(promises);
  console.log(`📤 Push notifications sent: ${promises.length} subscriber(s)`);
}
