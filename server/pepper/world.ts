/**
 * Pepper's project: a dog house he builds over days with help from visitors.
 *
 * Everything is an append-only log (data/pepper/world/log.jsonl); the world is
 * a replay of it. Visitors give items and design ideas from a closed catalog,
 * so nothing a visitor types is ever shown to anyone else. Pepper works on the
 * house through the day (a builder tick), using what's in his pile. David can
 * undo any event and pause the builder from Pepper's Desk.
 *
 * Rules live here, in code. The model only talks about the result.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from './conversation';

// ---- catalog ------------------------------------------------------------------

export const COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'white', 'black', 'brown'] as const;
export type Color = typeof COLORS[number];
export const ROOF_STYLES = ['gable', 'dome', 'flat'] as const;
export type RoofStyle = typeof ROOF_STYLES[number];

export const MATERIALS = ['plank', 'brick', 'shingle', 'paint'] as const;
export const DECOR = ['flag', 'lantern', 'flower', 'ball', 'bone', 'blanket', 'bowl', 'lights', 'bell', 'cactus', 'mushroom', 'sign'] as const;
export const ITEMS = [...MATERIALS, ...DECOR] as const;
export type Item = typeof ITEMS[number];
export const COLORED: Item[] = ['paint', 'flag', 'flower', 'ball', 'blanket'];

export const IDEA_TARGETS = ['wall_color', 'roof_color', 'door_color', 'roof_style', 'wish'] as const;
export type IdeaTarget = typeof IDEA_TARGETS[number];

// The dog house, part by part. Each step uses one item from the pile.
export const PARTS = ['floor', 'walls', 'roof', 'door', 'window', 'paint'] as const;
export type Part = typeof PARTS[number];
const PLAN: Record<Part, { steps: number; uses: Item[] }> = {
  floor: { steps: 2, uses: ['plank'] },
  walls: { steps: 3, uses: ['plank', 'brick'] },
  roof: { steps: 3, uses: ['shingle', 'plank'] },
  door: { steps: 1, uses: ['plank'] },
  window: { steps: 1, uses: ['plank'] },
  paint: { steps: 1, uses: ['paint'] },
};
// A part can start only when the parts under it are done.
const AFTER: Record<Part, Part[]> = {
  floor: [], walls: ['floor'], roof: ['walls'], door: ['walls'], window: ['walls'], paint: ['walls'],
};

const DECOR_MAX = 3; // of each kind on display

// ---- log ----------------------------------------------------------------------

export type WorldEvent =
  | { id: string; ts: number; kind: 'give'; by: string; from: string; item: Item; color?: Color }
  | { id: string; ts: number; kind: 'idea'; by: string; from: string; target: IdeaTarget; value: string }
  | { id: string; ts: number; kind: 'build'; part: Part; used: Item; material?: string }
  | { id: string; ts: number; kind: 'forage'; item: Item; color?: Color }
  | { id: string; ts: number; kind: 'undo'; ref: string; by: 'david' }
  | { id: string; ts: number; kind: 'pause' | 'resume'; by: 'david' };

const DIR = join(DATA_DIR, 'world');
const LOG = join(DIR, 'log.jsonl');
mkdirSync(DIR, { recursive: true });

let cache: { size: number; events: WorldEvent[] } | null = null;

export function events(): WorldEvent[] {
  if (!existsSync(LOG)) return [];
  const text = readFileSync(LOG, 'utf-8');
  if (cache && cache.size === text.length) return cache.events;
  const parsed = text.split('\n').filter(Boolean).flatMap(l => { try { return [JSON.parse(l) as WorldEvent]; } catch { return []; } });
  cache = { size: text.length, events: parsed };
  return parsed;
}

let seq = 0;
function record<E extends Omit<WorldEvent, 'id' | 'ts'>>(e: E): WorldEvent {
  const full = { id: `w${Date.now().toString(36)}${(seq++ % 1296).toString(36).padStart(2, '0')}`, ts: Date.now(), ...e } as WorldEvent;
  appendFileSync(LOG, JSON.stringify(full) + '\n');
  return full;
}

// ---- projection ---------------------------------------------------------------

export interface World {
  version: number;                       // number of live events; bumps on any change
  paused: boolean;
  parts: Record<Part, { done: number; of: number }>;
  complete: boolean;
  completedAt: number | null;
  wallMaterial: 'wood' | 'brick' | null;
  wallColor: Color | null;
  roofColor: Color | null;
  doorColor: Color | null;
  roofStyle: RoofStyle;
  pile: Partial<Record<Item, number>>;   // given, not yet used (materials only)
  decor: { item: Item; color?: Color }[];
  wishlist: Item[];
  ideas: { target: IdeaTarget; value: string; votes: number }[];
  helpers: number;                       // distinct visitors who ever gave or suggested
  recent: { text: string; ts: number }[];
  lastBuild: { id: string; part: Part; ts: number } | null;
  lastEventTs: number;
  placed: Record<string, Part>;          // give/forage id -> the part it went into (not public)
  shown: string[];                       // decor gift ids on display (not public)
}

function topIdea(ideas: World['ideas'], target: IdeaTarget): string | null {
  return ideas.filter(i => i.target === target).sort((a, b) => b.votes - a.votes)[0]?.value ?? null;
}

function liveEvents(all: WorldEvent[]): WorldEvent[] {
  const undone = new Set(all.filter(e => e.kind === 'undo').map(e => (e as any).ref));
  return all.filter(e => e.kind !== 'undo' && !undone.has(e.id));
}

export function project(all: WorldEvent[] = events()): World {
  const live = liveEvents(all);

  const w: World = {
    version: live.length,
    paused: false,
    parts: Object.fromEntries(PARTS.map(p => [p, { done: 0, of: PLAN[p].steps }])) as World['parts'],
    complete: false,
    completedAt: null,
    wallMaterial: null,
    wallColor: null, roofColor: null, doorColor: null, roofStyle: 'gable',
    pile: {},
    decor: [],
    wishlist: [],
    ideas: [],
    helpers: 0,
    recent: [],
    lastBuild: null,
    lastEventTs: live.at(-1)?.ts ?? 0,
    placed: {},
    shown: [],
  };
  const helpers = new Set<string>();
  const paintColors: Color[] = [];
  // Materials are used oldest first, so each build step traces back to one gift.
  const queue: Partial<Record<Item, string[]>> = {};

  for (const e of live) {
    if (e.kind === 'pause') w.paused = true;
    if (e.kind === 'resume') w.paused = false;
    if (e.kind === 'give' || e.kind === 'forage') {
      if ((DECOR as readonly string[]).includes(e.item)) {
        if (w.decor.filter(d => d.item === e.item).length < DECOR_MAX) {
          w.decor.push({ item: e.item, color: e.color });
          w.shown.push(e.id);
        }
        w.wishlist = w.wishlist.filter(x => x !== e.item);
      } else {
        w.pile[e.item] = (w.pile[e.item] || 0) + 1;
        (queue[e.item] ||= []).push(e.id);
        if (e.item === 'paint' && e.color) paintColors.push(e.color);
      }
      if (e.kind === 'give') {
        helpers.add(e.by);
        w.recent.push({ text: `${e.from} brought ${article(e.item, e.color)}`, ts: e.ts });
      } else {
        w.recent.push({ text: `pepper found ${article(e.item, e.color)}`, ts: e.ts });
      }
    }
    if (e.kind === 'idea') {
      helpers.add(e.by);
      if (e.target === 'wish') {
        if (!w.wishlist.includes(e.value as Item) && w.decor.filter(d => d.item === e.value).length < DECOR_MAX) w.wishlist.push(e.value as Item);
      } else {
        const found = w.ideas.find(i => i.target === e.target && i.value === e.value);
        if (found) found.votes++; else w.ideas.push({ target: e.target, value: e.value, votes: 1 });
      }
      w.recent.push({ text: `${e.from} suggested ${ideaPhrase(e.target, e.value)}`, ts: e.ts });
    }
    if (e.kind === 'build') {
      const part = w.parts[e.part];
      part.done = Math.min(part.of, part.done + 1);
      w.pile[e.used] = Math.max(0, (w.pile[e.used] || 0) - 1);
      const source = queue[e.used]?.shift();
      if (source) w.placed[source] = e.part;
      if (e.part === 'walls' && !w.wallMaterial) w.wallMaterial = e.used === 'brick' ? 'brick' : 'wood';
      if (e.part === 'roof' && part.done === 1) w.roofStyle = (topIdea(w.ideas, 'roof_style') as RoofStyle) || (e.used === 'plank' ? 'flat' : 'gable');
      if (e.part === 'roof' && part.done === part.of) w.roofColor = (topIdea(w.ideas, 'roof_color') as Color) || null;
      if (e.part === 'door') w.doorColor = (topIdea(w.ideas, 'door_color') as Color) || null;
      if (e.part === 'paint') w.wallColor = (topIdea(w.ideas, 'wall_color') as Color) || paintColors.at(-1) || 'white';
      w.lastBuild = { id: e.id, part: e.part, ts: e.ts };
      w.recent.push({ text: `pepper ${BUILD_VERB[e.part]}`, ts: e.ts });
    }
  }
  w.helpers = helpers.size;
  w.complete = PARTS.every(p => w.parts[p].done >= w.parts[p].of);
  if (w.complete) w.completedAt = live.filter(e => e.kind === 'build').at(-1)?.ts ?? null;
  w.recent = w.recent.slice(-12);
  return w;
}

const BUILD_VERB: Record<Part, string> = {
  floor: 'laid floor planks',
  walls: 'put up a wall section',
  roof: 'added to the roof',
  door: 'hung the door',
  window: 'cut a window',
  paint: 'painted the walls',
};

function article(item: Item, color?: Color): string {
  const name = item;
  const c = color ? `${color} ` : '';
  return item === 'lights' ? `some ${c}string lights` : /^[aeiou]/.test(c || name) ? `an ${c}${name}` : `a ${c}${name}`;
}

function ideaPhrase(target: IdeaTarget, value: string): string {
  switch (target) {
    case 'wall_color': return `${value} walls`;
    case 'roof_color': return `a ${value} roof`;
    case 'door_color': return `a ${value} door`;
    case 'roof_style': return `a ${value} roof`;
    case 'wish': return `adding ${article(value as Item)}`;
  }
}

// ---- what he needs next ---------------------------------------------------------

export function nextStep(w: World): { part: Part; item: Item } | null {
  for (const part of PARTS) {
    const p = w.parts[part];
    if (p.done >= p.of) continue;
    if (!AFTER[part].every(d => w.parts[d].done >= w.parts[d].of)) continue;
    // Walls keep the material they started with; the roof prefers shingles.
    let options = PLAN[part].uses;
    if (part === 'walls' && w.wallMaterial) options = [w.wallMaterial === 'brick' ? 'brick' : 'plank'];
    const item = options.find(i => (w.pile[i] || 0) > 0);
    if (item) return { part, item };
  }
  return null;
}

/** What Pepper is short of, for the parts he can work on now. */
export function needs(w: World): { item: Item; count: number; for: Part }[] {
  const want = new Map<Item, { count: number; for: Part }>();
  for (const part of PARTS) {
    const p = w.parts[part];
    if (p.done >= p.of || !AFTER[part].every(d => w.parts[d].done >= w.parts[d].of)) continue;
    const item: Item = part === 'walls' ? (w.wallMaterial === 'brick' ? 'brick' : 'plank') : PLAN[part].uses[0];
    const m = want.get(item) || { count: 0, for: part };
    m.count += p.of - p.done;
    want.set(item, m);
  }
  return [...want].map(([item, m]) => ({ item, count: m.count - (w.pile[item] || 0), for: m.for })).filter(n => n.count > 0);
}

