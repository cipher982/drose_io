import { buildUmamiScript } from '../umami';
import type { Post } from './types';

const SITE_URL = 'https://drose.io';
const DEFAULT_OG_IMAGE = `${SITE_URL}/assets/images/david-og.jpg`;
const AUTHOR_NAME = 'David Rose';

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

const BLOG_STYLES = `
  body { margin: 0; color: var(--color-blog-text); font-family: var(--font-system); }
  .blog-nav { max-width: var(--max-width-blog); margin: 0 auto; padding: var(--spacing-xl) var(--spacing-xl) 0; position: relative; z-index: 2; }
  .blog-nav a { color: var(--color-blog-back-link); text-decoration: none; font-weight: var(--font-weight-semibold); }
  .blog-nav a:hover { color: var(--color-blog-back-link-hover); }
  .blog-shell { max-width: var(--max-width-blog); margin: 0 auto; padding: var(--spacing-3xl) var(--spacing-xl) var(--spacing-6xl); position: relative; z-index: 2; }
  .blog-header { text-align: center; margin-bottom: var(--spacing-4xl); }
  .blog-header h1 { font-size: clamp(var(--font-size-7xl), 6vw, 48px); margin-bottom: var(--spacing-md); color: var(--color-blog-text); background: linear-gradient(135deg, #a5b4fc 0%, #6366f1 50%, #a855f7 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
  .blog-header p { color: var(--color-blog-subtitle); font-size: var(--font-size-2xl); }
  .blog-card { background: var(--color-blog-card-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: var(--border-radius-xl); padding: var(--spacing-3xl); border: var(--border-width-thin) solid var(--color-blog-card-border); box-shadow: 0 4px 24px var(--color-blog-card-shadow); margin-bottom: var(--spacing-2xl); transition: transform var(--duration-fast) var(--timing-ease), box-shadow var(--duration-fast) var(--timing-ease), border-color var(--duration-fast) var(--timing-ease); }
  .blog-card:hover { transform: translateY(-2px); box-shadow: 0 8px 40px var(--color-blog-card-shadow-hover); border-color: rgba(99, 102, 241, 0.3); }
  .blog-card h2 { font-size: var(--font-size-4xl); margin: 0 0 var(--spacing-lg); }
  .blog-card a { color: inherit; text-decoration: none; }
  .blog-card .meta { font-size: var(--font-size-md); color: var(--color-blog-meta); margin-bottom: var(--spacing-lg); }
  .blog-card .summary { font-size: var(--font-size-xl); line-height: var(--line-height-comfortable); }
  .blog-tags { display: flex; flex-wrap: wrap; gap: var(--spacing-md); margin-top: var(--spacing-xl); }
  .blog-tag { background: var(--color-blog-tag-bg); color: var(--color-blog-tag-text); border-radius: var(--border-radius-pill); padding: var(--spacing-sm) var(--spacing-lg); font-size: var(--font-size-base); letter-spacing: 0.02em; }
  article.blog-post { background: var(--color-blog-card-bg); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-radius: var(--border-radius-xl); padding: clamp(var(--spacing-2xl), 5vw, var(--spacing-5xl)); border: var(--border-width-thin) solid var(--color-blog-card-border); box-shadow: 0 8px 40px var(--color-blog-card-shadow); }
  article.blog-post h1 { font-size: clamp(var(--font-size-7xl), 6vw, var(--font-size-8xl)); margin: 0 0 var(--spacing-sm); color: var(--color-blog-text); }
  article.blog-post a { color: #a5b4fc; }
  article.blog-post a:hover { color: #c7d2fe; }
  article.blog-post .meta { color: var(--color-blog-meta); margin-bottom: var(--spacing-4xl); font-size: var(--font-size-xl); }
  article.blog-post h2 { margin-top: 36px; font-size: var(--font-size-6xl); }
  article.blog-post h3 { margin-top: 28px; font-size: var(--font-size-3xl); }
  article.blog-post p, article.blog-post li { font-size: var(--font-size-2xl); line-height: var(--line-height-spacious); color: var(--color-blog-body-text); }
  article.blog-post img, article.blog-post video, article.blog-post iframe { max-width: 100%; border-radius: var(--border-radius-lg); margin: var(--spacing-3xl) auto; display: block; }
  article.blog-post figure { margin: var(--spacing-3xl) 0; }
  article.blog-post figcaption { text-align: center; color: var(--color-blog-meta); font-size: var(--font-size-md); margin-top: var(--spacing-sm); }
  article.blog-post pre { background: var(--color-blog-code-block-bg); color: var(--color-blog-code-block-text); padding: var(--spacing-2xl); overflow: auto; border-radius: var(--border-radius-lg); font-size: var(--font-size-lg); }
  article.blog-post code { background: var(--color-blog-code-bg); padding: var(--spacing-xs) var(--spacing-md); border-radius: var(--border-radius-sm); font-family: var(--font-code); }
  article.blog-post pre code { background: transparent; padding: 0; }
  article.blog-post blockquote { margin: var(--spacing-3xl) 0; padding: var(--spacing-lg) var(--spacing-2xl); border-left: var(--border-width-thick) solid var(--color-blog-blockquote-border); background: var(--color-blog-blockquote-bg); color: var(--color-blog-blockquote-text); }
  .medium-origin { margin-top: var(--spacing-4xl); padding-top: var(--spacing-2xl); border-top: var(--border-width-thin) solid var(--color-blog-card-border); color: var(--color-blog-meta); font-size: var(--font-size-base); font-style: italic; }
  @media (max-width: 640px) {
    .blog-card { padding: var(--spacing-2xl); }
    article.blog-post { padding: var(--spacing-2xl) var(--spacing-xl); border-radius: var(--border-radius-none); }
    .blog-shell { padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-5xl); }
  }
`;

