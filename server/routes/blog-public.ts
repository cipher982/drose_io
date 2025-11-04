import type { Context } from 'hono';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import { listPosts, loadPost, type BlogPost } from '../storage/blog';

const renderer = new Renderer();
const originalLink = renderer.link.bind(renderer);
renderer.link = (href, title, text) => {
  const html = originalLink(href, title, text);
  if (!href) {
    return html;
  }
  const isExternal = /^https?:\/\//i.test(href) && !href.startsWith('https://drose.io');
  if (!isExternal) {
    return html;
  }
  return html.replace('<a ', '<a target="_blank" rel="noopener noreferrer" ');
};

marked.use({ mangle: false, headerIds: true, renderer });
marked.setOptions({
  highlight(code, lang) {
    try {
      const validLanguage = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language: validLanguage }).value;
    } catch {
      return hljs.highlight(code, { language: 'plaintext' }).value;
    }
  },
});

const UMAMI_SCRIPT = '<script defer src="https://analytics.drose.io/script.js" data-website-id="33e9b5a0-5fbf-474c-9d60-9bee34d577bd"></script>';

const BLOG_STYLES = `
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f1f1f1;
    color: #1d1d1f;
  }
  .blog-shell {
    max-width: 920px;
    margin: 0 auto;
    padding: 24px 16px 60px;
  }
  .blog-header {
    text-align: center;
    margin-bottom: 32px;
  }
  .blog-header h1 {
    font-size: clamp(32px, 6vw, 48px);
    margin-bottom: 8px;
  }
  .blog-header p {
    color: #555;
    font-size: 18px;
  }
  .blog-card {
    background: white;
    border-radius: 12px;
    padding: 24px;
    border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 4px 16px rgba(0,0,0,0.05);
    margin-bottom: 20px;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .blog-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  }
  .blog-card h2 {
    font-size: 26px;
    margin: 0 0 12px;
  }
  .blog-card a {
    color: inherit;
    text-decoration: none;
  }
  .blog-card .meta {
    font-size: 14px;
    color: #666;
    margin-bottom: 12px;
  }
  .blog-card .summary {
    font-size: 17px;
    line-height: 1.55;
  }
  .blog-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 16px;
  }
  .blog-tag {
    background: #eef2ff;
    color: #3730a3;
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 13px;
    letter-spacing: 0.02em;
  }
  article.blog-post {
    background: white;
    border-radius: 12px;
    padding: clamp(20px, 5vw, 40px);
    border: 1px solid rgba(0,0,0,0.08);
    box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  article.blog-post h1 {
    font-size: clamp(32px, 6vw, 52px);
    margin-bottom: 4px;
  }
  article.blog-post .meta {
    color: #666;
    margin-bottom: 32px;
    font-size: 16px;
  }
  article.blog-post img {
    max-width: 100%;
    border-radius: 8px;
    margin: 24px auto;
    display: block;
  }
  article.blog-post pre {
    background: #0f172a;
    color: #f8fafc;
    padding: 18px;
    overflow: auto;
    border-radius: 8px;
    font-size: 15px;
  }
  article.blog-post code {
    background: #edf2ff;
    padding: 2px 6px;
    border-radius: 4px;
  }
  article.blog-post pre code {
    background: transparent;
    padding: 0;
  }
  article.blog-post pre code.hljs {
    display: block;
    overflow-x: auto;
  }
  article.blog-post code:not(.hljs) {
    font-family: 'Menlo', 'Fira Code', monospace;
  }
  .hljs {
    background: transparent;
    color: inherit;
  }
  .hljs-comment,
  .hljs-quote {
    color: #94a3b8;
    font-style: italic;
  }
  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-literal,
  .hljs-title,
  .hljs-section {
    color: #38bdf8;
  }
  .hljs-string,
  .hljs-doctag,
  .hljs-name,
  .hljs-attr {
    color: #22c55e;
  }
  .hljs-built_in,
  .hljs-bullet,
  .hljs-code {
    color: #facc15;
  }
  article.blog-post h2 {
    margin-top: 36px;
    font-size: 30px;
  }
  article.blog-post h3 {
    margin-top: 28px;
    font-size: 24px;
  }
  article.blog-post p, article.blog-post li {
    font-size: 18px;
    line-height: 1.7;
    color: #202124;
  }
  article.blog-post blockquote {
    margin: 24px 0;
    padding: 12px 20px;
    border-left: 4px solid #6366f1;
    background: #f5f7ff;
    color: #1f2937;
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #555;
    text-decoration: none;
    margin-bottom: 24px;
    font-weight: 600;
  }
  .back-link:hover {
    color: #111;
  }
  @media (max-width: 640px) {
    .blog-card {
      padding: 20px;
    }
    article.blog-post {
      padding: 20px 16px;
      border-radius: 0;
    }
    .blog-shell {
      padding: 12px 12px 40px;
    }
  }
`;

