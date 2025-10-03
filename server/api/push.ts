import type { Context } from 'hono';
import webpush from 'web-push';

// VAPID keys for web push
// In production, generate these once and store in env vars:
// npx web-push generate-vapid-keys
const vapidPublicKey = Bun.env.VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = Bun.env.VAPID_PRIVATE_KEY || '';
const vapidEmail = Bun.env.VAPID_EMAIL || 'mailto:david@drose.io';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidEmail, vapidPublicKey, vapidPrivateKey);
}

// Store push subscriptions in memory (in production, use database)
const pushSubscriptions = new Map<string, any>();

/**
 * Subscribe to push notifications (admin only)
 * POST /api/admin/push-subscribe
 */
export async function subscribeToPush(c: Context) {
  try {
    // Check auth
    const authHeader = c.req.header('authorization');
    const adminPassword = Bun.env.ADMIN_PASSWORD || 'changeme';

    if (!authHeader || authHeader !== `Bearer ${adminPassword}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const subscription = await c.req.json();

    // Store subscription (keyed by endpoint for now)
    pushSubscriptions.set(subscription.endpoint, subscription);

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
export async function sendPushNotification(title: string, message: string, visitorId: string) {
  if (!vapidPublicKey || !vapidPrivateKey) {
    console.log('⚠️  VAPID keys not configured, skipping push notification');
    return;
  }

  const payload = JSON.stringify({
    title,
    message,
    visitorId,
  });

  const promises: Promise<any>[] = [];

  for (const [endpoint, subscription] of pushSubscriptions.entries()) {
    const promise = webpush.sendNotification(subscription, payload)
      .catch((error: any) => {
        console.error('❌ Push notification failed for:', endpoint.substring(0, 50), error.message);

        // Remove invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          pushSubscriptions.delete(endpoint);
          console.log('🗑️  Removed invalid subscription');
        }
      });

    promises.push(promise);
  }

  await Promise.allSettled(promises);
  console.log('📤 Push notifications sent:', promises.length);
}
