import type { Context } from 'hono';
import { sendSMS } from './twilio';

// Simple in-memory rate limiting
const rateLimits = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string, maxRequests = 10, windowMs = 3600000): boolean {
  const now = Date.now();
  const limit = rateLimits.get(ip);

  if (!limit || now > limit.resetAt) {
    rateLimits.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (limit.count >= maxRequests) {
    return false;
  }

  limit.count++;
  return true;
}

export async function handleFeedback(c: Context) {
  try {
    const body = await c.req.json();
    const { type, text, page } = body;

    // Get IP for rate limiting
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';

    // Rate limit check
    if (!checkRateLimit(ip)) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }

    // Log feedback
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      type,
      text: text || null,
      page: page || 'unknown',
      ip: ip.split(',')[0], // First IP if multiple
    };

    console.log('📝 Feedback received:', JSON.stringify(logEntry));

    // Send SMS for text messages (not just pings)
    if (type === 'message' && text) {
      try {
        await sendSMS(`💬 drose.io feedback from ${page}:\n\n${text}`);
        console.log('📱 SMS sent successfully');
      } catch (error) {
        console.error('❌ SMS failed:', error);
        // Don't fail the request if SMS fails
      }
    }

    // Get today's ping count (simple demo - resets on restart)
    const todayKey = new Date().toISOString().split('T')[0];
    const countKey = `count-${todayKey}`;
    let count = parseInt(Bun.env[countKey] || '0');
    count++;
    Bun.env[countKey] = count.toString();

    return c.json({
      success: true,
      count: type === 'ping' ? count : undefined,
    });
  } catch (error) {
    console.error('Error handling feedback:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
}
