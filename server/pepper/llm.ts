import { PEPPER_CHAT_SYSTEM, PEPPER_SCHEMA, historyForModel } from './prompt';
import type { ChatEntry } from './store';

export interface PepperReply {
  say: string;
  options: string[];
  relay: { message: string; summary: string } | null;
  contact_email: string | null;
}

const MODEL = () => Bun.env.PEPPER_MODEL || 'gpt-5.2';

export function isLlmConfigured(): boolean {
  return !!Bun.env.OPENAI_API_KEY;
}

/** Clamp model output into what the UI promises to render. */
export function sanitizeReply(raw: any): PepperReply {
  const say = String(raw?.say || '').trim().slice(0, 600) || '*tilt*';
  const options = Array.isArray(raw?.options)
    ? raw.options.map((o: unknown) => String(o).trim()).filter(Boolean).filter((o: string) => o.length <= 40).slice(0, 3)
    : [];
  const r = raw?.relay;
  const relay = r && typeof r.message === 'string' && r.message.trim()
    ? { message: r.message.trim().slice(0, 2000), summary: String(r.summary || '').trim().slice(0, 140) }
    : null;
  const email = typeof raw?.contact_email === 'string' ? raw.contact_email.trim().toLowerCase() : '';
  return { say, options, relay, contact_email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null };
}

export async function pepperReply(history: ChatEntry[], context: string): Promise<PepperReply> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Bun.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL(),
        messages: [
          { role: 'system', content: PEPPER_CHAT_SYSTEM() },
          { role: 'system', content: context },
          ...historyForModel(history),
        ],
        response_format: { type: 'json_schema', json_schema: PEPPER_SCHEMA },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`openai ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return sanitizeReply(JSON.parse(data.choices?.[0]?.message?.content || '{}'));
  } finally {
    clearTimeout(timer);
  }
}