// ---- actions ------------------------------------------------------------------

export type GiveResult = { ok: true; event: WorldEvent; built: WorldEvent | null } | { ok: false; reason: 'limited' | 'invalid' | 'full' };

const DAY = 86_400_000;
const PER_VISITOR_PER_DAY = 5;
const GLOBAL_PER_DAY = 200;

function recentBy(by: string): number {
  const since = Date.now() - DAY;
  return events().filter(e => (e.kind === 'give' || e.kind === 'idea') && (e as any).by === by && e.ts > since).length;
}
function recentAll(): number {
  const since = Date.now() - DAY;
  return events().filter(e => (e.kind === 'give' || e.kind === 'idea') && e.ts > since).length;
}
function underLimit(by: string): boolean {
  return Bun.env.TEST_MODE === 'true' || (recentBy(by) < PER_VISITOR_PER_DAY && recentAll() < GLOBAL_PER_DAY);
}

export function isItem(x: unknown): x is Item { return typeof x === 'string' && (ITEMS as readonly string[]).includes(x); }
export function isColor(x: unknown): x is Color { return typeof x === 'string' && (COLORS as readonly string[]).includes(x); }

/** A visitor hands Pepper something. If it lets him work right now, he does. */
export function give(by: string, from: string, item: unknown, color?: unknown): GiveResult {
  if (!isItem(item)) return { ok: false, reason: 'invalid' };
  const c = COLORED.includes(item) && isColor(color) ? color : undefined;
  if (!underLimit(by)) return { ok: false, reason: 'limited' };
  const w = project();
  if ((DECOR as readonly string[]).includes(item) && w.decor.filter(d => d.item === item).length >= DECOR_MAX) return { ok: false, reason: 'full' };
  const event = record({ kind: 'give', by, from, item, ...(c ? { color: c } : {}) });
  // A visitor who hands him the thing he was waiting for gets to see him use it.
  const built = !w.paused && Date.now() - (w.lastBuild?.ts ?? 0) > 90_000 ? buildOnce() : null;
  return { ok: true, event, built };
}

