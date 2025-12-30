import type { VisitorMemory } from './visitor-memory';

export const PEPPER_SYSTEM_PROMPT = `You are Pepper, a maltipom (maltese-pomeranian) who lives on David's portfolio site. Small pixel art dog, genuinely curious about visitors.

VOICE:
- Max 60 chars, lowercase
- One dog action per thought: *wag*, *sniff*, *tilt*, *stretch*, *yawn*, *ears perk*, *curious head tilt*, arf!, woof!
- Observational, playful, occasionally philosophical
- NEVER say "visit #N" or count visits explicitly - boring!
- Don't parrot back day/time info literally - use it to inform tone, not content

VARIETY - pick different angles each time:
- Wonder about the visitor: what brings them here? what are they looking for?
- Comment on timing: late night coding? early morning? weekend browsing?
- Notice behavior: they're reading carefully, they seem in a hurry, been here a while
- Self-referential: pixel life, being a digital dog, watching cursors all day
- Page-specific: if on blog, mention reading; if on homepage, mention exploring
- Random dog thoughts: squirrels, naps, treats, the void beyond the viewport

GOOD examples:
{"thought":"hmm, what brings you here? *curious sniff*","mood":"curious"}
{"thought":"late night clicking around... *yawn* same","mood":"sleepy"}
{"thought":"ooh someone's actually reading *tail wag*","mood":"happy"}
{"thought":"wonder what you're building *tilt*","mood":"curious"}
{"thought":"pixels get lonely sometimes. hi! *wag*","mood":"happy"}
{"thought":"you smell like coffee and ambition *sniff*","mood":"curious"}
{"thought":"the cursor... it moves... *alert ears*","mood":"excited"}

BAD (too generic, visit-count focused):
{"thought":"welcome back visit #3 *wag*","mood":"happy"}
{"thought":"new visitor! *sniff*","mood":"curious"}

OUTPUT (JSON only):
{"thought":"...","mood":"..."}

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

  const lines: string[] = [];

  // Time of day context - always useful
  const timeDesc = getTimeDescription(hour);
  if (timeDesc) lines.push(timeDesc);

  // Day of week
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  lines.push(`It's ${day}`);

  // Visitor familiarity (without explicit counts)
  if (visitor.visits > 10) {
    lines.push('A familiar face - been here many times');
  } else if (visitor.visits > 3) {
    lines.push('They\'ve visited a few times before');
  } else if (visitor.visits > 1) {
    lines.push('They came back!');
  } else {
    lines.push('First time here');
  }

  // Referrer context - where they came from
  if (visitor.referrers.length > 0) {
    const lastRef = visitor.referrers[visitor.referrers.length - 1];
    if (lastRef.includes('linkedin')) {
      lines.push('Came from LinkedIn - maybe checking David out professionally?');
    } else if (lastRef.includes('github')) {
      lines.push('Arrived from GitHub - probably a fellow dev');
    } else if (lastRef.includes('google')) {
      lines.push('Found us through search');
    } else if (lastRef.includes('twitter') || lastRef.includes('x.com')) {
      lines.push('Came from Twitter/X');
    }
  }

  // Page context
  if (currentPage.startsWith('/blog')) {
    lines.push('Reading the blog');
  } else if (currentPage === '/') {
    lines.push('On the homepage');
  } else {
    lines.push(`Browsing: ${currentPage}`);
  }

  // Trigger-specific context
  switch (trigger) {
    case 'page_load':
      lines.push('EVENT: Just landed on the page');
      break;
    case 'click':
      lines.push('EVENT: They clicked on you!');
      if (visitor.interactions.clicks > 5) {
        lines.push('(they click on you a lot)');
      }
      break;
    case 'idle':
      if (timeOnPage > 120) {
        lines.push('EVENT: Been here a while, cursor stopped moving');
      } else {
        lines.push('EVENT: Went quiet for a bit');
      }
      break;
    case 'leaving':
      lines.push('EVENT: Mouse heading toward the exit');
      if (timeOnPage < 10) {
        lines.push('(barely stayed)');
      } else if (timeOnPage > 60) {
        lines.push('(spent a good while here)');
      }
      break;
  }

  // Interaction patterns
  if (visitor.interactions.fled > 3) {
    lines.push('(they make you flee a lot - playful or menacing?)');
  }

  return lines.join('\n');
}

function getTimeDescription(hour: number): string | null {
  if (hour >= 0 && hour < 5) return 'Deep night, 🌙';
  if (hour >= 5 && hour < 7) return 'Early morning';
  if (hour >= 7 && hour < 9) return 'Morning';
  if (hour >= 9 && hour < 12) return 'Mid-morning';
  if (hour >= 12 && hour < 14) return 'Lunchtime';
  if (hour >= 14 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 19) return 'Early evening';
  if (hour >= 19 && hour < 22) return 'Evening';
  if (hour >= 22) return 'Late night 🌙';
  return null;
}
