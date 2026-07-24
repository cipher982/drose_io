#!/usr/bin/env bun
/**
 * Post-deploy verification.
 *
 * Answers one question a health check cannot: is production actually serving
 * this checkout, with every file intact?
 *
 * Two failures this exists to catch, both of which really happened:
 *   1. content/blog/<slug>/assets/demos/data/*.json was correct in git and
 *      404ing in production for months, because an unanchored rsync exclude
 *      stripped every nested directory named `data`. /api/health said ok.
 *   2. A deploy that silently no-ops leaves prod serving an old build while
 *      every behavioural assertion still passes. Hence the fingerprint check.
 *
 *   bun run scripts/smoke.ts [base-url]
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';
import { computeFingerprint } from '../server/fingerprint';

const ROOT = join(import.meta.dir, '..');
const BLOG_DIR = join(ROOT, 'content/blog');
const BASE = (process.argv[2] || 'https://drose.io').replace(/\/$/, '');
const CONCURRENCY = 8;

let failures = 0;
let checks = 0;

function pass(msg: string): void {
  checks++;
  console.log(`  ok   ${msg}`);
}

function fail(msg: string, detail?: string): void {
  checks++;
  failures++;
  console.log(`  FAIL ${msg}`);
  if (detail) console.log(`       ${detail}`);
}

function section(name: string): void {
  console.log(`\n${name}`);
}

/** Cache-busting param so we test the origin, not a CDN copy. */
function bust(url: string): string {
  return url + (url.includes('?') ? '&' : '?') + `_smoke=${Date.now()}`;
}

type Meta = { title: string; slug: string; status: string; publishedAt: string };

function loadMeta(): { published: Meta[]; drafts: Meta[] } {
  const published: Meta[] = [];
  const drafts: Meta[] = [];
  for (const name of readdirSync(BLOG_DIR)) {
    const metaPath = join(BLOG_DIR, name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    let m: Meta;
    try {
      m = JSON.parse(readFileSync(metaPath, 'utf-8'));
    } catch {
      continue;
    }
    if (m.status === 'published') published.push(m);
    else if (m.status === 'draft') drafts.push(m);
  }
  published.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { published, drafts };
}

function listFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === '.DS_Store') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) listFiles(full, out);
    else if (st.isFile()) out.push(full);
  }
  return out;
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
}

async function status(path: string): Promise<number> {
  try {
    const res = await fetch(bust(BASE + path), { redirect: 'manual' });
    return res.status;
  } catch {
    return 0;
  }
}

