#!/usr/bin/env bun
/**
 * Walk every content/blog/<slug>/index.html and add loading="lazy",
 * decoding="async", width, and height attributes to <img> tags.
 *
 * - Resolves src to a local asset path under content/blog/<slug>/ and
 *   reads dimensions with sharp.
 * - Skips images that already have all four attrs.
 * - Skips external images (http/https).
 * - Idempotent.
 *
 * Usage: bun run scripts/img-attributes-pass.ts
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import * as cheerio from "cheerio";

const BLOG_ROOT = new URL("../content/blog/", import.meta.url).pathname;

function resolveSrcToFile(slug: string, src: string): string | null {
  if (src.startsWith("http://") || src.startsWith("https://")) return null;
  // Expected form: /blog/<slug>/assets/...
  const prefix = `/blog/${slug}/`;
  if (src.startsWith(prefix)) {
    return join(BLOG_ROOT, slug, src.slice(prefix.length));
  }
  if (src.startsWith("assets/")) {
    return join(BLOG_ROOT, slug, src);
  }
  return null;
}

async function processPost(slug: string): Promise<{ changed: number; total: number }> {
  const htmlPath = join(BLOG_ROOT, slug, "index.html");
  try {
    await stat(htmlPath);
  } catch {
    return { changed: 0, total: 0 };
  }
  const html = await readFile(htmlPath, "utf8");
  // Load as fragment — posts are HTML fragments, no <html>/<body> wrapper.
  const $ = cheerio.load(html, { xmlMode: false, decodeEntities: false }, false);
  const imgs = $("img");
  let changed = 0;
  for (const el of imgs.toArray()) {
    const $el = $(el);
    const src = $el.attr("src");
    if (!src) continue;

    let mutated = false;
    if (!$el.attr("loading")) {
      $el.attr("loading", "lazy");
      mutated = true;
    }
    if (!$el.attr("decoding")) {
      $el.attr("decoding", "async");
      mutated = true;
    }

    if (!$el.attr("width") || !$el.attr("height")) {
      const file = resolveSrcToFile(slug, src);
      if (file) {
        try {
          const meta = await sharp(file).metadata();
          if (meta.width && meta.height) {
            $el.attr("width", String(meta.width));
            $el.attr("height", String(meta.height));
            mutated = true;
          }
        } catch (e) {
          // file missing or unreadable; skip silently
        }
      }
    }
    if (mutated) changed++;
  }

  if (changed > 0) {
    // cheerio's .html() re-serializes; we need to write it back but preserve doctype etc.
    // Our posts are HTML fragments (based on grep); write the full serialization.
    const out = $.html();
    await writeFile(htmlPath, out);
  }
  return { changed, total: imgs.length };
}

async function main() {
  const slugs = (await readdir(BLOG_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  let totalChanged = 0;
  let totalImgs = 0;
  for (const slug of slugs) {
    const r = await processPost(slug);
    totalChanged += r.changed;
    totalImgs += r.total;
    if (r.total > 0) {
      console.log(`  ${slug}: ${r.changed}/${r.total} images updated`);
    }
  }
  console.log(`\nTotal: ${totalChanged}/${totalImgs} <img> tags updated.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
