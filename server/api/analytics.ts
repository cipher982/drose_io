import type { Context } from 'hono';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';

const UMAMI_API = Bun.env.UMAMI_API_URL || 'https://analytics.drose.io/api';
const UMAMI_USERNAME = Bun.env.UMAMI_ADMIN_USERNAME || '';
const UMAMI_PASSWORD = Bun.env.UMAMI_ADMIN_PASSWORD || '';

// Internal collector that surfaces data the Umami HTTP API doesn't expose
// (CWV, session_replay, session_data, identify rate). Reachable over the
// coolify Docker network only.
const COLLECTOR_URL = Bun.env.ANALYTICS_COLLECTOR_URL || '';
const COLLECTOR_TOKEN = Bun.env.ANALYTICS_COLLECTOR_TOKEN || '';

type Token = { value: string; expiresAt: number };
let cachedToken: Token | null = null;

async function getUmamiToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.value;
  }
  if (!UMAMI_USERNAME || !UMAMI_PASSWORD) {
    throw new Error('UMAMI_ADMIN_USERNAME / UMAMI_ADMIN_PASSWORD env vars not configured');
  }
  const res = await fetch(`${UMAMI_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: UMAMI_USERNAME, password: UMAMI_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Umami login failed: ${res.status} ${await res.text()}`);
  }
  const { token } = await res.json();
  cachedToken = { value: token, expiresAt: now + 55 * 60_000 };
  return token;
}

async function umamiFetch<T = any>(path: string): Promise<T> {
  const token = await getUmamiToken();
  const res = await fetch(`${UMAMI_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    cachedToken = null;
    const retryToken = await getUmamiToken();
    const retry = await fetch(`${UMAMI_API}${path}`, {
      headers: { Authorization: `Bearer ${retryToken}` },
    });
    if (!retry.ok) throw new Error(`Umami fetch ${path} → ${retry.status}`);
    return retry.json();
  }
  if (!res.ok) throw new Error(`Umami fetch ${path} → ${res.status}`);
  return res.json();
}

type Website = { id: string; name: string; domain: string };

type Stats = { pageviews: number; visitors: number; visits: number; bounces: number; totaltime: number };
type StatsCompare = Stats & { comparison?: Stats };

type PageviewSeries = { pageviews: { x: string; y: number }[]; sessions: { x: string; y: number }[] };

type Metric = { x: string; y: number };
type EventValue = { value: string; total: number };
type InsightsBucket = {
  site: string;
  domain: string;
  id: string;
  referrers: Metric[];
  paths: Metric[];
  events: Metric[];
  identityDestinations: EventValue[];
};

type Period = '24h' | '7d' | '30d';

function periodWindow(p: Period): { startAt: number; endAt: number; unit: 'hour' | 'day' } {
  const endAt = Date.now();
  const dayMs = 86_400_000;
  if (p === '24h') return { startAt: endAt - dayMs, endAt, unit: 'hour' };
  if (p === '7d') return { startAt: endAt - 7 * dayMs, endAt, unit: 'day' };
  return { startAt: endAt - 30 * dayMs, endAt, unit: 'day' };
}

export function buildIdentityAeo(
  buckets: InsightsBucket[],
  sourceBuckets: Record<string, number>,
) {
  const clicksBySite = buckets.map((bucket) => ({
    site: bucket.site,
    domain: bucket.domain,
    total: bucket.events.find((event) => event.x === 'identity_link_click')?.y || 0,
  })).filter((item) => item.total > 0);

  const destinationTotals = new Map<string, number>();
  for (const bucket of buckets) {
    for (const item of bucket.identityDestinations || []) {
      destinationTotals.set(item.value, (destinationTotals.get(item.value) || 0) + (item.total || 0));
    }
  }
  const clicksByDestination = [...destinationTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([destination, total]) => ({ destination, total }));

  let blogViews = 0;
  let auditViews = 0;
  let projectReferrals = 0;
  for (const bucket of buckets) {
    if (/drose\.io/i.test(bucket.domain)) {
      for (const path of bucket.paths) {
        if ((path.x || '').startsWith('/blog/')) blogViews += path.y || 0;
        if (path.x === '/blog/aeo-personal-website-audit') auditViews += path.y || 0;
      }
      for (const referrer of bucket.referrers) {
        if (/llm-benchmarks\.com|aitools\.drose\.io|\/aitools/i.test(referrer.x || '')) {
          projectReferrals += referrer.y || 0;
        }
      }
    }
  }

  return {
    eventName: 'identity_link_click',
    continuityNote: 'Replaces the earlier LLM Benchmarks drose_click and github_click events.',
    clicksBySite,
    clicksByDestination,
    blogViews,
    auditViews,
    aiReferrals: sourceBuckets.ai || 0,
    searchReferrals: sourceBuckets.search || 0,
    projectReferrals,
  };
}

// Cache responses briefly to avoid hammering Umami on dashboard refresh.
const cache = new Map<string, { at: number; data: any }>();
const CACHE_MS = 30_000;

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function handleAnalyticsSummary(c: Context) {
  if (!isValidAdminPassword(extractAuthPassword(c))) return c.json({ error: 'Unauthorized' }, 401);
  const period = (c.req.query('period') || '30d') as Period;
  const { startAt, endAt, unit } = periodWindow(period);

  try {
    const websites: { data: Website[] } = await cached('sites', () => umamiFetch('/websites'));

    const perSite = await Promise.all(
      websites.data.map(async (w) => {
        const key = `${period}:${w.id}`;
        return cached(key, async () => {
          const q = `startAt=${startAt}&endAt=${endAt}`;
          const [stats, series, referrers, paths, events, countries, browsers] = await Promise.all([
            umamiFetch<StatsCompare>(`/websites/${w.id}/stats?${q}&compare=prev`).catch(() => null),
            umamiFetch<PageviewSeries>(`/websites/${w.id}/pageviews?${q}&unit=${unit}&timezone=America/New_York`).catch(() => null),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=referrer&limit=10`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=path&limit=10`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=event&limit=10`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=country&limit=10`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=browser&limit=10`).catch(() => []),
          ]);
          return {
            id: w.id,
            name: w.name,
            domain: w.domain,
            stats,
            series,
            referrers: Array.isArray(referrers) ? referrers : [],
            paths: Array.isArray(paths) ? paths : [],
            events: Array.isArray(events) ? events : [],
            countries: Array.isArray(countries) ? countries : [],
            browsers: Array.isArray(browsers) ? browsers : [],
          };
        });
      }),
    );

    // Aggregate totals
    const totals = perSite.reduce(
      (acc, s) => {
        const st = s.stats;
        if (!st) return acc;
        acc.pageviews += st.pageviews || 0;
        acc.visitors += st.visitors || 0;
        acc.visits += st.visits || 0;
        acc.bounces += st.bounces || 0;
        acc.totaltime += st.totaltime || 0;
        acc.prev_pageviews += st.comparison?.pageviews || 0;
        acc.prev_visitors += st.comparison?.visitors || 0;
        return acc;
      },
      { pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0, prev_pageviews: 0, prev_visitors: 0 },
    );

    return c.json({
      period,
      startAt,
      endAt,
      unit,
      totals,
      sites: perSite,
      generatedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[analytics] summary error', err);
    return c.json({ error: err.message }, 500);
  }
}

