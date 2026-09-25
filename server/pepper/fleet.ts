/**
 * Pepper's window onto David's agent fleet, public repos only.
 *
 * Reads recent sessions from Longhouse (GET /api/agents/sessions, X-Agents-Token)
 * and keeps only sessions whose repo is a PUBLIC cipher982/* repo on GitHub.
 * Everything else is reduced to two counts (working now, sessions today) with no
 * names: "other projects", which is private repos AND sessions that simply don't
 * report a GitHub remote, so it must never be called "private". Zeta work is
 * dropped entirely, not even counted. The snapshot carries
 * counts, repo names, providers and timings only: never titles, prompts, paths,
 * branches or text. Alongside, the last day's commits on public repos from
 * GitHub, which anyone browsing his profile can already see.
 *
 * The rule: everything here may reach Pepper's chat, and anything in the chat
 * can be repeated to a visitor verbatim, so everything here must be fine to
 * publish.
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

export interface PublicCommit {
  repo: string;
  message: string;             // first line, from GitHub
  ago: number;                 // seconds
  url: string;
}

export interface FleetSnapshot {
  updatedAt: string | null;
  working: number;
  today: number;
  sessions: FleetSession[];
  recent: { repo: string; finishedAgo: number }[];
  otherWorking: number;        // agents not provably on a public repo right now: a count, nothing else
  otherToday: number;
  commits: PublicCommit[];     // last 24h on public repos, newest first
}

export const EMPTY_FLEET: FleetSnapshot = { updatedAt: null, working: 0, today: 0, sessions: [], recent: [], otherWorking: 0, otherToday: 0, commits: [] };

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
  cwd?: string | null;         // only to recognise Zeta work; never leaves this module
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

/** Employer work: left out entirely, not even counted. */
export function isZeta(row: SessionRow): boolean {
  const where = `${row.git_repo || ''} ${row.cwd || ''}`;
  return /(^|[/\\])zeta([/\\]|$)|gitlab/i.test(where) || /^zeta$/i.test((row.project || '').trim());
}

function shortId(id: string): string {
  return createHash('sha256').update(`pepper-fleet:${id}`).digest('hex').slice(0, 8);
}

