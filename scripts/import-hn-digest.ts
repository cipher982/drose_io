import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import * as cheerio from 'cheerio';

const [dateArg, inputPath] = Bun.argv.slice(2);

if (!dateArg || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg) || !inputPath) {
  console.error('Usage: bun run scripts/import-hn-digest.ts YYYY-MM-DD path/to/email.html');
  process.exit(1);
}

if (!existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const raw = readFileSync(inputPath, 'utf-8');
const $ = cheerio.load(raw, { decodeEntities: false });

$('script, style, iframe, object, embed, form, input, link, meta').remove();
$('*').each((_, el) => {
  const attribs = { ...(el.attribs || {}) };
  for (const [name, value] of Object.entries(attribs)) {
    if (name === 'style' || /^on/i.test(name)) {
      $(el).removeAttr(name);
    }
    if ((name === 'href' || name === 'src') && /^javascript:/i.test(value.trim())) {
      $(el).removeAttr(name);
    }
  }
});

const bodyHtml = ($('body').html() || $.root().html() || '').trim();
const paragraphs = $('p')
  .map((_, p) => $(p).text().replace(/\s+/g, ' ').trim())
  .get()
  .filter(Boolean);

const summary = paragraphs[0]
  ? `${paragraphs[0].slice(0, 260)}${paragraphs[0].length > 260 ? '...' : ''}`
  : `Hacker News daily brief for ${dateArg}.`;

const generatedText = $.root().text();
const generatedMatch = generatedText.match(/Generated\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+UTC/i);
const publishedAt = generatedMatch
  ? `${generatedMatch[1]}T${generatedMatch[2]}:00.000Z`
  : `${dateArg}T08:00:00.000Z`;

const outDir = join(process.cwd(), 'content/digests/hn', dateArg);
mkdirSync(outDir, { recursive: true });

writeFileSync(join(outDir, 'index.html'), `${bodyHtml}\n`, 'utf-8');
writeFileSync(join(outDir, 'meta.json'), `${JSON.stringify({
  title: `HN Brief: ${dateArg}`,
  slug: dateArg,
  summary,
  publishedAt,
  status: 'published',
  tags: ['hacker-news', 'digest'],
  source: 'sauron',
}, null, 2)}\n`, 'utf-8');

console.log(`Imported HN digest ${dateArg} to ${outDir}`);
