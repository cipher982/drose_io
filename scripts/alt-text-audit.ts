#!/usr/bin/env bun
/**
 * Produce a markdown audit of every <img> without alt text in the blog,
 * grouped by post. Includes the src and (if present) the surrounding
 * <figcaption> text as a candidate alt.
 *
 * Output: /tmp/blog-alt-audit.md
 */
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import * as cheerio from "cheerio";

const BLOG_ROOT = new URL("../content/blog/", import.meta.url).pathname;
const OUT = "/tmp/blog-alt-audit.md";

type Row = { src: string; caption: string | null };

async function auditPost(slug: string): Promise<Row[]> {
  const htmlPath = join(BLOG_ROOT, slug, "index.html");
  try {
    await stat(htmlPath);
  } catch {
    return [];
  }
  const html = await readFile(htmlPath, "utf8");
  const $ = cheerio.load(html, { decodeEntities: false }, false);
  const rows: Row[] = [];
  $("img").each((_, el) => {
    const $el = $(el);
    const alt = $el.attr("alt");
    if (alt && alt.trim().length > 0) return;
    const src = $el.attr("src") ?? "";
    const $fig = $el.closest("figure");
    let caption: string | null = null;
    if ($fig.length) {
      const c = $fig.find("figcaption").text().trim();
      if (c) caption = c;
    }
    rows.push({ src, caption });
  });
  return rows;
}

async function main() {
  const slugs = (await readdir(BLOG_ROOT, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const lines: string[] = [];
  lines.push("# Blog alt-text audit");
  lines.push("");
  lines.push(`Generated ${new Date().toISOString()}`);
  lines.push("");
  lines.push("Images below have no `alt` attribute (or an empty one).");
  lines.push("Fill these in manually — a short, specific description beats an auto-generated guess.");
  lines.push("");

  let totalMissing = 0;
  for (const slug of slugs) {
    const rows = await auditPost(slug);
    if (rows.length === 0) continue;
    totalMissing += rows.length;
    lines.push(`## ${slug}  (${rows.length} missing)`);
    lines.push("");
    for (const r of rows) {
      lines.push(`- \`${r.src}\``);
      if (r.caption) lines.push(`  - caption candidate: _${r.caption}_`);
    }
    lines.push("");
  }

  lines.unshift(`Total missing: ${totalMissing}`, "");

  await writeFile(OUT, lines.join("\n"));
  console.log(`Wrote ${OUT} (${totalMissing} images missing alt).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
