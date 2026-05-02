/**
 * Walk every content/blog/*\/assets/*.gif and:
 *   1. Transcode to WebM (VP9) and MP4 (H.264) alongside the GIF.
 *   2. Mutate post HTML: swap <img src="*.gif"> for <video autoplay loop muted playsinline>
 *      with both sources.
 *   3. Leave the GIF on disk as a final fallback <img> source for ancient browsers.
 *
 * Uses /tmp/static-ffmpeg/ffmpeg (downloaded from evermeet.cx) since Homebrew's
 * default bottle drops libvpx-vp9. Falls back to system ffmpeg for H.264.
 *
 * Idempotent — skips GIFs already converted AND HTML that already uses <video>.
 */
import { readdirSync, statSync, existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { spawnSync } from 'child_process';
import * as cheerio from 'cheerio';

const BLOG_DIR = join(process.cwd(), 'content/blog');
const STATIC_FFMPEG = '/tmp/static-ffmpeg/ffmpeg';
const FFMPEG = existsSync(STATIC_FFMPEG) ? STATIC_FFMPEG : 'ffmpeg';

function findGifs(): string[] {
  const out: string[] = [];
  for (const slug of readdirSync(BLOG_DIR)) {
    const assetsDir = join(BLOG_DIR, slug, 'assets');
    if (!existsSync(assetsDir)) continue;
    try {
      for (const f of readdirSync(assetsDir)) {
        if (f.toLowerCase().endsWith('.gif')) out.push(join(assetsDir, f));
      }
    } catch {}
  }
  return out;
}

function bytes(p: string): number {
  try { return statSync(p).size; } catch { return 0; }
}

function kb(n: number): string {
  return (n / 1024).toFixed(1) + ' KB';
}

function transcode(gif: string): { webm: string; mp4: string; webmSize: number; mp4Size: number } {
  const webm = gif.replace(/\.gif$/i, '.webm');
  const mp4 = gif.replace(/\.gif$/i, '.mp4');
  const webmExists = bytes(webm) > 0;
  const mp4Exists = bytes(mp4) > 0;

  if (!webmExists) {
    // VP9 single-pass, crf 38 gave ~1.5MB on vehicle-mpc. Acceptable for most content.
    const res = spawnSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', gif,
      '-vf', 'format=yuv420p',
      '-c:v', 'libvpx-vp9',
      '-crf', '38',
      '-b:v', '0',
      '-deadline', 'good',
      '-cpu-used', '2',
      webm,
    ]);
    if (res.status !== 0) {
      console.warn(`  [webm FAIL] ${basename(gif)}: ${res.stderr?.toString().slice(0, 200)}`);
    }
  }

  if (!mp4Exists) {
    const res = spawnSync(FFMPEG, [
      '-y', '-loglevel', 'error',
      '-i', gif,
      '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',  // H.264 needs even dimensions
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      mp4,
    ]);
    if (res.status !== 0) {
      console.warn(`  [mp4 FAIL] ${basename(gif)}: ${res.stderr?.toString().slice(0, 200)}`);
    }
  }

  return { webm, mp4, webmSize: bytes(webm), mp4Size: bytes(mp4) };
}

async function rewriteHtml(postDir: string, gifsInPost: Map<string, { webmPath: string; mp4Path: string }>) {
  const htmlPath = join(postDir, 'index.html');
  const html = await readFile(htmlPath, 'utf-8');
  const $ = cheerio.load(html, { decodeEntities: false }, false);
  let changed = 0;

  $('img').each((_, el) => {
    const $img = $(el);
    const src = $img.attr('src') || '';
    if (!src.toLowerCase().endsWith('.gif')) return;

    // Skip if this <img> is already inside a <video> (fallback we wrote earlier)
    if ($img.parents('video').length > 0) return;

    // Resolve asset file name
    const gifFile = src.split('/').pop() || '';
    if (!gifsInPost.has(gifFile)) return;

    const webSrcWebm = src.replace(/\.gif$/i, '.webm');
    const webSrcMp4 = src.replace(/\.gif$/i, '.mp4');
    const webSrcGif = src;
    const alt = $img.attr('alt');
    const width = $img.attr('width');
    const height = $img.attr('height');

    // Build a <video> with both sources + <img> as final fallback.
    const attrs: string[] = [
      'autoplay', 'loop', 'muted', 'playsinline',
      'preload="metadata"',
    ];
    if (width) attrs.push(`width="${width}"`);
    if (height) attrs.push(`height="${height}"`);
    if (alt) attrs.push(`aria-label="${alt.replace(/"/g, '&quot;')}"`);

    const videoHtml = `<video ${attrs.join(' ')}><source src="${webSrcWebm}" type="video/webm"><source src="${webSrcMp4}" type="video/mp4"><img src="${webSrcGif}" alt="${alt || ''}" loading="lazy" decoding="async"${width ? ` width="${width}"` : ''}${height ? ` height="${height}"` : ''}></video>`;

    $img.replaceWith(videoHtml);
    changed++;
  });

  if (changed > 0) {
    await writeFile(htmlPath, $.html());
  }
  return changed;
}

async function main() {
  const gifs = findGifs();
  console.log(`Found ${gifs.length} GIFs across all posts.\n`);

  // Per-post gif filename set for html pass
  const perPost = new Map<string, Map<string, { webmPath: string; mp4Path: string }>>();

  let totalBefore = 0, totalAfterWebm = 0, totalAfterMp4 = 0;

  for (const gif of gifs) {
    const before = bytes(gif);
    totalBefore += before;
    const { webm, mp4, webmSize, mp4Size } = transcode(gif);
    totalAfterWebm += webmSize;
    totalAfterMp4 += mp4Size;
    const saving = before > 0 ? (100 * (1 - Math.max(webmSize, 1) / before)).toFixed(1) : '?';
    console.log(`  ${basename(gif)}`);
    console.log(`    gif=${kb(before)}  webm=${kb(webmSize)}  mp4=${kb(mp4Size)}  webm-savings=${saving}%`);

    const postDir = dirname(dirname(gif));
    if (!perPost.has(postDir)) perPost.set(postDir, new Map());
    perPost.get(postDir)!.set(basename(gif), { webmPath: webm, mp4Path: mp4 });
  }

  console.log(`\nTotals: gif=${kb(totalBefore)}  webm=${kb(totalAfterWebm)}  mp4=${kb(totalAfterMp4)}`);
  console.log(`Saved: ${kb(totalBefore - totalAfterWebm)} (webm path), ${kb(totalBefore - totalAfterMp4)} (mp4 path)\n`);

  console.log('Rewriting HTML...');
  for (const [postDir, gifMap] of perPost) {
    const n = await rewriteHtml(postDir, gifMap);
    if (n > 0) console.log(`  ✅ ${basename(postDir)} — ${n} <img>→<video>`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