export function suggest(by: string, from: string, target: unknown, value: unknown): { ok: true; event: WorldEvent } | { ok: false; reason: 'limited' | 'invalid' } {
  if (!(IDEA_TARGETS as readonly string[]).includes(target as string)) return { ok: false, reason: 'invalid' };
  const t = target as IdeaTarget;
  const valid = t === 'roof_style' ? (ROOF_STYLES as readonly string[]).includes(value as string)
    : t === 'wish' ? (DECOR as readonly string[]).includes(value as string)
      : isColor(value);
  if (!valid) return { ok: false, reason: 'invalid' };
  if (!underLimit(by)) return { ok: false, reason: 'limited' };
  return { ok: true, event: record({ kind: 'idea', by, from, target: t, value: value as string }) };
}

/** One step of work, if there is anything he can do. */
export function buildOnce(): WorldEvent | null {
  const w = project();
  if (w.paused) return null;
  const step = nextStep(w);
  if (!step) return null;
  return record({ kind: 'build', part: step.part, used: step.item });
}

export function undo(ref: string): boolean {
  if (!events().some(e => e.id === ref && e.kind !== 'undo')) return false;
  record({ kind: 'undo', ref, by: 'david' });
  return true;
}

export function setPaused(paused: boolean): void {
  record({ kind: paused ? 'pause' : 'resume', by: 'david' });
}

