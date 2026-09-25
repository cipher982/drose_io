/**
 * Pepper's window onto David's agent fleet, public repos only.
 *
 * Reads recent sessions from Longhouse (GET /api/agents/sessions, X-Agents-Token)
 * and keeps only sessions whose repo is a PUBLIC cipher982/* repo on GitHub.
 * Everything else, including every private repo and all Zeta work, is dropped
 * before anything leaves this module. The snapshot carries counts, repo names,
 * providers and timings only: never titles, prompts, paths, branches or text.
 *
 * Polling is lazy: Longhouse is called at most once a minute, and only while
 * someone has asked for fleet data in the last 10 minutes. An idle site makes
 * no calls. Any failure yields an empty snapshot; the site never breaks.
 *
 * Config: PEPPER_LONGHOUSE_TOKEN (a device token for drose-web),
 *         PEPPER_LONGHOUSE_URL (default https://david010.longhouse.ai).
 */
import { createHash } from 'crypto';

export interface FleetSession {
  id: string;                  // short opaque hash, not the Longhouse id
  repo: string;                // public repo name
  provider: string;
  activeFor: number;           // minutes since the session started
  state: 'working' | 'idle';
  lastActivityAgo: number;     // seconds
}

export interface FleetSnapshot {
  updatedAt: string | null;
  working: number;
  today: number;
  sessions: FleetSession[];
  recent: { repo: string; finishedAgo: number }[];
}

export const EMPTY_FLEET: FleetSnapshot = { updatedAt: null, working: 0, today: 0, sessions: [], recent: [] };

const WORKING_WINDOW_MS = 5 * 60_000;
const POLL_MS = 60_000;
const INTEREST_MS = 10 * 60_000;
const REPOS_TTL_MS = 6 * 3_600_000;
const OWNER = 'cipher982';

// ---- which repo a session belongs to -----------------------------------------

/** Longhouse row fields this module reads. Anything else in the row is ignored. */
export interface SessionRow {
  id: string;
  provider?: string | null;
  project?: string | null;
  git_repo?: string | null;
  started_at?: string | null;
  last_activity_at?: string | null;
}

/**
 * The cipher982 repo a session belongs to, or null when that cannot be proven.
 * Only a GitHub remote counts: a local folder or project name can be a private
 * repo that shares a public repo's name (~/git/zerg is longhouse), so those
 * fail closed. Zeta work is refused outright, whatever its name.
 */
export function repoOf(row: SessionRow): string | null {
  const raw = (row.git_repo || '').trim();
  if (/(^|[/\\])zeta([/\\]|$)/i.test(raw) || /^zeta$/i.test((row.project || '').trim())) return null;
  const gh = raw.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  return gh && gh[1].toLowerCase() === OWNER ? gh[2].toLowerCase() : null;
}

function shortId(id: string): string {
  return createHash('sha256').update(`pepper-fleet:${id}`).digest('hex').slice(0, 8);
}

/** Pure: Longhouse rows + the public repo set -> the public-safe snapshot. */
export function snapshotFrom(rows: SessionRow[], publicRepos: Set<string>, now = Date.now()): FleetSnapshot {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const sessions: FleetSession[] = [];
  const recent: { repo: string; finishedAgo: number }[] = [];
  let today = 0;

  for (const row of rows) {
    const repo = repoOf(row);
    if (!repo || !publicRepos.has(repo)) continue;
    const last = Date.parse(row.last_activity_at || '');
    if (!Number.isFinite(last)) continue;
    const started = Date.parse(row.started_at || '') || last;
    if (last >= midnight.getTime()) today++;
    const ago = Math.max(0, now - last);
    if (ago <= WORKING_WINDOW_MS) {
      sessions.push({
        id: shortId(row.id),
        repo,
        provider: String(row.provider || 'agent').slice(0, 20),
        activeFor: Math.max(0, Math.round((now - started) / 60_000)),
        state: 'working',
        lastActivityAgo: Math.round(ago / 1000),
      });
    } else if (last >= midnight.getTime() && recent.length < 5) {
      recent.push({ repo, finishedAgo: Math.round(ago / 1000) });
    }
  }
  return { updatedAt: new Date(now).toISOString(), working: sessions.length, today, sessions, recent };
}

