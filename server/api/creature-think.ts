import { Hono } from 'hono';
import { loadVisitor, validateVid } from '../lib/visitor-memory';
import { PEPPER_SYSTEM_PROMPT, buildPrompt, type ThinkContext } from '../lib/pepper-prompt';

const app = new Hono();

interface ThinkRequest {
  vid: string;
  trigger: 'page_load' | 'click' | 'idle' | 'leaving';
  context: {
    currentPage: string;
    timeOnPage: number;
    hour: number;
  };
}

interface ThinkResponse {
  thought: string;
  mood: 'happy' | 'curious' | 'tired' | 'excited' | 'sleepy';
}

// Rate limiting: per-vid AND per-IP to prevent abuse
const vidRequestTimes = new Map<string, number[]>();
const ipRequestTimes = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_PER_VID = 10; // max per visitor
const RATE_LIMIT_PER_IP = 30; // max per IP (allows multiple tabs)
const GLOBAL_DAILY_LIMIT = 1000; // circuit breaker
let globalDailyCount = 0;
let lastDayReset = Date.now();

// Prune old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of vidRequestTimes) {
    const filtered = times.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (filtered.length === 0) vidRequestTimes.delete(key);
    else vidRequestTimes.set(key, filtered);
  }
  for (const [key, times] of ipRequestTimes) {
    const filtered = times.filter(t => now - t < RATE_LIMIT_WINDOW);
    if (filtered.length === 0) ipRequestTimes.delete(key);
    else ipRequestTimes.set(key, filtered);
  }
}, 300000);

function checkRateLimit(vid: string, ip: string): { limited: boolean; reason?: string } {
  const now = Date.now();

  // Reset daily counter
  if (now - lastDayReset > 86400000) {
    globalDailyCount = 0;
    lastDayReset = now;
  }

  // Global circuit breaker
  if (globalDailyCount >= GLOBAL_DAILY_LIMIT) {
    return { limited: true, reason: 'daily limit' };
  }

  // Per-VID limit
  const vidTimes = vidRequestTimes.get(vid) || [];
  const recentVidTimes = vidTimes.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (recentVidTimes.length >= RATE_LIMIT_PER_VID) {
    return { limited: true, reason: 'vid limit' };
  }

  // Per-IP limit (prevents vid rotation abuse)
  const ipTimes = ipRequestTimes.get(ip) || [];
  const recentIpTimes = ipTimes.filter(t => now - t < RATE_LIMIT_WINDOW);
  if (recentIpTimes.length >= RATE_LIMIT_PER_IP) {
    return { limited: true, reason: 'ip limit' };
  }

  // Record this request
  recentVidTimes.push(now);
  recentIpTimes.push(now);
  vidRequestTimes.set(vid, recentVidTimes);
  ipRequestTimes.set(ip, recentIpTimes);
  globalDailyCount++;

  return { limited: false };
}

app.post('/think', async (c) => {
  // Get client IP (handles proxies like Cloudflare/Coolify)
  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';

  let body: ThinkRequest;
  try {
    body = await c.req.json<ThinkRequest>();
  } catch {
    return c.json({ error: 'invalid json' }, 400);
  }

  const { vid, trigger, context } = body;

  // Validate vid
  const safeVid = validateVid(vid);
  if (!safeVid) {
    return c.json({ error: 'invalid vid' }, 400);
  }

  // Validate trigger
  if (!['page_load', 'click', 'idle', 'leaving'].includes(trigger)) {
    return c.json({ error: 'invalid trigger' }, 400);
  }

  // Rate limit (per-vid + per-IP + global)
  const rateCheck = checkRateLimit(safeVid, ip);
  if (rateCheck.limited) {
    return c.json({ error: 'rate limited', reason: rateCheck.reason }, 429);
  }

  try {
    // Load visitor data
    const visitor = await loadVisitor(safeVid);

    // Build prompt
    const thinkContext: ThinkContext = {
      trigger,
      visitor,
      currentPage: context?.currentPage?.slice(0, 200) || '/',
      timeOnPage: Math.min(context?.timeOnPage || 0, 3600),
      hour: context?.hour ?? new Date().getHours(),
    };

    const userPrompt = buildPrompt(thinkContext);

    // Call LLM
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      return c.json({ error: 'llm not configured' }, 503);
    }

    // Timeout for LLM request
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-5-nano',
        messages: [
          { role: 'system', content: PEPPER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        reasoning: { effort: 'low' },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('OpenAI error:', response.status, await response.text());
      return c.json({ error: 'llm error' }, 502);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return c.json({ error: 'empty response' }, 502);
    }

    // Parse JSON response
    try {
      const parsed = JSON.parse(content) as ThinkResponse;

      // Validate and sanitize (enforce 50 char limit)
      const thought = (parsed.thought || '').slice(0, 50);
      const mood = ['happy', 'curious', 'tired', 'excited', 'sleepy'].includes(parsed.mood)
        ? parsed.mood
        : 'curious';

      return c.json({ thought, mood });
    } catch {
      // LLM didn't return valid JSON, extract text
      const thought = content.slice(0, 50).replace(/[{}"]/g, '').trim();
      return c.json({ thought, mood: 'curious' });
    }

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return c.json({ error: 'timeout' }, 504);
    }
    console.error('Think error:', error);
    return c.json({ error: 'internal error' }, 500);
  }
});

export default app;