function pageShell(opts: {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
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
<meta property="og:image" content="${esc(opts.ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<meta name="twitter:image" content="${esc(opts.ogImage)}">
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="stylesheet" href="/assets/css/tokens.css">
<link rel="stylesheet" href="/assets/css/win98-theme.css">
${buildUmamiScript()}
<style>${BLOG_STYLES}</style>
${opts.extraHead || ''}
</head>
<body>
<nav class="blog-nav"><a href="/">← drose.io</a></nav>
${opts.body}
</body>
</html>`;
}

export function renderIndexPage(posts: Post[]): string {
  const cards = posts.map(p => {
    const tags = (p.meta.tags ?? []).map(t => `<span class="blog-tag">${esc(t)}</span>`).join('');
    return `
<article class="blog-card">
  <a href="/blog/${esc(p.meta.slug)}"><h2>${esc(p.meta.title)}</h2></a>
  <div class="meta">${formatDate(p.meta.publishedAt)}</div>
  <p class="summary">${esc(p.meta.summary)}</p>
  ${tags ? `<div class="blog-tags">${tags}</div>` : ''}
</article>`;
  }).join('\n');

  const body = `
<div class="blog-shell">
  <div class="blog-header">
    <h1>Writing &amp; Research</h1>
    <p>Notes on AI agents, ML systems, and engineering experiments.</p>
  </div>
  ${cards || '<p style="text-align:center;opacity:0.6">No posts yet.</p>'}
  <p style="text-align:center;margin-top:var(--spacing-4xl);opacity:0.6">
    <a href="/blog/rss.xml" style="color:var(--color-blog-back-link)">RSS feed</a>
  </p>
</div>`;

  return pageShell({
    title: 'Writing & Research — David Rose',
    description: 'Long-form posts on AI agents, ML systems, and engineering notes by David Rose.',
    canonical: `${SITE_URL}/blog`,
    ogImage: DEFAULT_OG_IMAGE,
    body,
  });
}

export function renderPostPage(post: Post): string {
  const { meta, html } = post;
  const canonical = `${SITE_URL}/blog/${meta.slug}`;
  const ogImage = meta.heroImage
    ? (meta.heroImage.startsWith('http') ? meta.heroImage : `${SITE_URL}${meta.heroImage}`)
    : DEFAULT_OG_IMAGE;

  const tagsHtml = (meta.tags ?? []).map(t => `<span class="blog-tag">${esc(t)}</span>`).join('');
  const medium = meta.mediumUrl
    ? `<p class="medium-origin">Originally published on <a href="${esc(meta.mediumUrl)}" target="_blank" rel="noopener noreferrer">Medium</a>.</p>`
    : '';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: meta.title,
    description: meta.summary,
    datePublished: meta.publishedAt,
    dateModified: meta.updatedAt || meta.publishedAt,
    author: { '@type': 'Person', name: AUTHOR_NAME, url: SITE_URL },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    image: ogImage,
    keywords: (meta.tags ?? []).join(', ') || undefined,
  };

  const body = `
<div class="blog-shell">
  <article class="blog-post">
    <h1>${esc(meta.title)}</h1>
    <div class="meta">
      <time datetime="${esc(meta.publishedAt)}">${formatDate(meta.publishedAt)}</time>
      ${tagsHtml ? ` · <span class="blog-tags" style="display:inline-flex">${tagsHtml}</span>` : ''}
    </div>
    ${html}
    ${medium}
  </article>
</div>`;

  return pageShell({
    title: `${meta.title} — David Rose`,
    description: meta.summary,
    canonical,
    ogImage,
    ogType: 'article',
    extraHead: `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
    body,
  });
}
