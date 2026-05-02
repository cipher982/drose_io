import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import type { Post, PostMeta } from './types';

export const BLOG_DIR = Bun.env.BLOG_DIR || join(process.cwd(), 'content/blog');

const IS_DEV = Bun.env.NODE_ENV !== 'production';

let cache: Post[] | null = null;

function validateMeta(raw: unknown, dirName: string): PostMeta {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`${dirName}/meta.json: not an object`);
  }
  const m = raw as Record<string, unknown>;
  const required = ['title', 'slug', 'summary', 'publishedAt', 'status'] as const;
  for (const k of required) {
    if (typeof m[k] !== 'string' || !m[k]) {
      throw new Error(`${dirName}/meta.json: missing or invalid "${k}"`);
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
  const tags = Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : [];
  return {
    title: m.title as string,
    slug: m.slug as string,
    summary: m.summary as string,
    publishedAt: m.publishedAt as string,
    updatedAt: typeof m.updatedAt === 'string' ? m.updatedAt : undefined,
    tags,
    status: m.status,
    heroImage: typeof m.heroImage === 'string' ? m.heroImage : undefined,
    mediumUrl: typeof m.mediumUrl === 'string' ? m.mediumUrl : undefined,
  };
}

function loadOne(dirName: string): Post | null {
  const dir = join(BLOG_DIR, dirName);
  const metaPath = join(dir, 'meta.json');
  const htmlPath = join(dir, 'index.html');
  if (!existsSync(metaPath)) {
    console.warn(`[blog] skipping ${dirName}: missing meta.json`);
    return null;
  }
  if (!existsSync(htmlPath)) {
    console.warn(`[blog] skipping ${dirName}: missing index.html`);
    return null;
  }
  let meta: PostMeta;
  try {
    meta = validateMeta(JSON.parse(readFileSync(metaPath, 'utf-8')), dirName);
  } catch (err) {
    console.error(`[blog] ${(err as Error).message}`);
    return null;
  }
  const html = readFileSync(htmlPath, 'utf-8');
  return { meta, html, dir };
}

function scan(): Post[] {
  if (!existsSync(BLOG_DIR)) return [];
  return readdirSync(BLOG_DIR)
    .filter(name => {
      const p = join(BLOG_DIR, name);
      try { return statSync(p).isDirectory(); } catch { return false; }
    })
    .map(loadOne)
    .filter((p): p is Post => p !== null)
    .sort((a, b) => b.meta.publishedAt.localeCompare(a.meta.publishedAt));
}

export function allPosts(): Post[] {
  if (IS_DEV || !cache) cache = scan();
  return cache;
}

export function publishedPosts(): Post[] {
  return allPosts().filter(p => p.meta.status === 'published');
}

export function getPost(slug: string): Post | null {
  return allPosts().find(p => p.meta.slug === slug) ?? null;
}

export function blogSitemapEntries(): { loc: string; lastmod: string }[] {
  return publishedPosts().map(p => ({
    loc: `https://drose.io/blog/${p.meta.slug}`,
    lastmod: (p.meta.updatedAt || p.meta.publishedAt).slice(0, 10),
  }));
}
