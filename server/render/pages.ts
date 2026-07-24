/**
 * Renders the static HTML pages at boot instead of mutating tracked files.
 *
 * Replaces three build scripts (inject-umami, inject-latest-posts, bust-cache)
 * that rewrote templates/index.html, templates/admin.html, server/blog/layout.ts
 * and server/digests/hn.ts in place. That made `git status` dirty just from
 * running the dev server and made generated output indistinguishable from hand
 * edits.
 *
 * Templates live in templates/, deliberately outside public/, so the static
 * middleware can never serve an unrendered page with raw markers in it.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { buildUmamiScript } from '../umami';
import { publishedPosts } from '../blog/loader';
import { versionAssetsIn } from './assets';

const TEMPLATE_DIR = join(import.meta.dir, '../../templates');
const LATEST_COUNT = 3;

const UMAMI_BLOCK = /<!-- UMAMI_START -->[\s\S]*?<!-- UMAMI_END -->/;
const LATEST_BLOCK = /<!-- LATEST_POSTS_START -->[\s\S]*?<!-- LATEST_POSTS_END -->/;

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function renderLatestPosts(): string {
  const posts = publishedPosts().slice(0, LATEST_COUNT);
  const items = posts
    .map(
      p => `
            <li class="latest-post-item">
                <a href="/blog/${esc(p.meta.slug)}">
                    <span class="latest-post-title">${esc(p.meta.title)}</span>
                    <span class="latest-post-date">${formatDate(p.meta.publishedAt)}</span>
                </a>
                <p class="latest-post-summary">${esc(p.meta.summary)}</p>
            </li>`,
    )
    .join('');
  return `<!-- LATEST_POSTS_START -->
    <section class="latest-posts" aria-labelledby="latest-posts-heading">
        <h2 id="latest-posts-heading">Latest Writing</h2>
        <ul class="latest-posts-list">${items}
        </ul>
        <p class="latest-posts-more"><a href="/blog">All posts →</a></p>
    </section>
    <!-- LATEST_POSTS_END -->`;
}

function render(templateName: string, opts: { umami: boolean; latestPosts: boolean }): string {
  const path = join(TEMPLATE_DIR, templateName);
  if (!existsSync(path)) {
    throw new Error(`[render] missing template: ${path}`);
  }
  let html = readFileSync(path, 'utf-8');

  if (opts.umami) {
    if (!UMAMI_BLOCK.test(html)) {
      console.warn(`[render] ${templateName}: no UMAMI markers, analytics not injected`);
    } else {
      html = html.replace(UMAMI_BLOCK, `<!-- UMAMI_START -->\n${buildUmamiScript()}\n    <!-- UMAMI_END -->`);
    }
  }

  if (opts.latestPosts) {
    if (!LATEST_BLOCK.test(html)) {
      console.warn(`[render] ${templateName}: no LATEST_POSTS markers, homepage list not injected`);
    } else {
      html = html.replace(LATEST_BLOCK, renderLatestPosts());
    }
  }

  return versionAssetsIn(html);
}

/**
 * Rendered once at boot. Content changes require a restart, which is exactly
 * what a deploy does.
 */
let homeCache: string | null = null;
let adminCache: string | null = null;

export function homePage(): string {
  if (homeCache === null) homeCache = render('index.html', { umami: true, latestPosts: true });
  return homeCache;
}

export function adminPage(): string {
  // No Umami on admin: the template has never carried an analytics block.
  if (adminCache === null) adminCache = render('admin.html', { umami: false, latestPosts: false });
  return adminCache;
}
