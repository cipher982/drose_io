import type { Context } from 'hono';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, normalize, resolve, extname } from 'path';
import { BLOG_DIR, getPost, publishedPosts, blogSitemapEntries } from './loader';
import { renderIndexPage, renderPostPage } from './layout';
import { renderRss } from './rss';

const SITE_URL = 'https://drose.io';

function xmlEsc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

export function blogIndex(c: Context) {
  return c.html(renderIndexPage(publishedPosts()));
}

export function blogRss(c: Context) {
  return c.body(renderRss(), 200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
}

export function blogSitemap(c: Context) {
  const today = new Date().toISOString().slice(0, 10);
  const entries = blogSitemapEntries().map(e => `
  <url>
    <loc>${xmlEsc(e.loc)}</loc>
    <lastmod>${xmlEsc(e.lastmod)}</lastmod>
  </url>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}/blog</loc>
    <lastmod>${today}</lastmod>
  </url>${entries}
</urlset>`;
  return c.body(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
}

export function blogPost(c: Context) {
  const slug = c.req.param('slug');
  if (!slug) return c.notFound();
  const post = getPost(slug);
  if (!post) return c.notFound();
  if (post.meta.status === 'draft' && c.req.query('preview') !== '1') {
    return c.notFound();
  }
  return c.html(renderPostPage(post));
}

const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
};

export async function blogAsset(c: Context) {
  const slug = c.req.param('slug');
  const assetPath = c.req.param('path');
  if (!slug || !assetPath) return c.notFound();
  if (!getPost(slug)) return c.notFound();

  const assetsRoot = resolve(join(BLOG_DIR, slug, 'assets'));
  const requested = resolve(join(assetsRoot, assetPath));
  if (!requested.startsWith(assetsRoot + '/') && requested !== assetsRoot) {
    return c.notFound();
  }
  if (!existsSync(requested)) return c.notFound();
  try {
    if (!statSync(requested).isFile()) return c.notFound();
  } catch {
    return c.notFound();
  }

  const file = Bun.file(requested);
  const mime = MIME[extname(requested).toLowerCase()] || 'application/octet-stream';
  return new Response(file, {
    headers: {
      'Content-Type': mime,
      'Cache-Control': c.req.query('v')
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=86400, must-revalidate',
    },
  });
}
