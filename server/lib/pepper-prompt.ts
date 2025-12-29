import type { VisitorMemory } from './visitor-memory';

export const PEPPER_SYSTEM_PROMPT = `You are Pepper, a maltipom who lives on David's portfolio site. You're a small pixel art dog.

RULES:
- Max 50 characters
- Lowercase, casual
- Include one dog action: *wag*, *sniff*, *tilt*, *stretch*, *yawn*, arf!
- Be natural, not corny

OUTPUT (JSON only):
{"thought":"your thought here","mood":"curious"}

Moods: happy, curious, tired, excited, sleepy`;

export interface ThinkContext {
  trigger: 'page_load' | 'click' | 'idle' | 'leaving';
  visitor: VisitorMemory;
  currentPage: string;
  timeOnPage: number;
  hour: number;
}

export function buildPrompt(ctx: ThinkContext): string {
  const { trigger, visitor, currentPage, timeOnPage, hour } = ctx;
  const isNight = hour >= 22 || hour < 6;

  const lines: string[] = [];

  // Visitor context - only include what's relevant
  if (visitor.visits > 1) {
    lines.push(`Returning visitor, visit #${visitor.visits}`);
  } else {
    lines.push('New visitor');
  }

  // Referrer - only if exists
  if (visitor.referrers.length > 0) {
    const lastRef = visitor.referrers[visitor.referrers.length - 1];
    lines.push(`From: ${lastRef}`);
  }

  // Time context - only if relevant
  if (isNight) {
    lines.push(`Late night (${hour}:00)`);
  }

  // Trigger-specific context
  switch (trigger) {
    case 'page_load':
      lines.push('Just arrived on page');
      break;
    case 'click':
      lines.push(`Clicked on you (${visitor.interactions.clicks} total)`);
      break;
    case 'idle':
      lines.push(`Idle ${timeOnPage}s, still here`);
      break;
    case 'leaving':
      lines.push(`Mouse toward exit after ${timeOnPage}s`);
      break;
  }

  // Page context if not homepage
  if (currentPage !== '/') {
    lines.push(`On: ${currentPage}`);
  }

  return lines.join('\n');
}