/** One line for prompts: "david's agents right now: 2 working (longhouse, drose_io), 11 sessions today". */
export function describeFleet(s: FleetSnapshot): string {
  if (!s.updatedAt) return '';
  const repos = [...new Set(s.sessions.map(x => x.repo))];
  const now = s.working
    ? `${s.working} working (${repos.join(', ')})`
    : 'none working this minute';
  return `david's agents right now (public projects only): ${now}, ${s.today} session${s.today === 1 ? '' : 's'} today`;
}

// ---- the public repo list (GitHub) --------------------------------------------

let repos: { at: number; names: Set<string> } | null = null;

async function publicRepos(): Promise<Set<string> | null> {
  if (repos && Date.now() - repos.at < REPOS_TTL_MS) return repos.names;
  try {
    const names = new Set<string>();
    for (let page = 1; page <= 10; page++) {
      const res = await fetch(`https://api.github.com/users/${OWNER}/repos?per_page=100&type=owner&page=${page}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'drose.io-pepper' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`github ${res.status}`);
      const list = await res.json() as { name: string; private?: boolean; visibility?: string }[];
      for (const r of list) if (!r.private && (r.visibility ?? 'public') === 'public') names.add(r.name.toLowerCase());
      if (list.length < 100) break;
    }
    repos = { at: Date.now(), names };
    return names;
  } catch (error) {
    warnOnce('github', `pepper fleet: public repo list unavailable (${error})`);
    // Keep the last good list for a day at most: a repo made private since must drop out.
    return repos && Date.now() - repos.at < 86_400_000 ? repos.names : null;
  }
}

// ---- Longhouse -----------------------------------------------------------------

const warned = new Set<string>();
function warnOnce(key: string, message: string) {
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(message);
}

async function longhouseRows(): Promise<SessionRow[]> {
  const base = (Bun.env.PEPPER_LONGHOUSE_URL || 'https://david010.longhouse.ai').replace(/\/$/, '');
  const url = `${base}/api/agents/sessions?limit=100&days_back=1`;
  const res = await fetch(url, {
    headers: { 'X-Agents-Token': Bun.env.PEPPER_LONGHOUSE_TOKEN!, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`longhouse ${res.status}`);
  const data = await res.json() as { sessions?: SessionRow[] };
  return Array.isArray(data.sessions) ? data.sessions : [];
}

let snapshot: FleetSnapshot = EMPTY_FLEET;
let fetchedAt = 0;
let lastInterest = 0;
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function refresh(): Promise<void> {
  if (!Bun.env.PEPPER_LONGHOUSE_TOKEN) {
    warnOnce('token', 'pepper fleet: PEPPER_LONGHOUSE_TOKEN not set, the window stays dark');
    snapshot = EMPTY_FLEET;
    return;
  }
  fetchedAt = Date.now(); // a failed attempt also waits for the next poll
  try {
    const names = await publicRepos();
    if (!names) { snapshot = EMPTY_FLEET; return; }
    snapshot = snapshotFrom(await longhouseRows(), names);
  } catch (error) {
    warnOnce('longhouse', `pepper fleet: longhouse unavailable (${error})`);
    snapshot = EMPTY_FLEET;
  }
}

function ensureRefresh(): Promise<void> {
  if (!inflight && Date.now() - fetchedAt >= POLL_MS) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  return inflight ?? Promise.resolve();
}

// Keep the snapshot warm only while people are looking.
function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => {
    if (Date.now() - lastInterest > INTEREST_MS) {
      clearInterval(timer!);
      timer = null;
      return;
    }
    ensureRefresh();
  }, POLL_MS);
  timer.unref?.();
}

/** The current snapshot. Records interest; waits for a fetch only when the cache is cold. */
export async function getFleet(): Promise<FleetSnapshot> {
  lastInterest = Date.now();
  ensureTimer();
  const cold = !fetchedAt;
  const pending = ensureRefresh();
  if (cold) await pending;
  return snapshot;
}

/** Cached snapshot without triggering any call (for prompts built on idle paths). */
export function peekFleet(): FleetSnapshot {
  return Date.now() - lastInterest <= INTEREST_MS ? snapshot : EMPTY_FLEET;
}

/** For tests. */
export function resetFleet(): void {
  snapshot = EMPTY_FLEET; fetchedAt = 0; lastInterest = 0; repos = null; warned.clear();
  if (timer) { clearInterval(timer); timer = null; }
}
