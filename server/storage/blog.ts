import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync } from 'fs';
import { join, basename } from 'path';
import matter from 'gray-matter';

const BLOG_DIR = Bun.env.BLOG_DIR || './content/blog';

if (!existsSync(BLOG_DIR)) {
  mkdirSync(BLOG_DIR, { recursive: true });
}

export type BlogStatus = 'draft' | 'published';

export interface BlogFrontMatter {
  title: string;
  slug: string;
  summary?: string;
  tags?: string[];
  publishedAt: string;
  updatedAt: string;
  status: BlogStatus;
  heroImage?: string;
}

export interface BlogPost {
  frontmatter: BlogFrontMatter;
  content: string;
}

export interface SavePostInput {
  slug: string;
  title: string;
  content: string;
  summary?: string;
  tags?: string[];
  status?: BlogStatus;
  heroImage?: string;
  publishedAt?: string;
}

export function resolvePostPath(slug: string): string {
  return join(BLOG_DIR, `${slug}.md`);
}

export function postExists(slug: string): boolean {
  return existsSync(resolvePostPath(slug));
}

export function loadPost(slug: string): BlogPost | null {
  const filePath = resolvePostPath(slug);
  if (!existsSync(filePath)) {
    return null;
  }

  const file = readFileSync(filePath, 'utf-8');
  const parsed = matter(file);

  const now = new Date().toISOString();
  const fm = parsed.data as Partial<BlogFrontMatter>;

  const frontmatter: BlogFrontMatter = {
    title: fm.title || slug,
    slug: fm.slug || slug,
    summary: fm.summary,
    tags: Array.isArray(fm.tags) ? fm.tags : (typeof fm.tags === 'string' && fm.tags ? fm.tags.split(',').map(tag => tag.trim()).filter(Boolean) : []),
    publishedAt: fm.publishedAt || now,
    updatedAt: fm.updatedAt || now,
    status: (fm.status as BlogStatus) || 'draft',
    heroImage: fm.heroImage,
  };

  return {
    frontmatter,
    content: parsed.content.trim(),
  };
}

export function savePost(input: SavePostInput): BlogPost {
  const filePath = resolvePostPath(input.slug);
  const existing = postExists(input.slug) ? loadPost(input.slug) : null;
  const nowIso = new Date().toISOString();

  const frontmatter: BlogFrontMatter = {
    title: input.title.trim(),
    slug: input.slug,
    summary: input.summary?.trim() || '',
    tags: input.tags?.map(tag => tag.trim()).filter(Boolean) || [],
    status: input.status || (existing?.frontmatter.status ?? 'draft'),
    heroImage: input.heroImage?.trim() || undefined,
    publishedAt: input.publishedAt || existing?.frontmatter.publishedAt || nowIso,
    updatedAt: nowIso,
  };

  if (frontmatter.heroImage === undefined) {
    delete (frontmatter as Record<string, unknown>).heroImage;
  }

  const fileContent = matter.stringify(`${input.content.trim()}\n`, frontmatter);

  // Write via temp file + atomic rename to avoid concurrent write corruption
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  writeFileSync(tempPath, `${fileContent.trim()}\n`, 'utf-8');
  renameSync(tempPath, filePath);

  return {
    frontmatter,
    content: input.content.trim(),
  };
}

export function deletePost(slug: string): boolean {
  const filePath = resolvePostPath(slug);
  if (!existsSync(filePath)) {
    return false;
  }

  unlinkSync(filePath);
  return true;
}

export function listPosts(): BlogPost[] {
  const files = readdirSync(BLOG_DIR)
    .filter(name => name.endsWith('.md'))
    .map(name => basename(name, '.md'));

  return files
    .map(slug => loadPost(slug))
    .filter((post): post is BlogPost => post !== null)
    .sort((a, b) => {
      return b.frontmatter.publishedAt.localeCompare(a.frontmatter.publishedAt);
    });
}

export function getRecentPosts(limit = 10, status: BlogStatus = 'published'): BlogPost[] {
  return listPosts()
    .filter(post => (status ? post.frontmatter.status === status : true))
    .slice(0, limit);
}

export function getPostStats() {
  const posts = listPosts();
  const totalWords = posts.reduce((sum, post) => sum + wordCount(post.content), 0);
  return {
    totalPosts: posts.length,
    totalWords,
  };
}

function wordCount(content: string): number {
  return content
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