export function renderBlogIndex(c: Context) {
  const posts = listPosts().filter(post => post.frontmatter.status === 'published');
  const page = renderPage({
    title: 'David Rose — Blog',
    description: 'Long-form posts on AI agents, orchestration systems, and engineering notes by David Rose.',
    content: `
      <div class="blog-shell">
        <div class="blog-header">
          <h1>Writing & Research</h1>
          <p>Deeper dives into agentic systems, product experiments, and long-form engineering notes.</p>
        </div>
        ${posts.map(renderListCard).join('')}
      </div>
    `,
  });
  return c.html(page);
}

export function renderBlogPost(c: Context) {
  const { slug } = c.req.param();
  const post = loadPost(slug);

  if (!post || post.frontmatter.status !== 'published') {
    return c.notFound();
  }

  const html = marked.parse(post.content);
  const tagsHtml = (post.frontmatter.tags ?? []).map(tagPill).join('');
  const page = renderPage({
    title: `${post.frontmatter.title} — David Rose`,
    description: post.frontmatter.summary || summarize(post.content),
    content: `
      <div class="blog-shell">
        <a class="back-link" href="/blog">← Back to posts</a>
        <article class="blog-post">
          <h1>${escapeHtml(post.frontmatter.title)}</h1>
          <div class="meta">${formatPublishedDate(post.frontmatter.publishedAt)}${tagsHtml ? ` · ${tagsHtml}` : ''}</div>
          ${html}
        </article>
      </div>
    `,
  });

  return c.html(page);
}

function renderListCard(post: BlogPost) {
  if (!post) return '';
  const summary = post.frontmatter.summary || summarize(post.content);
  const tagsHtml = (post.frontmatter.tags ?? []).map(tagPill).join('');
  return `
    <article class="blog-card">
      <a href="/blog/${encodeURIComponent(post.frontmatter.slug)}">
        <h2>${escapeHtml(post.frontmatter.title)}</h2>
      </a>
      <div class="meta">${formatPublishedDate(post.frontmatter.publishedAt)}</div>
      <p class="summary">${escapeHtml(summary)}</p>
      ${tagsHtml ? `<div class="blog-tags">${tagsHtml}</div>` : ''}
    </article>
  `;
}

function tagPill(tag: string) {
  return `<span class="blog-tag">${escapeHtml(tag)}</span>`;
}

function renderPage({ title, description, content }: { title: string; description: string; content: string; }) {
  return `<!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(title)}</title>
      <meta name="description" content="${escapeHtml(description)}">
      <link rel="stylesheet" href="/assets/css/win98-theme.css">
      <link rel="stylesheet" href="/assets/css/styles.css">
      ${UMAMI_SCRIPT}
      <style>${BLOG_STYLES}</style>
    </head>
    <body>
      ${content}
    </body>
  </html>`;
}

function formatPublishedDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function summarize(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= 160) {
    return text;
  }
  return `${text.slice(0, 157).trimEnd()}…`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
