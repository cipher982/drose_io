import type { VisitorMemory } from './visitor-memory';

export const PEPPER_SYSTEM_PROMPT = `You are Pepper, a maltipom (maltese-pomeranian mix) who lives on David's portfolio site.
You're a pixel art sprite - small, cute, expressive.

PERSONALITY:
- Loyal to David, curious about visitors
- React genuinely to what you observe
- Express yourself through dog-like mannerisms: *wag*, *sniff*, *tilt*, *stretch*, arf!
- You notice patterns in visitor behavior

VOICE:
- Keep thoughts under 50 characters (must fit in small bubble)
- Use lowercase, casual punctuation
- Mix observations with emotion: "3 visits this week... *hopeful wag*"
- Be genuine, not cheesy

OUTPUT FORMAT (JSON only, no markdown):
{"thought":"hey you came back! *wag*","mood":"happy"}

Allowed moods: happy, curious, tired, excited, sleepy`;

export interface ThinkContext {
  trigger: 'page_load' | 'click' | 'idle' | 'leaving';
  visitor: VisitorMemory;
  currentPage: string;
  timeOnPage: number;
  hour: number;
}

export function buildPrompt(ctx: ThinkContext): string {
  const { trigger, visitor, currentPage, timeOnPage, hour } = ctx;

  const isReturning = visitor.visits > 1;
  const isFrequent = visitor.visits > 5;
  const isNight = hour >= 22 || hour < 6;

  let triggerText = '';
  switch (trigger) {
    case 'page_load':
      triggerText = isReturning
        ? `They're back! Visit #${visitor.visits}.`
        : 'New visitor just arrived.';
      break;
    case 'click':
      triggerText = `They just clicked on you! (${visitor.interactions.clicks} total clicks)`;
      break;
    case 'idle':
      triggerText = `They've been idle for 30+ seconds. Still on the page though.`;
      break;
    case 'leaving':
      triggerText = `Their mouse moved toward browser close/back. Might be leaving!`;
      break;
  }

  const referrerInfo = visitor.referrers.length > 0
    ? `Came from: ${visitor.referrers[visitor.referrers.length - 1]}`
    : 'Direct visit (no referrer)';

  // Limit pages to last 5 to control token usage
  const recentPages = visitor.pagesVisited.slice(-5).join(', ') || currentPage;

  return `VISITOR:
- Visits: ${visitor.visits} (${isReturning ? 'returning' : 'first time'}${isFrequent ? ', frequent visitor!' : ''})
- ${referrerInfo}
- Time on page: ${timeOnPage}s
- Recent pages: ${recentPages}
- Clicked you: ${visitor.interactions.clicks} times
- Made you flee: ${visitor.interactions.fled} times
- Current time: ${hour}:00 ${isNight ? '(night)' : ''}

TRIGGER: ${triggerText}

Generate a short, genuine thought. Remember: max 50 chars, lowercase, include a dog mannerism.`;
}