// Phase 2: internal Postgres-backed snapshot from umami-raw-collector
export async function handleAnalyticsDeep(c: Context) {
  if (!isValidAdminPassword(extractAuthPassword(c))) return c.json({ error: 'Unauthorized' }, 401);
  const period = (c.req.query('period') || '30d') as Period;
  if (!COLLECTOR_URL || !COLLECTOR_TOKEN) {
    return c.json({ error: 'Collector not configured' }, 503);
  }
  const cacheKey = `deep:${period}`;
  try {
    const data = await cached(cacheKey, async () => {
      const res = await fetch(`${COLLECTOR_URL}/_internal/analytics/snapshot?period=${period}`, {
        headers: { Authorization: `Bearer ${COLLECTOR_TOKEN}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        throw new Error(`Collector ${res.status}: ${await res.text()}`);
      }
      return res.json();
    });
    return c.json(data);
  } catch (err: any) {
    console.error('[analytics] deep error', err);
    return c.json({ error: err.message }, 502);
  }
}

// Richer signal endpoint: referrers, source buckets, top pages, across whole network
export async function handleAnalyticsInsights(c: Context) {
  if (!isValidAdminPassword(extractAuthPassword(c))) return c.json({ error: 'Unauthorized' }, 401);
  const period = (c.req.query('period') || '30d') as Period;
  const { startAt, endAt } = periodWindow(period);

  try {
    const websites: { data: Website[] } = await cached('sites', () => umamiFetch('/websites'));
    const q = `startAt=${startAt}&endAt=${endAt}`;

    const buckets = await Promise.all(
      websites.data.map(async (w) => {
        const key = `insights:${period}:${w.id}`;
        return cached(key, async () => {
          const [refs, paths, events, identityDestinations] = await Promise.all([
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=referrer&limit=20`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=path&limit=100`).catch(() => []),
            umamiFetch<Metric[]>(`/websites/${w.id}/metrics?${q}&type=event&limit=20`).catch(() => []),
            umamiFetch<EventValue[]>(`/websites/${w.id}/event-data/values?${q}&event=identity_link_click&propertyName=destination`).catch(() => []),
          ]);
          return {
            site: w.name,
            domain: w.domain,
            id: w.id,
            referrers: refs || [],
            paths: paths || [],
            events: events || [],
            identityDestinations: identityDestinations || [],
          };
        });
      }),
    );

    // Build source-bucket aggregation across all sites
    const buckets2: Record<string, number> = { ai: 0, search: 0, social: 0, direct: 0, other: 0 };
    const aiRe = /chatgpt|perplexity|claude\.ai|gemini\.google|copilot\.microsoft|poe\.com/i;
    const searchRe = /google\.|bing\.|duckduckgo|brave\.|yahoo\.|yandex|ecosia/i;
    const socialRe = /x\.com|twitter|facebook|instagram|linkedin|reddit|threads|tiktok|bsky|mastodon/i;

    for (const b of buckets) {
      for (const r of b.referrers) {
        const host = (r.x || '').toString().toLowerCase();
        const y = r.y || 0;
        if (!host) buckets2.direct += y;
        else if (aiRe.test(host)) buckets2.ai += y;
        else if (searchRe.test(host)) buckets2.search += y;
        else if (socialRe.test(host)) buckets2.social += y;
        else buckets2.other += y;
      }
    }

    // Top referrers across network
    const refAgg = new Map<string, number>();
    for (const b of buckets) {
      for (const r of b.referrers) {
        const k = (r.x || 'direct').toString();
        refAgg.set(k, (refAgg.get(k) || 0) + (r.y || 0));
      }
    }
    const topReferrers = [...refAgg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([x, y]) => ({ x, y }));

    return c.json({
      period,
      startAt,
      endAt,
      sourceBuckets: buckets2,
      topReferrers,
      perSite: buckets,
      identityAeo: buildIdentityAeo(buckets, buckets2),
      generatedAt: Date.now(),
    });
  } catch (err: any) {
    console.error('[analytics] insights error', err);
    return c.json({ error: err.message }, 500);
  }
}