// ---- the working day ----------------------------------------------------------

// Pepper works in bursts through the day, and when nobody has brought him
// anything for a day he goes looking for what he needs himself, so the house
// keeps moving on a quiet site.
let nextWorkAt = 0;

export function tick(now = Date.now()): WorldEvent | null {
  const w = project();
  if (w.paused || now < nextWorkAt) return null;
  nextWorkAt = now + (20 + Math.random() * 40) * 60_000;
  const built = buildOnce();
  if (built) return built;
  const lastGift = events().filter(e => e.kind === 'give' || e.kind === 'forage').at(-1)?.ts ?? 0;
  const want = needs(w)[0];
  if (want && now - lastGift > DAY) {
    return record({ kind: 'forage', item: want.item, ...(want.item === 'paint' ? { color: 'white' as Color } : {}) });
  }
  return null;
}

export function startBuilder(): void {
  if (Bun.env.TEST_MODE === 'true') return;
  setInterval(() => { try { tick(); } catch (e) { console.error('pepper builder tick failed:', e); } }, 5 * 60_000).unref?.();
}

// ---- how Pepper talks about it ----------------------------------------------------

export function describeWorld(w: World = project()): string {
  const parts = PARTS.map(p => `${p} ${w.parts[p].done}/${w.parts[p].of}`).join(', ');
  const pile = Object.entries(w.pile).filter(([, n]) => n).map(([i, n]) => `${n} ${i}`).join(', ') || 'nothing';
  const need = needs(w).map(n => `${n.count} ${n.item} (for the ${n.for})`).join(', ');
  const lines = [
    w.complete ? `your dog house is finished; you are decorating it now` : `you are building a dog house next to your home: ${parts}`,
    `your pile: ${pile}`,
  ];
  if (need) lines.push(`what you need next: ${need}`);
  if (w.wishlist.length) lines.push(`visitors wished for: ${w.wishlist.join(', ')}`);
  if (w.ideas.length) lines.push(`design ideas so far: ${w.ideas.map(i => `${ideaPhrase(i.target, i.value)} (${i.votes})`).join(', ')}`);
  if (w.decor.length) lines.push(`decorations: ${w.decor.map(d => (d.color ? `${d.color} ` : '') + d.item).join(', ')}`);
  lines.push(`${w.helpers} visitor${w.helpers === 1 ? '' : 's'} have helped`);
  if (w.paused) lines.push('david paused the building for now');
  return lines.join('\n');
}

