#!/usr/bin/env bun
/**
 * Rewrites ?v=... cache-busting params on local assets to a content hash
 * of the asset file. Runs at build time so each deploy ships URLs that
 * change only when the underlying file changes.
 *
 * Targets:
 *  - public/index.html (in place)
 *  - public/admin.html (in place)
 *  - server/blog/layout.ts (SSR CSS links)
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const PUBLIC_DIR = join(ROOT, 'public');

const HTML_TARGETS = [
  join(PUBLIC_DIR, 'index.html'),
  join(PUBLIC_DIR, 'admin.html'),
];

const TS_TARGETS = [
  join(ROOT, 'server/blog/layout.ts'),
];

// Assets we want busted. Key: URL path as it appears in markup.
// Value: absolute path on disk.
const ASSET_MAP: Record<string, string> = {
  '/assets/css/tokens.css': join(PUBLIC_DIR, 'assets/css/tokens.css'),
  '/assets/css/win98-theme.css': join(PUBLIC_DIR, 'assets/css/win98-theme.css'),
  '/assets/css/styles.css': join(PUBLIC_DIR, 'assets/css/styles.css'),
  '/assets/css/creature.css': join(PUBLIC_DIR, 'assets/css/creature.css'),
  '/assets/css/admin.css': join(PUBLIC_DIR, 'assets/css/admin.css'),
  '/assets/js/scripts.js': join(PUBLIC_DIR, 'assets/js/scripts.js'),
  '/assets/js/feedback-widget-v3.js': join(PUBLIC_DIR, 'assets/js/feedback-widget-v3.js'),
  '/assets/js/creature.js': join(PUBLIC_DIR, 'assets/js/creature.js'),
};

function hashFile(path: string): string | null {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

function bustInText(text: string, urlPath: string, hash: string): { text: string; hits: number } {
  // Matches both absolute (/assets/...) and relative (assets/...) forms.
  const relPath = urlPath.replace(/^\//, '');
  const escaped = (relPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(/?${escaped})(\\?v=[^"'\\s)]*)?`, 'g');
  let hits = 0;
  const next = text.replace(pattern, (_match, p1) => {
    hits += 1;
    return `${p1}?v=${hash}`;
  });
  return { text: next, hits };
}

function run() {
  const hashes: Record<string, string> = {};
  for (const [urlPath, diskPath] of Object.entries(ASSET_MAP)) {
    const h = hashFile(diskPath);
    if (!h) {
      console.warn(`⚠️  missing asset on disk, skipping: ${diskPath}`);
      continue;
    }
    hashes[urlPath] = h;
  }

  const targets = [...HTML_TARGETS, ...TS_TARGETS];
  for (const file of targets) {
    if (!existsSync(file)) {
      console.warn(`⚠️  target not found: ${file}`);
      continue;
    }
    let text = readFileSync(file, 'utf-8');
    let totalHits = 0;
    for (const [urlPath, hash] of Object.entries(hashes)) {
      const { text: next, hits } = bustInText(text, urlPath, hash);
      text = next;
      totalHits += hits;
    }
    Bun.write(file, text);
    console.log(`✅ ${file.replace(ROOT + '/', '')} — ${totalHits} refs updated`);
  }
}

run();
