import type { Context } from 'hono';
import { marked, Renderer } from 'marked';
import hljs from 'highlight.js';
import { listPosts, loadPost, type BlogPost } from '../storage/blog';
import { buildUmamiScript } from '../umami';

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


const BLOG_STYLES = `
  body {
    margin: 0;
    font-family: var(--font-system);
    background: var(--color-blog-bg);
    color: var(--color-blog-text);
  }
  .blog-shell {
    max-width: var(--max-width-blog);
    margin: 0 auto;
    padding: var(--spacing-3xl) var(--spacing-xl) var(--spacing-6xl);
  }
  .blog-header {
    text-align: center;
    margin-bottom: var(--spacing-4xl);
  }
  .blog-header h1 {
    font-size: clamp(var(--font-size-7xl), 6vw, 48px);
    margin-bottom: var(--spacing-md);
  }
  .blog-header p {
    color: var(--color-blog-subtitle);
    font-size: var(--font-size-2xl);
  }
  .blog-card {
    background: var(--color-blog-card-bg);
    border-radius: var(--border-radius-xl);
    padding: var(--spacing-3xl);
    border: var(--border-width-thin) solid var(--color-blog-card-border);
    box-shadow: var(--shadow-blog-card);
    margin-bottom: var(--spacing-2xl);
    transition: transform var(--duration-fast) var(--timing-ease), box-shadow var(--duration-fast) var(--timing-ease);
  }
  .blog-card:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-blog-card-hover);
  }
  .blog-card h2 {
    font-size: var(--font-size-4xl);
    margin: 0 0 var(--spacing-lg);
  }
  .blog-card a {
    color: inherit;
    text-decoration: none;
  }
  .blog-card .meta {
    font-size: var(--font-size-md);
    color: var(--color-blog-meta);
    margin-bottom: var(--spacing-lg);
  }
  .blog-card .summary {
    font-size: var(--font-size-xl);
    line-height: var(--line-height-comfortable);
  }
  .blog-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--spacing-md);
    margin-top: var(--spacing-xl);
  }
  .blog-tag {
    background: var(--color-blog-tag-bg);
    color: var(--color-blog-tag-text);
    border-radius: var(--border-radius-pill);
    padding: var(--spacing-sm) var(--spacing-lg);
    font-size: var(--font-size-base);
    letter-spacing: 0.02em;
  }
  article.blog-post {
    background: var(--color-blog-card-bg);
    border-radius: var(--border-radius-xl);
    padding: clamp(var(--spacing-2xl), 5vw, var(--spacing-5xl));
    border: var(--border-width-thin) solid var(--color-blog-card-border);
    box-shadow: var(--shadow-blog-post);
  }
  article.blog-post h1 {
    font-size: clamp(var(--font-size-7xl), 6vw, var(--font-size-8xl));
    margin-bottom: var(--spacing-sm);
  }
  article.blog-post .meta {
    color: var(--color-blog-meta);
    margin-bottom: var(--spacing-4xl);
    font-size: var(--font-size-xl);
  }
  article.blog-post img {
    max-width: 100%;
    border-radius: var(--border-radius-lg);
    margin: var(--spacing-3xl) auto;
    display: block;
  }
  article.blog-post pre {
    background: var(--color-blog-code-block-bg);
    color: var(--color-blog-code-block-text);
    padding: var(--spacing-2xl);
    overflow: auto;
    border-radius: var(--border-radius-lg);
    font-size: var(--font-size-lg);
  }
  article.blog-post code {
    background: var(--color-blog-code-bg);
    padding: var(--spacing-xs) var(--spacing-md);
    border-radius: var(--border-radius-sm);
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
    font-family: var(--font-code);
  }
  .hljs {
    background: transparent;
    color: inherit;
  }
  .hljs-comment,
  .hljs-quote {
    color: var(--color-hljs-comment);
    font-style: italic;
  }
  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-literal,
  .hljs-title,
  .hljs-section {
    color: var(--color-hljs-keyword);
  }
  .hljs-string,
  .hljs-doctag,
  .hljs-name,
  .hljs-attr {
    color: var(--color-hljs-string);
  }
  .hljs-built_in,
  .hljs-bullet,
  .hljs-code {
    color: var(--color-hljs-builtin);
  }
  article.blog-post h2 {
    margin-top: 36px;
    font-size: var(--font-size-6xl);
  }
  article.blog-post h3 {
    margin-top: 28px;
    font-size: var(--font-size-3xl);
  }
  article.blog-post p, article.blog-post li {
    font-size: var(--font-size-2xl);
    line-height: var(--line-height-spacious);
    color: var(--color-blog-body-text);
  }
  article.blog-post blockquote {
    margin: var(--spacing-3xl) 0;
    padding: var(--spacing-lg) var(--spacing-2xl);
    border-left: var(--border-width-thick) solid var(--color-blog-blockquote-border);
    background: var(--color-blog-blockquote-bg);
    color: var(--color-blog-blockquote-text);
  }
  .back-link {
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-md);
    color: var(--color-blog-back-link);
    text-decoration: none;
    margin-bottom: var(--spacing-3xl);
    font-weight: var(--font-weight-semibold);
  }
  .back-link:hover {
    color: var(--color-blog-back-link-hover);
  }
  @media (max-width: 640px) {
    .blog-card {
      padding: var(--spacing-2xl);
    }
    article.blog-post {
      padding: var(--spacing-2xl) var(--spacing-xl);
      border-radius: var(--border-radius-none);
    }
    .blog-shell {
      padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-5xl);
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
      <link rel="stylesheet" href="/assets/css/tokens.css">
      <link rel="stylesheet" href="/assets/css/win98-theme.css">
      <link rel="stylesheet" href="/assets/css/styles.css">
      ${buildUmamiScript()}
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
