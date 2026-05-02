#!/usr/bin/env bun
/**
 * Optimize blog images under content/blog/<slug>/assets/**.
 *
 * - Resizes any raster image wider than MAX_WIDTH (1840px, 2x for 920px column)
 *   to MAX_WIDTH, preserving aspect ratio.
 * - Re-encodes png/jpg with sane compression settings.
 * - Generates a .webp sibling for png/jpg/jpeg (not for gifs).
 * - Skips GIFs entirely for resize/webp (animated; not worth it).
 * - Idempotent: tracks processed files in .optimized.json per-slug.
 *   Images whose mtime matches the manifest are skipped.
 * - Overwrites originals in place. Git history preserves the pre-optimized
 *   versions if we ever need them. No .orig backups in the tree.
 *
 * Usage: bun run scripts/optimize-blog-images.ts
 */
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, extname, basename, dirname, relative } from "node:path";
import sharp from "sharp";

const BLOG_ROOT = new URL("../content/blog/", import.meta.url).pathname;
const MAX_WIDTH = 1840;
const PNG_OPTS = { compressionLevel: 9, palette: true } as const;
const JPEG_OPTS = { quality: 82, mozjpeg: true } as const;
const WEBP_OPTS = { quality: 82 } as const;

type Manifest = Record<string, { mtimeMs: number; bytes: number }>;

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function loadManifest(slug: string): Promise<Manifest> {
  const p = join(BLOG_ROOT, slug, ".optimized.json");
  try {
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return {};
  }
}

async function saveManifest(slug: string, m: Manifest) {
  const p = join(BLOG_ROOT, slug, ".optimized.json");
  await writeFile(p, JSON.stringify(m, null, 2));
}

async function processImage(
  path: string,
  slug: string,
  manifest: Manifest,
): Promise<{ before: number; after: number; skipped: boolean; webpBytes: number }> {
  const ext = extname(path).toLowerCase();
  const isGif = ext === ".gif";
  const isPng = ext === ".png";
  const isJpeg = ext === ".jpg" || ext === ".jpeg";
  if (!isGif && !isPng && !isJpeg) return { before: 0, after: 0, skipped: true, webpBytes: 0 };

  const key = relative(join(BLOG_ROOT, slug), path);
  const st = await stat(path);
  const entry = manifest[key];
  if (entry && entry.mtimeMs === st.mtimeMs) {
    return { before: st.size, after: st.size, skipped: true, webpBytes: 0 };
  }

  const before = st.size;
  if (isGif) {
    manifest[key] = { mtimeMs: st.mtimeMs, bytes: before };
    return { before, after: before, skipped: true, webpBytes: 0 };
  }

  const buf = await readFile(path);

  // Skip Ultra HDR JPEGs: a second JPEG stream (gain map) appended after the primary,
  // referenced by MPF metadata. Re-encoding with sharp drops the gain map and turns the
  // file into flat SDR.
  if (isJpeg) {
    const firstSoi = buf.indexOf(Buffer.from([0xff, 0xd8]));
    const secondSoi = firstSoi >= 0 ? buf.indexOf(Buffer.from([0xff, 0xd8]), firstSoi + 2) : -1;
    const hasMpf = buf.includes(Buffer.from("MPF\x00"));
    if (secondSoi > 0 && hasMpf) {
      manifest[key] = { mtimeMs: st.mtimeMs, bytes: before };
      return { before, after: before, skipped: true, webpBytes: 0 };
    }
  }

  const img = sharp(buf, { failOn: "none" });
  const meta = await img.metadata();
  const needsResize = (meta.width ?? 0) > MAX_WIDTH;

  let pipeline = sharp(buf, { failOn: "none" });
  if (needsResize) pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });

  let outBuf: Buffer;
  if (isPng) outBuf = await pipeline.png(PNG_OPTS).toBuffer();
  else outBuf = await pipeline.jpeg(JPEG_OPTS).toBuffer();

  // Only overwrite if we actually saved bytes (or resized).
  if (outBuf.length < before || needsResize) {
    await writeFile(path, outBuf);
  }

  // Also emit .webp sibling from the resized source.
  let webpSize = 0;
  const webpPath = path.replace(/\.(png|jpe?g)$/i, ".webp");
  try {
    const webpBuf = await sharp(outBuf).webp(WEBP_OPTS).toBuffer();
    await writeFile(webpPath, webpBuf);
    webpSize = webpBuf.length;
  } catch (e) {
    // ignore webp failures
  }

  const newSt = await stat(path);
  manifest[key] = { mtimeMs: newSt.mtimeMs, bytes: newSt.size };
  return { before, after: newSt.size, skipped: false, webpBytes: webpSize };
}

async function main() {
  const slugs = (await readdir(BLOG_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let totalBefore = 0;
  let totalAfter = 0;
  let totalWebp = 0;
  let touched = 0;
  let skipped = 0;

  for (const slug of slugs) {
    const assetsDir = join(BLOG_ROOT, slug, "assets");
    try {
      await stat(assetsDir);
    } catch {
      continue;
    }
    const manifest = await loadManifest(slug);
    const files = await walk(assetsDir);
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (![".png", ".jpg", ".jpeg", ".gif"].includes(ext)) continue;
      const r = await processImage(f, slug, manifest);
      totalBefore += r.before;
      totalAfter += r.after;
      totalWebp += r.webpBytes;
      if (r.skipped) skipped++;
      else {
        touched++;
        const savedPct = r.before > 0 ? ((1 - r.after / r.before) * 100).toFixed(1) : "0";
        console.log(
          `  ${slug}/${basename(f)}: ${(r.before / 1024).toFixed(0)}KB -> ${(r.after / 1024).toFixed(0)}KB (${savedPct}%) [webp ${(r.webpBytes / 1024).toFixed(0)}KB]`,
        );
      }
    }
    await saveManifest(slug, manifest);
  }

  console.log("\n=== Summary ===");
  console.log(`Touched: ${touched}  Skipped: ${skipped}`);
  console.log(`Before: ${(totalBefore / 1024 / 1024).toFixed(2)} MB`);
  console.log(`After:  ${(totalAfter / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Saved:  ${((totalBefore - totalAfter) / 1024 / 1024).toFixed(2)} MB (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%)`);
  console.log(`Webp siblings total: ${(totalWebp / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
