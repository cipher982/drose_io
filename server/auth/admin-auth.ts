import { createHash, timingSafeEqual } from 'crypto';
import type { Context, Next } from 'hono';

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function extractAuthPassword(c: Context): string | null {
  const header = c.req.header('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.substring('Bearer '.length);
  }

  return null;
}

export function isValidAdminPassword(password: string | null): boolean {
  // No password configured means no admin access, never a default.
  const adminPassword = Bun.env.ADMIN_PASSWORD || '';
  if (!password || !adminPassword) {
    return false;
  }

  return timingSafeEqual(sha256(password), sha256(adminPassword));
}

const ADMIN_AUTH_WINDOW_MS = 15 * 60_000;
const ADMIN_AUTH_MAX_FAILURES = 10;
const MAX_ADMIN_AUTH_IPS = 2000;
const failedAdminAuth = new Map<string, number[]>();

function adminClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

export async function adminAuthRateLimit(c: Context, next: Next) {
  const ip = adminClientIp(c);
  const now = Date.now();
  const recent = (failedAdminAuth.get(ip) || []).filter(t => now - t < ADMIN_AUTH_WINDOW_MS);
  if (recent.length >= ADMIN_AUTH_MAX_FAILURES) {
    failedAdminAuth.set(ip, recent);
    c.header('Retry-After', String(Math.ceil(ADMIN_AUTH_WINDOW_MS / 1000)));
    return c.json({ error: 'Too many failed authentication attempts' }, 429);
  }

  await next();

  if (c.res.status === 401) {
    recent.push(now);
    if (!failedAdminAuth.has(ip) && failedAdminAuth.size >= MAX_ADMIN_AUTH_IPS) {
      for (const [k, timestamps] of failedAdminAuth) {
        if (timestamps.every(t => now - t >= ADMIN_AUTH_WINDOW_MS)) failedAdminAuth.delete(k);
      }
      while (failedAdminAuth.size >= MAX_ADMIN_AUTH_IPS) {
        const oldest = failedAdminAuth.keys().next().value;
        if (oldest === undefined) break;
        failedAdminAuth.delete(oldest);
      }
    }
    if (failedAdminAuth.has(ip)) failedAdminAuth.delete(ip);
    failedAdminAuth.set(ip, recent);
  } else if (c.res.status >= 200 && c.res.status < 300) {
    failedAdminAuth.delete(ip);
  }
}

export function requireAdmin(c: Context): boolean {
  const password = extractAuthPassword(c);
  if (!isValidAdminPassword(password)) {
    c.status(401);
    c.json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}