async function text(path: string): Promise<string | null> {
  try {
    const res = await fetch(bust(BASE + path));
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  console.log(`smoke: ${BASE}`);
  const { published, drafts } = loadMeta();

  section('health and identity');
  const health = await text('/api/health');
  if (health && health.includes('"status":"ok"')) pass('/api/health ok');
  else fail('/api/health', health ?? 'no response');

  const versionRaw = await text('/api/version');
  if (!versionRaw) {
    fail('/api/version unreachable', 'deploy predates the fingerprint endpoint?');
  } else {
    const local = computeFingerprint(ROOT);
    let remote: { fingerprint?: string; files?: number } = {};
    try {
      remote = JSON.parse(versionRaw);
    } catch {}
    if (remote.fingerprint === local) {
      pass(`fingerprint matches local checkout (${local})`);
    } else {
      fail(
        'fingerprint mismatch — production is NOT serving this checkout',
        `local=${local} remote=${remote.fingerprint ?? '?'} remoteFiles=${remote.files ?? '?'}`,
      );
    }
  }

  section('pages');
  for (const p of ['/', '/blog']) {
    const s = await status(p);
    s === 200 ? pass(`${p} 200`) : fail(`${p} returned ${s}`);
  }

  const home = await text('/');
  if (home && published[0] && home.includes(published[0].title)) {
    pass(`homepage surfaces latest post (${published[0].slug})`);
  } else {
    fail('homepage missing latest post title', published[0]?.title);
  }
  // The markers survive rendering by design (they make the render idempotent);
  // what matters is that the blocks between them actually got filled in.
  if (home && home.includes('analytics.drose.io/script.js')) pass('homepage has analytics injected');
  else if (home) fail('homepage missing analytics block');
  if (home && /assets\/css\/styles\.css\?v=[a-f0-9]{8}/.test(home)) pass('homepage assets are content-versioned');
  else if (home) fail('homepage assets missing ?v= hashes');

  section('published set');
  const blogHtml = (await text('/blog')) ?? '';
  const linked = new Set(Array.from(blogHtml.matchAll(/href="\/blog\/([a-z0-9-]+)"/g), m => m[1]!));
  const expected = new Set(published.map(p => p.slug));
  const missing = [...expected].filter(s => !linked.has(s));
  const unexpected = [...linked].filter(s => !expected.has(s));
  if (missing.length === 0 && unexpected.length === 0) {
    pass(`/blog lists exactly the ${expected.size} published slugs`);
  } else {
    fail('/blog slug set differs from local metadata',
      `missing=[${missing.join(',')}] unexpected=[${unexpected.join(',')}]`);
  }

  let postFailures = 0;
  await mapLimit(published, CONCURRENCY, async p => {
    const s = await status(`/blog/${p.slug}`);
    if (s !== 200) {
      postFailures++;
      fail(`/blog/${p.slug} returned ${s}`);
    }
  });
  if (postFailures === 0) pass(`all ${published.length} published posts reachable`);

  section('drafts');
  for (const d of drafts) {
    const s = await status(`/blog/${d.slug}`);
    s === 404 ? pass(`/blog/${d.slug} 404 (draft)`) : fail(`/blog/${d.slug} should 404, got ${s}`);
    const preview = await status(`/blog/${d.slug}?preview=1`);
    preview === 200 ? pass(`/blog/${d.slug}?preview=1 200`) : fail(`draft preview returned ${preview}`);
  }
  if (drafts.length === 0) pass('no drafts to check');

  section('feeds');
  const rss = await text('/blog/rss.xml');
  const itemCount = rss ? (rss.match(/<item>/g) || []).length : 0;
  itemCount > 0 ? pass(`rss.xml has ${itemCount} items`) : fail('rss.xml has no items');
  const sitemapStatus = await status('/blog/sitemap.xml');
  sitemapStatus === 200 ? pass('sitemap.xml 200') : fail(`sitemap.xml returned ${sitemapStatus}`);

  section('post assets (byte-for-byte)');
  type AssetCheck = { url: string; local: string; size: number };
  const assets: AssetCheck[] = [];
  for (const p of published) {
    const dir = join(BLOG_DIR, p.slug, 'assets');
    for (const file of listFiles(dir)) {
      const rel = relative(join(BLOG_DIR, p.slug), file);
      assets.push({
        url: `/blog/${p.slug}/${rel.split('/').join('/')}`,
        local: file,
        size: statSync(file).size,
      });
    }
  }

  let assetFailures = 0;
  await mapLimit(assets, CONCURRENCY, async a => {
    try {
      const res = await fetch(bust(BASE + a.url));
      if (!res.ok) {
        assetFailures++;
        fail(`${a.url} returned ${res.status}`);
        return;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const remoteHash = createHash('sha256').update(buf).digest('hex');
      const localHash = createHash('sha256').update(readFileSync(a.local)).digest('hex');
      if (remoteHash !== localHash) {
        assetFailures++;
        fail(`${a.url} content differs`, `remote=${buf.length}B local=${a.size}B`);
      }
    } catch (e) {
      assetFailures++;
      fail(`${a.url} fetch failed`, String(e));
    }
  });
  if (assetFailures === 0) pass(`all ${assets.length} post assets match local bytes`);

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => {
  console.error('smoke crashed:', e);
  process.exit(1);
});
