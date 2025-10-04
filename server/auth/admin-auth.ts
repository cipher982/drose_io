import type { Context } from 'hono';

const adminPassword = Bun.env.ADMIN_PASSWORD || 'changeme';

export function extractAuthPassword(c: Context): string | null {
  const header = c.req.header('authorization');
  if (header && header.startsWith('Bearer ')) {
    return header.substring('Bearer '.length);
  }

  // Support password via query param for SSE/EventSource usage
  const queryPassword = c.req.query('token') || c.req.query('auth');
  if (queryPassword) {
    return queryPassword;
  }

  return null;
}

export function isValidAdminPassword(password: string | null): boolean {
  if (!password) {
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