/** Pure: Longhouse rows + the public repo set -> the public-safe snapshot. */
export function snapshotFrom(rows: SessionRow[], publicRepos: Set<string>, now = Date.now()): FleetSnapshot {
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const sessions: FleetSession[] = [];
  const recent: { repo: string; finishedAgo: number }[] = [];
  let today = 0, otherWorking = 0, otherToday = 0;

  for (const row of rows) {
    if (isZeta(row)) continue;
    const repo = repoOf(row);
    const last = Date.parse(row.last_activity_at || '');
    if (!Number.isFinite(last)) continue;
    if (!repo || !publicRepos.has(repo)) {
      if (now - last <= WORKING_WINDOW_MS) otherWorking++;
      if (last >= midnight.getTime()) otherToday++;
      continue;
    }
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
  return { updatedAt: new Date(now).toISOString(), working: sessions.length, today, sessions, recent, otherWorking, otherToday, commits: [] };
}

const span = (min: number) => min < 90 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;

/** The fleet for Pepper's chat: per public repo, who is on it and for how long, with its public link. */
export function fleetForChat(s: FleetSnapshot): string {
  if (!s.updatedAt) return 'no view of it right now (the feed is off or unreachable)';
  const byRepo = new Map<string, FleetSession[]>();
  for (const x of s.sessions) byRepo.set(x.repo, [...(byRepo.get(x.repo) || []), x]);
  const lines = [...byRepo].map(([repo, list]) => {
    const who = [...new Set(list.map(x => x.provider))].join(', ');
    const longest = Math.max(...list.map(x => x.activeFor));
    return `- ${repo} (https://github.com/${OWNER}/${repo}): ${list.length} ${who} agent${list.length === 1 ? '' : 's'} working, the longest for ${span(longest)}`;
  });
  if (!lines.length) lines.push('- none working this minute');
  const done = [...new Set(s.recent.map(r => r.repo))];
  if (done.length) lines.push(`- finished earlier today: ${done.join(', ')}`);
  lines.push(`- ${s.today} session${s.today === 1 ? '' : 's'} on public repos today`);
  if (s.otherWorking || s.otherToday) {
    lines.push(`- other projects you can't see into (private ones, or sessions not linked to a public repo; a count only): ${s.otherWorking} agent${s.otherWorking === 1 ? '' : 's'} working now, ${s.otherToday} session${s.otherToday === 1 ? '' : 's'} today`);
  }
  if (s.commits.length) {
    lines.push('- public commits in the last day (from GitHub):');
    for (const c of s.commits) lines.push(`  - ${c.repo}: "${c.message}" (${agoText(c.ago)}) ${c.url}`);
  }
  return lines.join('\n');
}

function agoText(sec: number): string {
  const min = Math.round(sec / 60);
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

/** One line for prompts: "david's agents right now (public projects only): 2 working (longhouse), 3 sessions today". */
export function describeFleet(s: FleetSnapshot): string {
  if (!s.updatedAt) return '';
  const repos = [...new Set(s.sessions.map(x => x.repo))];
  const now = s.working
    ? `${s.working} working (${repos.join(', ')})`
    : 'none working this minute';
  const priv = s.otherWorking ? `, plus ${s.otherWorking} on other projects` : '';
  return `david's agents right now (public projects only): ${now}${priv}, ${s.today} session${s.today === 1 ? '' : 's'} today`;
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

// ---- public commits (GitHub) ----------------------------------------------------
// Push events name the repos but no longer carry commit messages, so: events to
// find the repos pushed in the last day, then that day's commits for the busiest
// few. Unauthenticated (60 calls/hour), so cached for 15 minutes.

const COMMITS_TTL_MS = 15 * 60_000;
const COMMIT_REPOS = 4;
let commitsCache: { at: number; commits: PublicCommit[] } | null = null;

const gh = (path: string) => fetch(`https://api.github.com${path}`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'drose.io-pepper' },
  signal: AbortSignal.timeout(10_000),
});

/** Pure: GitHub commit objects for one repo -> public commit lines. */
export function commitsFrom(repo: string, list: any[], now = Date.now()): PublicCommit[] {
  return list.flatMap(c => {
    const at = Date.parse(c?.commit?.author?.date || c?.commit?.committer?.date || '');
    const message = String(c?.commit?.message || '').split('\n')[0].trim().slice(0, 100);
    if (!Number.isFinite(at) || !message || typeof c?.html_url !== 'string') return [];
    return [{ repo, message, ago: Math.max(0, Math.round((now - at) / 1000)), url: c.html_url }];
  });
}

async function publicCommits(publicNames: Set<string>): Promise<PublicCommit[]> {
  if (commitsCache && Date.now() - commitsCache.at < COMMITS_TTL_MS) return commitsCache.commits;
  try {
    const since = new Date(Date.now() - 86_400_000);
    const res = await gh(`/users/${OWNER}/events/public?per_page=100`);
    if (!res.ok) throw new Error(`github events ${res.status}`);
    const events = await res.json() as { type: string; created_at: string; repo: { name: string } }[];
    const repos: string[] = [];
    for (const e of events) {
      if (e.type !== 'PushEvent' || Date.parse(e.created_at) < since.getTime()) continue;
      const [owner, name] = e.repo.name.toLowerCase().split('/');
      if (owner === OWNER && publicNames.has(name) && !repos.includes(name)) repos.push(name);
    }
    const commits: PublicCommit[] = [];
    for (const repo of repos.slice(0, COMMIT_REPOS)) {
      const r = await gh(`/repos/${OWNER}/${repo}/commits?since=${since.toISOString()}&per_page=5`);
      if (r.ok) commits.push(...commitsFrom(repo, await r.json() as any[]));
    }
    commits.sort((a, b) => a.ago - b.ago);
    commitsCache = { at: Date.now(), commits: commits.slice(0, 8) };
  } catch (error) {
    warnOnce('commits', `pepper fleet: public commits unavailable (${error})`);
    if (!commitsCache) commitsCache = { at: Date.now(), commits: [] };
    else commitsCache.at = Date.now(); // keep the last list, try again next window
  }
  return commitsCache.commits;
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
    const next = snapshotFrom(await longhouseRows(), names);
    next.commits = await publicCommits(names);
    snapshot = next;
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
  snapshot = EMPTY_FLEET; fetchedAt = 0; lastInterest = 0; repos = null; commitsCache = null; warned.clear();
  if (timer) { clearInterval(timer); timer = null; }
}
