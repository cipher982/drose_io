#!/usr/bin/env bun
/**
 * Build script: injects the 3 most recent published blog posts into
 * public/index.html between markers, so the homepage auto-surfaces fresh
 * writing for crawlers and humans without a manual edit per post.
 *
 * Markers in index.html:
 *   <!-- LATEST_POSTS_START -->...<!-- LATEST_POSTS_END -->
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const BLOG_DIR = join(ROOT, 'content/blog');
const HOMEPAGE = join(ROOT, 'public/index.html');
const COUNT = 3;

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

type Meta = { title: string; slug: string; summary: string; publishedAt: string; status: string };

function loadPublishedPosts(): Meta[] {
  if (!existsSync(BLOG_DIR)) return [];
  const out: Meta[] = [];
  for (const name of readdirSync(BLOG_DIR)) {
    const dir = join(BLOG_DIR, name);
    try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
    const metaPath = join(dir, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const m = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (m.status !== 'published') continue;
      if (!m.title || !m.slug || !m.publishedAt) continue;
      out.push(m);
    } catch {}
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

function renderBlock(posts: Meta[]): string {
  const items = posts.slice(0, COUNT).map(p => `
            <li class="latest-post-item">
                <a href="/blog/${esc(p.slug)}">
                    <span class="latest-post-title">${esc(p.title)}</span>
                    <span class="latest-post-date">${formatDate(p.publishedAt)}</span>
                </a>
                <p class="latest-post-summary">${esc(p.summary)}</p>
            </li>`).join('');
  return `<!-- LATEST_POSTS_START -->
    <section class="latest-posts" aria-labelledby="latest-posts-heading">
        <h2 id="latest-posts-heading">Latest Writing</h2>
        <ul class="latest-posts-list">${items}
        </ul>
        <p class="latest-posts-more"><a href="/blog">All posts →</a></p>
    </section>
    <!-- LATEST_POSTS_END -->`;
}

function run() {
  if (!existsSync(HOMEPAGE)) {
    console.warn(`⚠️  homepage not found: ${HOMEPAGE}`);
    return;
  }
  const posts = loadPublishedPosts();
  if (posts.length === 0) {
    console.warn('⚠️  no published posts found, skipping latest-posts injection');
    return;
  }
  const html = readFileSync(HOMEPAGE, 'utf-8');
  const block = renderBlock(posts);
  const re = /<!-- LATEST_POSTS_START -->[\s\S]*?<!-- LATEST_POSTS_END -->/;
  if (!re.test(html)) {
    console.warn('⚠️  LATEST_POSTS markers not found in index.html — skipping');
    return;
  }
  const next = html.replace(re, block);
  Bun.write(HOMEPAGE, next);
  console.log(`✅ injected ${Math.min(posts.length, COUNT)} latest post(s) into index.html`);
}

run();
