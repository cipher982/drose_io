/**
 * Content-hash asset versioning, computed once at boot.
 *
 * Replaces scripts/bust-cache.ts, which rewrote ?v= params directly into
 * tracked HTML and TypeScript source. Cloudflare caches these aggressively, so
 * the hash must change whenever the file does — but nothing needs to be written
 * to disk to make that happen.
 */

import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PUBLIC_DIR = join(import.meta.dir, '../../public');

const cache = new Map<string, string>();

/** sha1 of the file's bytes, first 8 chars. Empty string if absent. */
function hashOf(urlPath: string): string {
  const cached = cache.get(urlPath);
  if (cached !== undefined) return cached;

  const diskPath = join(PUBLIC_DIR, urlPath.replace(/^\//, ''));
  let hash = '';
  if (existsSync(diskPath)) {
    hash = createHash('sha1').update(readFileSync(diskPath)).digest('hex').slice(0, 8);
  } else {
    console.warn(`[assets] missing on disk, serving unversioned: ${urlPath}`);
  }
  cache.set(urlPath, hash);
  return hash;
}

/**
 * `/assets/css/styles.css` -> `/assets/css/styles.css?v=f4a8f8ad`
 * Leaves the path untouched if the file is missing, so a typo degrades to an
 * ordinary 404 rather than a confusing versioned one.
 */
export function assetUrl(urlPath: string): string {
  const hash = hashOf(urlPath);
  return hash ? `${urlPath}?v=${hash}` : urlPath;
}

/** Rewrites every known asset reference in an HTML document. */
export function versionAssetsIn(html: string): string {
  return html.replace(
    /(["'(])(\/?assets\/[a-zA-Z0-9_\-./]+\.(?:css|js))(\?v=[^"'\s)]*)?/g,
    (_m, lead: string, path: string) => {
      const absolute = path.startsWith('/') ? path : `/${path}`;
      const hash = hashOf(absolute);
      return hash ? `${lead}${path}?v=${hash}` : `${lead}${path}`;
    },
  );
}
