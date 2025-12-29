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

// Rate limiting: simple in-memory tracker
const requestTimes = new Map<string, number[]>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window

function isRateLimited(vid: string): boolean {
  const now = Date.now();
  const times = requestTimes.get(vid) || [];
  const recentTimes = times.filter(t => now - t < RATE_LIMIT_WINDOW);
  requestTimes.set(vid, recentTimes);

  if (recentTimes.length >= RATE_LIMIT_MAX) {
    return true;
  }
  recentTimes.push(now);
  return false;
}

app.post('/think', async (c) => {
  try {
    const body = await c.req.json<ThinkRequest>();
    const { vid, trigger, context } = body;

    // Validate
    const safeVid = validateVid(vid);
    if (!safeVid) {
      return c.json({ error: 'invalid vid' }, 400);
    }

    if (!['page_load', 'click', 'idle', 'leaving'].includes(trigger)) {
      return c.json({ error: 'invalid trigger' }, 400);
    }

    // Rate limit
    if (isRateLimited(safeVid)) {
      return c.json({ error: 'rate limited' }, 429);
    }

    // Load visitor data
    const visitor = await loadVisitor(safeVid);

    // Build prompt
    const thinkContext: ThinkContext = {
      trigger,
      visitor,
      currentPage: context.currentPage?.slice(0, 200) || '/',
      timeOnPage: Math.min(context.timeOnPage || 0, 3600),
      hour: context.hour ?? new Date().getHours(),
    };

    const userPrompt = buildPrompt(thinkContext);

    // Call LLM
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('OPENAI_API_KEY not set');
      return c.json({ error: 'llm not configured' }, 503);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: PEPPER_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.9,
        max_tokens: 100,
      }),
    });

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

      // Validate and sanitize
      const thought = (parsed.thought || '').slice(0, 60);
      const mood = ['happy', 'curious', 'tired', 'excited', 'sleepy'].includes(parsed.mood)
        ? parsed.mood
        : 'curious';

      return c.json({ thought, mood });
    } catch {
      // LLM didn't return valid JSON, extract text
      const thought = content.slice(0, 60).replace(/[{}"]/g, '').trim();
      return c.json({ thought, mood: 'curious' });
    }

  } catch (error) {
    console.error('Think error:', error);
    return c.json({ error: 'internal error' }, 500);
  }
});

export default app;
