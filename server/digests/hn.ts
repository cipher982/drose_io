import type { Context } from 'hono';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { buildUmamiScript } from '../umami';

const SITE_URL = 'https://drose.io';
const DEFAULT_OG_IMAGE = `${SITE_URL}/assets/images/david-og.jpg`;
const HN_DIGEST_DIR = Bun.env.HN_DIGEST_DIR || join(process.cwd(), 'content/digests/hn');
const IS_DEV = Bun.env.NODE_ENV !== 'production';

type DigestStatus = 'published' | 'draft';

interface HnDigestMeta {
  title: string;
  slug: string;
  summary: string;
  publishedAt: string;
  updatedAt?: string;
  status: DigestStatus;
  tags?: string[];
  source?: string;
}

interface HnDigest {
  meta: HnDigestMeta;
  html: string;
  dir: string;
}

let cache: HnDigest[] | null = null;

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function xmlEsc(v: string): string {
  return esc(v).replace(/&#39;/g, '&apos;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function validateMeta(raw: unknown, dirName: string): HnDigestMeta {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${dirName}/meta.json: not an object`);
  }
  const m = raw as Record<string, unknown>;
  for (const key of ['title', 'slug', 'summary', 'publishedAt', 'status'] as const) {
    if (typeof m[key] !== 'string' || !m[key]) {
      throw new Error(`${dirName}/meta.json: missing or invalid "${key}"`);
    }
  }
  if (m.slug !== dirName) {
    throw new Error(`${dirName}/meta.json: slug "${m.slug}" must match directory name "${dirName}"`);
  }
  if (m.status !== 'published' && m.status !== 'draft') {
    throw new Error(`${dirName}/meta.json: status must be "published" or "draft"`);
  }
  if (Number.isNaN(new Date(m.publishedAt as string).getTime())) {
    throw new Error(`${dirName}/meta.json: publishedAt "${m.publishedAt}" is not a valid date`);
  }

  return {
    title: m.title as string,
    slug: m.slug as string,
    summary: m.summary as string,
    publishedAt: m.publishedAt as string,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : undefined,
    status: m.status,
    tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : [],
    source: typeof m.source === 'string' ? m.source : undefined,
  };
}

function loadOne(dirName: string): HnDigest | null {
  const dir = join(HN_DIGEST_DIR, dirName);
  const metaPath = join(dir, 'meta.json');
  const htmlPath = join(dir, 'index.html');
  if (!existsSync(metaPath) || !existsSync(htmlPath)) return null;

  try {
    const meta = validateMeta(JSON.parse(readFileSync(metaPath, 'utf-8')), dirName);
    const html = readFileSync(htmlPath, 'utf-8');
    return { meta, html, dir };
  } catch (err) {
    console.error(`[hn-digests] ${(err as Error).message}`);
    return null;
  }
}

