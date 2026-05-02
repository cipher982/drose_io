#!/usr/bin/env bun
/**
 * Replace img-tags for code-screenshots with real <pre><code> blocks,
 * syntax-highlighted with Shiki. One-shot fix-up for 3 images flagged
 * by the image classification report.
 */

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { createHighlighter } from 'shiki';

const BLOG_DIR = join(import.meta.dir, '..', 'content/blog');

type Target = {
  slug: string;
  imgBasename: string;  // e.g. "1*21ztOHDvV2TnVPI7YdbMPg.png"
  lang: string;
  code: string;
};

const TARGETS: Target[] = [
  {
    slug: 'migrating-to-tensorflow-2',
    imgBasename: '1*21ztOHDvV2TnVPI7YdbMPg.png',
    lang: 'python',
    code: `import tensorflow as tf
# disable eager execution to imitate TF1.x
tf.compat.v1.disable_eager_execution()

a = tf.constant(5)
b = tf.constant(2)

print(a*b)

# OUTPUT: Tensor("mul:0", shape=(), dtype=int32)`,
  },
  {
    slug: 'migrating-to-tensorflow-2',
    imgBasename: '1*8aqxz88ljWw5e7Zqtbfbfw.png',
    lang: 'python',
    code: `import tensorflow as tf
# disable eager execution to imitate TF1.x
tf.compat.v1.disable_eager_execution()

a = tf.constant(5)
b = tf.constant(2)
c = a * b

session = tf.compat.v1.Session()
with session as s:
    result = s.run(c)
    print(result)

# OUTPUT: 10`,
  },
  {
    slug: 'randomness-in-its-wonderful-forms',
    imgBasename: '1*5vBIDE41opJoG5b0j3Zu_A.gif',
    lang: 'python',
    code: `import tensorflow as tf
print(tf.__version__)

a = tf.constant(5)
b = tf.constant(2)

print(a*b)

# OUTPUT: 2.3.0
# OUTPUT: tf.Tensor(10, shape=(), dtype=int32)`,
  },
];

const shiki = await createHighlighter({
  themes: ['github-dark'],
  langs: ['python'],
});

for (const t of TARGETS) {
  const postDir = join(BLOG_DIR, t.slug);
  const htmlPath = join(postDir, 'index.html');
  const assetPath = join(postDir, 'assets', t.imgBasename);

  let html = readFileSync(htmlPath, 'utf-8');

  // Match the whole <figure>...</figure> (or plain <img>) that contains the image.
  // Medium-exported posts wrap images in <figure> with optional <figcaption>.
  // Escape the basename for regex (contains * which is a metachar).
  const escaped = t.imgBasename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const figureRe = new RegExp(`<figure>\\s*<img[^>]*src="/blog/${t.slug}/assets/${escaped}"[^>]*>(?:\\s*<figcaption>[^<]*</figcaption>)?\\s*</figure>`, 'g');
  const imgRe = new RegExp(`<img[^>]*src="/blog/${t.slug}/assets/${escaped}"[^>]*>`, 'g');

  const highlighted = shiki.codeToHtml(t.code, { lang: t.lang as any, theme: 'github-dark' });

  // Prefer figure replacement (drops the caption too — the code block is self-explanatory)
  let replaced = false;
  if (figureRe.test(html)) {
    html = html.replace(figureRe, highlighted);
    replaced = true;
  } else if (imgRe.test(html)) {
    html = html.replace(imgRe, highlighted);
    replaced = true;
  }

  if (!replaced) {
    console.warn(`✗ ${t.slug}: could not find image ${t.imgBasename} in ${htmlPath}`);
    continue;
  }

  writeFileSync(htmlPath, html);
  console.log(`✓ ${t.slug}/${t.imgBasename} → <pre><code>`);

  // Delete the now-orphaned image
  if (existsSync(assetPath)) {
    unlinkSync(assetPath);
    console.log(`  deleted ${assetPath}`);
  }
}

console.log('\nDone.');
