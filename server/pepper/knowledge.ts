/**
 * What Pepper knows: only what the site already publishes. Built from the same
 * sources a visitor can read (llms.txt, the homepage project cards, published
 * post metadata) so Pepper cannot leak anything the site does not show.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { publishedPosts } from '../blog/loader';

const ROOT = join(import.meta.dir, '..', '..');

function projectCards(): string[] {
  const html = readFileSync(join(ROOT, 'templates', 'index.html'), 'utf-8');
  const out: string[] = [];
  const re = /<div class="section-header">([^<]+)<\/div>\s*<a href="([^"]+)"[\s\S]*?<p>([\s\S]*?)<\/p>/g;
  for (const m of html.matchAll(re)) {
    const [_, name, href, desc] = m;
    const url = href.startsWith('http') ? href : `https://drose.io${href.startsWith('/') ? '' : '/'}${href}`;
    out.push(`- ${name.trim()} (${url}): ${desc.replace(/\s+/g, ' ').trim()}`);
  }
  return out;
}

function posts(): string[] {
  return publishedPosts().map(p =>
    `- "${p.meta.title}" (https://drose.io/blog/${p.meta.slug}, ${p.meta.publishedAt.slice(0, 10)}): ${p.meta.summary}`);
}

let cached: string | null = null;

export function siteKnowledge(): string {
  if (cached) return cached;
  const llms = readFileSync(join(ROOT, 'public', 'llms.txt'), 'utf-8');
  cached = [
    '## llms.txt',
    llms.trim(),
    '## Homepage projects',
    ...projectCards(),
    '## Published blog posts (newest first)',
    ...posts(),
  ].join('\n');
  return cached;
}
