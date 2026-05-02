#!/usr/bin/env bun
/**
 * Lightweight page-weight audit: for every post, sum the byte weight of
 * the index.html plus all local <img>/<video>/<source> assets it references.
 * No browser required; fast and deterministic.
 *
 * This is the pragmatic stand-in for Lighthouse — covers the main lever
 * (asset bytes) that dominates LCP / page weight on this blog.
 *
 * Usage: bun run scripts/blog-weight-audit.ts
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";

const BLOG_ROOT = new URL("../content/blog/", import.meta.url).pathname;

async function safeStat(p: string): Promise<number> {
  try {
    return (await stat(p)).size;
  } catch {
    return 0;
  }
}

async function auditPost(slug: string) {
  const htmlPath = join(BLOG_ROOT, slug, "index.html");
  const htmlSize = await safeStat(htmlPath);
  if (!htmlSize) return null;
  const html = await readFile(htmlPath, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false }, false);

  const srcs = new Set<string>();
  $("img, source, video").each((_, el) => {
    const s = $(el).attr("src");
    if (s) srcs.add(s);
    const ss = $(el).attr("srcset");
    if (ss) ss.split(",").forEach((p) => srcs.add(p.trim().split(" ")[0]));
  });

  let imgBytes = 0;
  let external = 0;
  let missing = 0;
  let imgCount = 0;
  const heaviest: { src: string; bytes: number }[] = [];
  for (const src of srcs) {
    if (src.startsWith("http://") || src.startsWith("https://")) {
      external++;
      continue;
    }
    const prefix = `/blog/${slug}/`;
    let filePath: string | null = null;
    if (src.startsWith(prefix)) filePath = join(BLOG_ROOT, slug, src.slice(prefix.length));
    else if (src.startsWith("assets/")) filePath = join(BLOG_ROOT, slug, src);
    if (!filePath) continue;
    const sz = await safeStat(filePath);
    if (sz === 0) {
      missing++;
      continue;
    }
    imgCount++;
    imgBytes += sz;
    heaviest.push({ src, bytes: sz });
  }
  heaviest.sort((a, b) => b.bytes - a.bytes);

  return {
    slug,
    htmlSize,
    imgCount,
    imgBytes,
    external,
    missing,
    total: htmlSize + imgBytes,
    topThree: heaviest.slice(0, 3),
  };
}

function fmt(b: number): string {
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(2)} MB`;
  if (b > 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${b} B`;
}

async function main() {
  const slugs = (await readdir(BLOG_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const rows = [];
  for (const s of slugs) {
    const r = await auditPost(s);
    if (r) rows.push(r);
  }
  rows.sort((a, b) => b.total - a.total);

  console.log("slug                                            html     imgs   asset-bytes   total");
  console.log("--------------------------------------------------------------------------------------");
  for (const r of rows) {
    console.log(
      `${r.slug.padEnd(48)} ${fmt(r.htmlSize).padStart(7)}  ${String(r.imgCount).padStart(4)}   ${fmt(r.imgBytes).padStart(9)}   ${fmt(r.total).padStart(9)}`,
    );
  }
  console.log();
  console.log("Top offenders (heaviest asset per post):");
  for (const r of rows.slice(0, 5)) {
    const top = r.topThree[0];
    if (top) console.log(`  ${r.slug}: ${fmt(top.bytes)} — ${top.src}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