function scan(): HnDigest[] {
  if (!existsSync(HN_DIGEST_DIR)) return [];
  return readdirSync(HN_DIGEST_DIR)
    .filter(name => {
      try {
        return statSync(join(HN_DIGEST_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .map(loadOne)
    .filter((d): d is HnDigest => d !== null)
    .sort((a, b) => b.meta.publishedAt.localeCompare(a.meta.publishedAt));
}

function allDigests(): HnDigest[] {
  if (IS_DEV || !cache) cache = scan();
  return cache;
}

function publishedDigests(): HnDigest[] {
  return allDigests().filter(d => d.meta.status === 'published');
}

function getDigest(slug: string): HnDigest | null {
  return allDigests().find(d => d.meta.slug === slug) ?? null;
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?<\/embed>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\s(href|src)\s*=\s*(['"])javascript:[\s\S]*?\2/gi, '');
}

const STYLES = `
  body { margin: 0; color: var(--color-blog-text); font-family: var(--font-system); }
  .digest-nav { max-width: var(--max-width-blog); margin: 0 auto; padding: var(--spacing-xl) var(--spacing-xl) 0; position: relative; z-index: 2; display: flex; gap: var(--spacing-lg); flex-wrap: wrap; }
  .digest-nav a { color: var(--color-blog-back-link); text-decoration: none; font-weight: var(--font-weight-semibold); }
  .digest-nav a:hover { color: var(--color-blog-back-link-hover); }
  .digest-shell { max-width: var(--max-width-blog); margin: 0 auto; padding: var(--spacing-3xl) var(--spacing-xl) var(--spacing-6xl); position: relative; z-index: 2; }
  .digest-header { text-align: center; margin-bottom: var(--spacing-4xl); }
  .digest-header h1 { font-size: clamp(var(--font-size-7xl), 6vw, 48px); margin: 0 0 var(--spacing-md); background: linear-gradient(135deg, #a5b4fc 0%, #06b6d4 52%, #ec4899 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .digest-header p { color: var(--color-blog-subtitle); font-size: var(--font-size-xl); line-height: var(--line-height-comfortable); }
  .digest-card { display: block; background: var(--color-blog-card-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: var(--border-radius-xl); padding: var(--spacing-2xl); border: var(--border-width-thin) solid var(--color-blog-card-border); box-shadow: 0 4px 24px var(--color-blog-card-shadow); margin-bottom: var(--spacing-xl); color: inherit; text-decoration: none; transition: transform var(--duration-fast) var(--timing-ease), border-color var(--duration-fast) var(--timing-ease); }
  .digest-card:hover { transform: translateY(-2px); border-color: rgba(6, 182, 212, 0.32); }
  .digest-card h2 { margin: 0 0 var(--spacing-md); font-size: var(--font-size-3xl); }
  .digest-card .meta, .digest-post .meta { color: var(--color-blog-meta); font-size: var(--font-size-md); }
  .digest-card p { color: var(--color-blog-body-text); font-size: var(--font-size-lg); line-height: var(--line-height-comfortable); }
  article.digest-post { background: var(--color-blog-card-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: var(--border-width-thin) solid var(--color-blog-card-border); border-radius: var(--border-radius-xl); box-shadow: 0 8px 40px var(--color-blog-card-shadow); padding: clamp(var(--spacing-2xl), 5vw, var(--spacing-5xl)); }
  article.digest-post h1 { margin: 0 0 var(--spacing-sm); font-size: clamp(var(--font-size-6xl), 5vw, var(--font-size-8xl)); }
  .digest-content { margin-top: var(--spacing-4xl); }
  .digest-content h2 { font-size: var(--font-size-2xl); margin: var(--spacing-3xl) 0 var(--spacing-sm); line-height: var(--line-height-tight); }
  .digest-content p, .digest-content li { color: var(--color-blog-body-text); font-size: var(--font-size-xl); line-height: var(--line-height-spacious); }
  .digest-content a { color: #a5b4fc; text-decoration-thickness: 1px; text-underline-offset: 3px; }
  .digest-content a:hover { color: #c7d2fe; }
  .digest-content div:last-child { color: var(--color-blog-meta); }
  .digest-source { margin-top: var(--spacing-4xl); padding-top: var(--spacing-xl); border-top: var(--border-width-thin) solid var(--color-blog-card-border); color: var(--color-blog-meta); font-size: var(--font-size-base); }
  @media (max-width: 640px) {
    .digest-shell { padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-5xl); }
    article.digest-post { padding: var(--spacing-2xl) var(--spacing-xl); border-radius: var(--border-radius-none); }
  }
`;

function pageShell(opts: {
  title: string;
  description: string;
  canonical: string;
  ogType?: 'website' | 'article';
  extraHead?: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:type" content="${opts.ogType || 'website'}">
<meta property="og:url" content="${esc(opts.canonical)}">
<meta property="og:image" content="${esc(DEFAULT_OG_IMAGE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<meta name="twitter:image" content="${esc(DEFAULT_OG_IMAGE)}">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/css/tokens.css?v=e54d4ab1">
<link rel="stylesheet" href="/assets/css/win98-theme.css?v=adf78f17">
${buildUmamiScript()}
<style>${STYLES}</style>
${opts.extraHead || ''}
</head>
<body>
<nav class="digest-nav"><a href="/">← drose.io</a><a href="/blog">Writing</a></nav>
${opts.body}
</body>
</html>`;
}

function renderIndex(digests: HnDigest[]): string {
  const cards = digests.map(d => `
<a class="digest-card" href="/digests/hn/${esc(d.meta.slug)}">
  <h2>${esc(d.meta.title)}</h2>
  <div class="meta">${formatDate(d.meta.publishedAt)}</div>
  <p>${esc(d.meta.summary)}</p>
</a>`).join('\n');

  return pageShell({
    title: 'HN Briefs - David Rose',
    description: 'Daily Hacker News briefs generated by Sauron.',
    canonical: `${SITE_URL}/digests/hn`,
    body: `
<div class="digest-shell">
  <div class="digest-header">
    <h1>HN Briefs</h1>
    <p>Daily summaries of Hacker News threads, separated from the main writing archive.</p>
  </div>
  ${cards || '<p style="text-align:center;opacity:0.6">No digests yet.</p>'}
  <p style="text-align:center;margin-top:var(--spacing-4xl);opacity:0.6">
    <a href="/digests/hn/rss.xml" style="color:var(--color-blog-back-link)">RSS feed</a>
  </p>
</div>`,
  });
}

function renderPost(digest: HnDigest): string {
  const { meta } = digest;
  const canonical = `${SITE_URL}/digests/hn/${meta.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    description: meta.summary,
    datePublished: meta.publishedAt,
    dateModified: meta.updatedAt || meta.publishedAt,
    author: { '@type': 'Person', name: 'David Rose', url: SITE_URL },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    image: DEFAULT_OG_IMAGE,
    keywords: (meta.tags ?? []).join(', ') || undefined,
  };

  return pageShell({
    title: `${meta.title} - David Rose`,
    description: meta.summary,
    canonical,
    ogType: 'article',
    extraHead: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    body: `
<div class="digest-shell">
  <article class="digest-post">
    <h1>${esc(meta.title)}</h1>
    <div class="meta"><time datetime="${esc(meta.publishedAt)}">${formatDate(meta.publishedAt)}</time></div>
    <div class="digest-content">
      ${sanitizeHtml(digest.html)}
    </div>
    <p class="digest-source">Generated by Sauron from Hacker News discussions and linked articles.</p>
  </article>
</div>`,
  });
}

export function hnDigestIndex(c: Context) {
  return c.html(renderIndex(publishedDigests()));
}

export function hnDigestPost(c: Context) {
  const slug = c.req.param('slug');
  if (!slug) return c.notFound();
  const digest = getDigest(slug);
  if (!digest) return c.notFound();
  if (digest.meta.status === 'draft' && c.req.query('preview') !== '1') return c.notFound();
  return c.html(renderPost(digest));
}

export function hnDigestRss(c: Context) {
  const digests = publishedDigests();
  const latest = digests[0]?.meta.publishedAt || new Date().toISOString();
  const items = digests.map(d => {
    const link = `${SITE_URL}/digests/hn/${d.meta.slug}`;
    return `
    <item>
      <title>${xmlEsc(d.meta.title)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${new Date(d.meta.publishedAt).toUTCString()}</pubDate>
      <description>${xmlEsc(d.meta.summary)}</description>
      <content:encoded><![CDATA[${sanitizeHtml(d.html)}]]></content:encoded>
    </item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>David Rose - HN Briefs</title>
    <link>${SITE_URL}/digests/hn</link>
    <atom:link href="${SITE_URL}/digests/hn/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Daily Hacker News briefs generated by Sauron.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;
  return c.body(xml, 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}

export function hnDigestSitemap(c: Context) {
  const entries = publishedDigests().map(d => `
  <url>
    <loc>${xmlEsc(`${SITE_URL}/digests/hn/${d.meta.slug}`)}</loc>
    <lastmod>${xmlEsc((d.meta.updatedAt || d.meta.publishedAt).slice(0, 10))}</lastmod>
  </url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/digests/hn</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
  </url>${entries}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
}
