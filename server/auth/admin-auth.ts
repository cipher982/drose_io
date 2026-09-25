import type { Context } from 'hono';

// No password configured means no admin access, never a default.
const adminPassword = Bun.env.ADMIN_PASSWORD || '';

export function extractAuthPassword(c: Context): string | null {
  const header = c.req.header('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.substring('Bearer '.length);
  }

  return null;
}

export function isValidAdminPassword(password: string | null): boolean {
  if (!password || !adminPassword) {
    return false;
  }

  return password === adminPassword;
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
