/**
 * Deployment fingerprint.
 *
 * A stable hash over every file that makes up the served site. The server
 * computes it at boot and exposes it at /api/version; scripts/smoke.ts computes
 * it from the local checkout and compares. If they differ, production is not
 * running the code you are looking at.
 *
 * This is the check that a behavioural smoke test cannot make: every route can
 * return 200 while serving a build from three weeks ago.
 *
 * Both sides must hash the identical file set, so the directory list here has
 * to stay in sync with what the Dockerfile copies into the image.
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, relative } from 'path';

/** Directories that constitute the served site, relative to the repo root. */
const TRACKED_DIRS = ['server', 'templates', 'public', 'content'];

/**
 * Files that legitimately differ between checkout and image, or that have no
 * effect on what is served.
 */
function isIgnored(name: string): boolean {
  return name === '.DS_Store' || name === '.optimized.json' || name === '.gitkeep';
}

function walk(root: string, dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (isIgnored(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(root, full, out);
    else if (st.isFile()) out.push(relative(root, full));
  }
}

/**
 * Hash of (path, content) for every file under TRACKED_DIRS, sorted by path so
 * the result does not depend on filesystem ordering.
 */
export function computeFingerprint(root: string): string {
  const files: string[] = [];
  for (const d of TRACKED_DIRS) {
    const abs = join(root, d);
    if (existsSync(abs)) walk(root, abs, files);
  }
  files.sort();

  const outer = createHash('sha256');
  for (const rel of files) {
    const inner = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
    outer.update(rel);
    outer.update('\0');
    outer.update(inner);
    outer.update('\n');
  }
  return outer.digest('hex').slice(0, 16);
}

/** File count, useful for narrowing down a fingerprint mismatch. */
export function fingerprintFileCount(root: string): number {
  const files: string[] = [];
  for (const d of TRACKED_DIRS) {
    const abs = join(root, d);
    if (existsSync(abs)) walk(root, abs, files);
  }
  return files.length;
}
