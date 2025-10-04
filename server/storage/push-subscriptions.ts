import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const isTestMode = Bun.env.TEST_MODE === 'true';
const PUSH_DIR = Bun.env.PUSH_DIR || (isTestMode ? './data/push/test' : './data/push');
const SUBSCRIPTIONS_FILE = join(PUSH_DIR, 'subscriptions.jsonl');

// Ensure directory exists
if (!existsSync(PUSH_DIR)) {
  mkdirSync(PUSH_DIR, { recursive: true });
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  expirationTime?: number | null;
  createdAt: number;
  lastUsed: number;
}

/**
 * Load all push subscriptions from disk
 */
function loadSubscriptions(): Map<string, PushSubscription> {
  const subscriptions = new Map<string, PushSubscription>();

  if (!existsSync(SUBSCRIPTIONS_FILE)) {
    return subscriptions;
  }

  try {
    const content = readFileSync(SUBSCRIPTIONS_FILE, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const sub = JSON.parse(line) as PushSubscription;
        subscriptions.set(sub.endpoint, sub);
      } catch (error) {
        console.error('Failed to parse push subscription line:', error);
      }
    }
  } catch (error) {
    console.error('Failed to load push subscriptions:', error);
  }

  return subscriptions;
}

/**
 * Save all subscriptions to disk
 */
function saveSubscriptions(subscriptions: Map<string, PushSubscription>): void {
  try {
    const lines = Array.from(subscriptions.values())
      .map(sub => JSON.stringify(sub))
      .join('\n');

    writeFileSync(SUBSCRIPTIONS_FILE, lines + '\n', 'utf-8');
  } catch (error) {
    console.error('Failed to save push subscriptions:', error);
  }
}

// In-memory cache, lazy-loaded
let subscriptionsCache: Map<string, PushSubscription> | null = null;

function getSubscriptionsCache(): Map<string, PushSubscription> {
  if (!subscriptionsCache) {
    subscriptionsCache = loadSubscriptions();
  }
  return subscriptionsCache;
}

/**
 * Add or update a push subscription
 */
export function addSubscription(subscription: any): void {
  const cache = getSubscriptionsCache();

  const pushSub: PushSubscription = {
    endpoint: subscription.endpoint,
    keys: subscription.keys,
    expirationTime: subscription.expirationTime || null,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  cache.set(pushSub.endpoint, pushSub);
  saveSubscriptions(cache);
}

/**
 * Remove a push subscription (e.g., after 410 Gone)
 */
export function removeSubscription(endpoint: string): void {
  const cache = getSubscriptionsCache();

  if (cache.delete(endpoint)) {
    saveSubscriptions(cache);
  }
}

/**
 * Get all active push subscriptions
 */
export function getAllSubscriptions(): PushSubscription[] {
  const cache = getSubscriptionsCache();
  return Array.from(cache.values());
}

/**
 * Update last used timestamp for a subscription
 */
export function touchSubscription(endpoint: string): void {
  const cache = getSubscriptionsCache();
  const sub = cache.get(endpoint);

  if (sub) {
    sub.lastUsed = Date.now();
    saveSubscriptions(cache);
  }
}

/**
 * Prune old/unused subscriptions (optional cleanup)
 */
export function pruneOldSubscriptions(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): number {
  const cache = getSubscriptionsCache();
  const now = Date.now();
  let pruned = 0;

  for (const [endpoint, sub] of cache.entries()) {
    if (now - sub.lastUsed > maxAgeMs) {
      cache.delete(endpoint);
      pruned++;
    }
  }

  if (pruned > 0) {
    saveSubscriptions(cache);
  }

  return pruned;
}