const PLACED: Record<Part, string> = {
  floor: 'is part of the floor',
  walls: 'is part of the walls',
  roof: 'is part of the roof',
  door: 'became the door',
  window: 'framed the window',
  paint: 'went on the walls',
};

/**
 * What one visitor left on the house, newest first, as short phrases for them
 * (the chat panel, and Pepper's memory of them). Only their own marks.
 */
export function marksBy(by: string, all: WorldEvent[] = events()): string[] {
  const w = project(all);
  const out: string[] = [];
  const mine = liveEvents(all).filter(e => (e.kind === 'give' || e.kind === 'idea') && e.by === by).reverse();
  for (const e of mine) {
    if (e.kind === 'give') {
      const thing = `your ${e.color ? e.color + ' ' : ''}${e.item === 'lights' ? 'string lights' : e.item}`;
      if ((DECOR as readonly string[]).includes(e.item)) {
        if (w.shown.includes(e.id)) out.push(`${thing} ${e.item === 'lights' ? 'are' : 'is'} on the house`);
      } else if (w.placed[e.id]) {
        out.push(`${thing} ${PLACED[w.placed[e.id]]}`);
      } else {
        out.push(`${thing} is in his pile, waiting its turn`);
      }
    } else if (e.kind === 'idea') {
      if (e.target === 'wish') {
        out.push(w.decor.some(d => d.item === e.value) ? `you wished for ${article(e.value as Item)}, and one showed up` : `you wished for ${article(e.value as Item)}`);
        continue;
      }
      const applied = e.target === 'wall_color' ? w.wallColor === e.value && w.parts.paint.done > 0
        : e.target === 'roof_color' ? w.roofColor === e.value
          : e.target === 'door_color' ? w.doorColor === e.value
            : w.roofStyle === e.value && w.parts.roof.done > 0;
      const decided = e.target === 'wall_color' ? w.parts.paint.done > 0
        : e.target === 'roof_color' ? w.parts.roof.done >= w.parts.roof.of
          : e.target === 'door_color' ? w.parts.door.done > 0
            : w.parts.roof.done > 0;
      if (applied) out.push(`you picked ${ideaPhrase(e.target, e.value)}, and that's what he built`);
      else if (!decided) out.push(`you voted for ${ideaPhrase(e.target, e.value)}`);
    }
  }
  return [...new Set(out)].slice(0, 3);
}

/** Coarse, visitor-safe "from" label: a city from their IANA timezone, never more. */
export function fromLabel(timezone: unknown): string {
  if (typeof timezone !== 'string' || !/^[A-Za-z]+\/[A-Za-z_]+$/.test(timezone)) return 'a visitor';
  const city = timezone.split('/')[1].replace(/_/g, ' ').toLowerCase();
  return city.length > 20 ? 'a visitor' : `someone in ${city}`;
}
