#!/usr/bin/env bun
/**
 * Converts Medium HTML exports → content/blog/<slug>/{index.html,meta.json,assets/*}
 *
 * Run once (or re-run safely — posts with existing meta.json are skipped).
 * Source: /tmp/medium-export/posts/*.html
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import * as cheerio from 'cheerio';
import DOMPurify from 'isomorphic-dompurify';
import { createHighlighter } from 'shiki';

const EXPORT_DIR = '/tmp/medium-export/posts';
const BLOG_DIR = join(import.meta.dir, '..', 'content/blog');

type PostSpec = {
  file: string;          // filename under /tmp/medium-export/posts/
  slug: string;          // curated clean slug
  summary: string;       // curated one-line summary
  tags: string[];
  codeLang?: string;     // default language for gist code blocks
};

const POSTS: PostSpec[] = [
  {
    file: '2017-10-09_Randomness-in-all-its-wonderful-forms--8c0e055c3351.html',
    slug: 'randomness-in-its-wonderful-forms',
    summary: 'A tour through randomness: what it is, how PRNGs work, and where true randomness comes from.',
    tags: ['statistics', 'probability'],
    codeLang: 'python',
  },
  {
    file: '2017-11-08_Lane-Tracking-via-Computer-Vision-2acb4c7c1c22.html',
    slug: 'lane-tracking-computer-vision',
    summary: 'Classical computer-vision techniques — color thresholds, perspective transforms, polynomial fits — to detect lane lines from a dashcam feed.',
    tags: ['computer-vision', 'self-driving-cars'],
    codeLang: 'python',
  },
  {
    file: '2017-12-19_Vehicle-MPC-Controller-33ae813cf3be.html',
    slug: 'vehicle-mpc-controller',
    summary: 'Implementing a Model Predictive Controller for autonomous vehicle steering and throttle — optimizing a cost function over a rolling horizon.',
    tags: ['control-systems', 'self-driving-cars'],
    codeLang: 'cpp',
  },
  {
    file: '2018-02-16_Autonomous-Vehicle-Path-Planning-f8027a5f83f8.html',
    slug: 'autonomous-vehicle-path-planning',
    summary: 'Building a path planner for a simulated highway: behavior planning, trajectory generation, and smooth lane changes in traffic.',
    tags: ['self-driving-cars', 'path-planning'],
    codeLang: 'cpp',
  },
  {
    file: '2018-09-26_Time-Series-Forecasting-for-Call-Center-Metrics-83f5ec6b84a6.html',
    slug: 'time-series-forecasting-call-center',
    summary: 'Forecasting call-center volume with classical time-series methods (ARIMA, Prophet) and comparing to neural approaches on real operational data.',
    tags: ['time-series', 'machine-learning'],
    codeLang: 'python',
  },
  {
    file: '2019-01-03_Collecting-Bananas-with-a-Deep-Q-Network-26c7a45d4c27.html',
    slug: 'deep-q-network-bananas',
    summary: 'Training a Deep Q-Network agent in Unity to collect yellow bananas and avoid blue ones — replay buffers, target networks, the DQN essentials.',
    tags: ['reinforcement-learning', 'deep-learning'],
    codeLang: 'python',
  },
  {
    file: '2020-09-29_Lessons-Migrating-a-Large-Project-to-TensorFlow-2-27174292aa37.html',
    slug: 'migrating-to-tensorflow-2',
    summary: 'Field notes from migrating a production TensorFlow 1.x project to TF 2.x — the traps, the compatibility shims, and what was actually worth the rewrite.',
    tags: ['tensorflow', 'machine-learning'],
    codeLang: 'python',
  },
  {
    file: '2021-07-05_Graph-Neural-Networks-3346c6fe7553.html',
    slug: 'graph-neural-networks-intro',
    summary: 'An intuition-first introduction to Graph Neural Networks: message passing, aggregation, and why GNNs unlock problems that grids and sequences cannot.',
    tags: ['graph-neural-networks', 'deep-learning'],
    codeLang: 'python',
  },
  {
    file: '2023-09-27_Fine-tuning-LLMs--Practical-Techniques-and-Helpful-Tips-3a169cc62cca.html',
    slug: 'fine-tuning-llms-practical-tips',
    summary: 'Practical techniques and hard-won tips for fine-tuning large language models: dataset prep, parameter-efficient methods, and evaluation.',
    tags: ['llm', 'fine-tuning', 'machine-learning'],
    codeLang: 'python',
  },
];

// ─────────────────────────────────────────────────────────────────

let highlighter: Awaited<ReturnType<typeof createHighlighter>> | null = null;

async function getShiki() {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ['github-dark'],
      langs: ['python', 'javascript', 'typescript', 'cpp', 'bash', 'json', 'yaml', 'plaintext'],
    });
  }
  return highlighter;
}

function upgradeCdnUrl(url: string): string {
  // Medium CDN: /max/800/... → /max/2048/... for retina quality.
  return url.replace(/\/max\/\d+\//, '/max/2048/');
}

function assetFilename(url: string, fallbackIdx: number): string {
  try {
    const last = basename(new URL(url).pathname);
    if (last && /\.[a-z0-9]+$/i.test(last)) return last;
  } catch {}
  return `image-${fallbackIdx}.png`;
}

async function downloadImage(url: string, destPath: string): Promise<boolean> {
  if (existsSync(destPath)) return true;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ! fetch ${url} → ${res.status}`);
      return false;
    }
    writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch (err) {
    console.warn(`  ! error ${url}: ${(err as Error).message}`);
    return false;
  }
}

async function fetchGistRaw(gistScriptSrc: string): Promise<{ code: string; lang: string } | null> {
  // Gist script src: https://gist.github.com/<user>/<id>.js
  const m = gistScriptSrc.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/);
  if (!m) return null;
  const [, user, id] = m;
  const apiUrl = `https://api.github.com/gists/${id}`;
  try {
    const res = await fetch(apiUrl);
    if (!res.ok) {
      console.warn(`  ! gist api ${id} → ${res.status}`);
      return null;
    }
    const data = await res.json() as { files?: Record<string, { content: string; language?: string }> };
    const files = data.files || {};
    const first = Object.values(files)[0];
    if (!first) return null;
    const langMap: Record<string, string> = {
      'Python': 'python', 'C++': 'cpp', 'JavaScript': 'javascript',
      'TypeScript': 'typescript', 'Shell': 'bash', 'JSON': 'json', 'YAML': 'yaml',
    };
    const lang = first.language && langMap[first.language] ? langMap[first.language] : 'python';
    return { code: first.content, lang };
  } catch (err) {
    console.warn(`  ! gist fetch ${id}: ${(err as Error).message}`);
    return null;
  }
}

async function convertPost(spec: PostSpec) {
  const htmlPath = join(EXPORT_DIR, spec.file);
  const raw = readFileSync(htmlPath, 'utf-8');
  const $ = cheerio.load(raw);

  const postDir = join(BLOG_DIR, spec.slug);
  const assetsDir = join(postDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });

  const metaPath = join(postDir, 'meta.json');
  if (existsSync(metaPath)) {
    console.log(`→ ${spec.slug}: meta.json exists, skipping (delete to re-run)`);
    return;
  }

  // Extract frontmatter-ish data
  const title = $('title').text().trim();
  const datetime = $('time.dt-published').attr('datetime') || new Date().toISOString();
  const canonical = $('a.p-canonical').attr('href') || '';

  // Grab body
  const body = $('section[data-field="body"]');
  if (!body.length) throw new Error(`no body for ${spec.file}`);

  // Remove duplicated title/subtitle Medium prepends
  body.find('h3.graf--title, h4.graf--subtitle').remove();

  // Strip section dividers
  body.find('div.section-divider, hr.section-divider').remove();

  // Unwrap aspectRatioPlaceholder divs — keep inner content
  body.find('div.aspectRatioPlaceholder').each((_, el) => {
    const $el = $(el);
    $el.replaceWith($el.contents());
  });

  // Delete empty spacer paragraphs
  body.find('p.graf--empty').remove();
  body.find('p').each((_, el) => {
    const $p = $(el);
    if (!$p.text().trim() && $p.find('img, video, iframe').length === 0) {
      $p.remove();
    }
  });

  // Rewrite links: if a tracking redirect, use data-href if present
  body.find('a').each((_, el) => {
    const $a = $(el);
    const href = $a.attr('href') || '';
    const dataHref = $a.attr('data-href');
    if (dataHref && href.startsWith('https://medium.com/r/')) {
      $a.attr('href', dataHref);
    }
    $a.removeAttr('data-href');
  });

  // Download images + rewrite srcs
  let imgIdx = 0;
  const imgEls = body.find('img').toArray();
  for (const el of imgEls) {
    imgIdx += 1;
    const $img = $(el);
    const src = $img.attr('src');
    if (!src) continue;
    const upgraded = upgradeCdnUrl(src);
    const filename = assetFilename(upgraded, imgIdx);
    const dest = join(assetsDir, filename);
    const ok = await downloadImage(upgraded, dest);
    if (ok) {
      $img.attr('src', `/blog/${spec.slug}/assets/${filename}`);
      $img.removeAttr('data-image-id');
      $img.removeAttr('data-width');
      $img.removeAttr('data-height');
      $img.removeAttr('data-is-featured');
    }
  }

  // Gist embed → <pre><code> with Shiki highlighting
  const gistFigs = body.find('figure').filter((_, el) => !!$(el).find('script[src*="gist.github.com"]').length).toArray();
  const shiki = await getShiki();
  for (const figEl of gistFigs) {
    const $fig = $(figEl);
    const $script = $fig.find('script[src*="gist.github.com"]').first();
    const src = $script.attr('src') || '';
    const gist = await fetchGistRaw(src);
    if (gist) {
      const highlighted = shiki.codeToHtml(gist.code, { lang: gist.lang, theme: 'github-dark' });
      $fig.replaceWith(highlighted);
    } else {
      // Fallback: plain link
      const m = src.match(/gist\.github\.com\/[^"]+/);
      const link = m ? `https://${m[0].replace(/\.js$/, '')}` : '';
      $fig.replaceWith(link ? `<p><a href="${link}">View gist on GitHub →</a></p>` : '');
    }
  }

  // Convert figures to clean figure+figcaption
  body.find('figure').each((_, el) => {
    const $fig = $(el);
    const $img = $fig.find('img').first();
    const $cap = $fig.find('figcaption');
    const caption = $cap.text().trim();
    if ($img.length) {
      if (caption) $img.attr('alt', caption);
      const figureHtml = `<figure>${$.html($img)}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
      $fig.replaceWith(figureHtml);
    } else {
      $fig.replaceWith($fig.contents());
    }
  });

  // Highlight any residual <pre><code> blocks
  body.find('pre code').each((_, el) => {
    const $code = $(el);
    const code = $code.text();
    const classAttr = $code.attr('class') || '';
    const langMatch = classAttr.match(/language-(\w+)/);
    const lang = langMatch ? langMatch[1] : (spec.codeLang || 'plaintext');
    try {
      const highlighted = shiki.codeToHtml(code, { lang: lang as any, theme: 'github-dark' });
      $code.parent('pre').replaceWith(highlighted);
    } catch {
      // unknown language — leave it
    }
  });

  // Strip all Medium classes + name attrs + ids on graf elements
  body.find('[class]').each((_, el) => {
    const $el = $(el);
    const cls = $el.attr('class') || '';
    // Keep shiki-generated classes (they start with the Shiki theme name)
    if (/shiki|github-dark|line/.test(cls)) return;
    $el.removeAttr('class');
  });
  body.find('[name]').each((_, el) => $(el).removeAttr('name'));
  body.find('[id]').each((_, el) => {
    const $el = $(el);
    const id = $el.attr('id') || '';
    // Keep shiki IDs
    if (id.startsWith('shiki')) return;
    $el.removeAttr('id');
  });

  // Unwrap leftover Medium structural sections/divs
  body.find('section, div').each((_, el) => {
    const $el = $(el);
    if ($el.find('figure, pre, img').length === 0 && !$el.attr('class')) {
      // plain wrapper — unwrap if it only contains inline-ish content
      const contentsHtml = $el.html() || '';
      $el.replaceWith(contentsHtml);
    }
  });

  // Final HTML
  let html = body.html() || '';

  // DOMPurify — permit things we want (iframes for future demos, figure/figcaption, shiki pre/code)
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'frameborder', 'style'],  // style needed for shiki inline colors
    FORBID_TAGS: ['script', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
  });

  // Collapse whitespace a bit
  html = html.replace(/\n{3,}/g, '\n\n').trim();

  // meta.json
  const meta = {
    title: title.replace(/"/g, '\\"'),
    slug: spec.slug,
    summary: spec.summary,
    publishedAt: datetime,
    updatedAt: datetime,
    tags: spec.tags,
    status: 'published',
    mediumUrl: canonical || undefined,
  };

  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  writeFileSync(join(postDir, 'index.html'), html + '\n');
  console.log(`✓ ${spec.slug} (${imgIdx} images, ${gistFigs.length} gists)`);
}

async function main() {
  mkdirSync(BLOG_DIR, { recursive: true });
  for (const spec of POSTS) {
    console.log(`\n→ ${spec.file}`);
    try {
      await convertPost(spec);
    } catch (err) {
      console.error(`✗ ${spec.slug}: ${(err as Error).message}`);
    }
  }
  console.log(`\nDone. Wrote posts under ${BLOG_DIR}`);
}

await main();
