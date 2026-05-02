/**
 * Walk every content/blog/*\/index.html, find any <pre><code class="language-X">…</code></pre>
 * block that does NOT already contain shiki/github-dark markup, and replace it with a
 * shiki-highlighted version (theme: github-dark). Matches how migrate-medium-v2.ts bakes
 * code blocks during Medium import.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';
import { createHighlighter } from 'shiki';

const BLOG_DIR = join(process.cwd(), 'content/blog');

async function main() {
  const highlighter = await createHighlighter({
    themes: ['github-dark'],
    langs: ['python', 'bash', 'typescript', 'javascript', 'cpp', 'json', 'html', 'css'],
  });

  const dirs = readdirSync(BLOG_DIR).filter((n) => {
    try { return statSync(join(BLOG_DIR, n)).isDirectory(); } catch { return false; }
  });

  for (const dir of dirs) {
    const htmlPath = join(BLOG_DIR, dir, 'index.html');
    let html: string;
    try { html = readFileSync(htmlPath, 'utf-8'); } catch { continue; }

    const $ = cheerio.load(html, { decodeEntities: false }, false);

    let changed = 0;
    $('pre').each((_, el) => {
      const $pre = $(el);
      const cls = $pre.attr('class') || '';
      // Skip already-shiki blocks
      if (/shiki|github-dark/.test(cls)) return;
      const $code = $pre.find('code').first();
      if (!$code.length) return;
      const codeCls = $code.attr('class') || '';
      const langMatch = codeCls.match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : 'plaintext';
      const code = $code.text();
      if (!code.trim()) return;

      try {
        const highlighted = highlighter.codeToHtml(code, { lang: lang as any, theme: 'github-dark' });
        $pre.replaceWith(highlighted);
        changed++;
      } catch (err) {
        console.warn(`  [${dir}] could not highlight lang=${lang}: ${(err as Error).message}`);
      }
    });

    if (changed > 0) {
      writeFileSync(htmlPath, $.html());
      console.log(`✅ ${dir} — highlighted ${changed} block(s)`);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
