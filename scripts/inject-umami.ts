#!/usr/bin/env bun
/**
 * Build script to inject Umami analytics script into static HTML files
 * Replaces hardcoded script tags with env-var-based versions
 */

import { buildUmamiScript } from '../server/umami';

const HTML_FILES = [
  './public/index.html',
  './public/admin.html',
];

const UMAMI_PATTERN = /<script[^>]*analytics\.drose\.io\/script\.js[^>]*><\/script>/g;

async function injectUmamiScript() {
  const umamiScript = buildUmamiScript();

  console.log('Umami script to inject:', umamiScript);

  for (const filePath of HTML_FILES) {
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      console.warn(`⚠️  File not found: ${filePath}`);
      continue;
    }

    let content = await file.text();
    const matches = content.match(UMAMI_PATTERN);

    if (!matches) {
      console.log(`ℹ️  No Umami script found in ${filePath}`);
      continue;
    }

    // Replace all occurrences
    content = content.replace(UMAMI_PATTERN, umamiScript);

    await Bun.write(filePath, content);
    console.log(`✅ Updated ${filePath}`);
  }
}

injectUmamiScript().catch((error) => {
  console.error('❌ Error injecting Umami script:', error);
  process.exit(1);
});
