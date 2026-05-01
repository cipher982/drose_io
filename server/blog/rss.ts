import { publishedPosts } from './loader';

const SITE_URL = 'https://drose.io';

function xmlEsc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Strip <script>, <iframe>, <object>, <embed> for feed-reader safety; rewrite relative URLs to absolute.
function sanitizeForFeed(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(src|href)="\/([^"]*)"/g, `$1="${SITE_URL}/$2"`)
    .replace(/(src|href)='\/([^']*)'/g, `$1='${SITE_URL}/$2'`);
}

export function renderRss(): string {
  const posts = publishedPosts();
  const latest = posts[0]?.meta.publishedAt || new Date().toISOString();

  const items = posts.map(p => {
    const link = `${SITE_URL}/blog/${p.meta.slug}`;
    const pubDate = new Date(p.meta.publishedAt).toUTCString();
    const sanitized = sanitizeForFeed(p.html);
    return `
    <item>
      <title>${xmlEsc(p.meta.title)}</title>
      <link>${xmlEsc(link)}</link>
      <guid isPermaLink="true">${xmlEsc(link)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${xmlEsc(p.meta.summary)}</description>
      <content:encoded><![CDATA[${sanitized}]]></content:encoded>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>David Rose — Writing &amp; Research</title>
    <link>${SITE_URL}/blog</link>
    <atom:link href="${SITE_URL}/blog/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Long-form posts on AI agents, ML systems, and engineering notes.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date(latest).toUTCString()}</lastBuildDate>${items}
  </channel>
</rss>`;
}
