import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import type { Context } from 'hono';
import { extractAuthPassword, isValidAdminPassword } from '../auth/admin-auth';
import {
  deletePost,
  getPostStats,
  listPosts,
  loadPost,
  postExists,
  resolvePostPath,
  savePost,
  type BlogPost,
  type BlogStatus,
} from '../storage/blog';
import { deleteBlogPostFromGit, syncBlogPostToGit } from '../integrations/blog-sync';

interface PostPayload {
  title?: string;
  slug?: string;
  summary?: string;
  tags?: string[] | string;
  content?: string;
  status?: BlogStatus;
  heroImage?: string;
  publishedAt?: string;
}

function ensureAdmin(c: Context): string | null {
  const password = extractAuthPassword(c);
  if (!isValidAdminPassword(password)) {
    c.status(401);
    c.json({ error: 'Unauthorized' });
    return null;
  }
  return password;
}

function sanitizeSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');
  return slug;
}

function validateSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

function parseTags(input?: string[] | string): string[] | undefined {
  if (!input) return undefined;
  if (Array.isArray(input)) {
    return input.map(tag => tag.trim()).filter(Boolean);
  }
  return input
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function parsePublishedAt(input?: string): string | undefined {
  if (!input) return undefined;
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

function ensureRequiredFields(body: PostPayload, required: (keyof PostPayload)[]) {
  const missing = required.filter(field => {
    const value = body[field];
    return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
  });
  if (missing.length > 0) {
    const fields = missing.join(', ');
    throw new Error(`Missing required fields: ${fields}`);
  }
}

function formatListResponse(post: BlogPost) {
  const { frontmatter, content } = post;
  return {
    title: frontmatter.title,
    slug: frontmatter.slug,
    summary: frontmatter.summary || '',
    publishedAt: frontmatter.publishedAt,
    updatedAt: frontmatter.updatedAt,
    tags: frontmatter.tags || [],
    status: frontmatter.status,
    heroImage: frontmatter.heroImage,
    wordCount: content.split(/\s+/).filter(Boolean).length,
  };
}

export async function createBlogPost(c: Context) {
  if (!ensureAdmin(c)) {
    return;
  }

  try {
    const body = await c.req.json<PostPayload>();
    ensureRequiredFields(body, ['title', 'content']);

    const slugSource = body.slug || body.title!;
    const slug = sanitizeSlug(slugSource);

    if (!validateSlug(slug)) {
      return c.json({ error: 'Invalid slug. Use letters, numbers, and single hyphens.' }, 400);
    }

    if (postExists(slug)) {
      return c.json({ error: 'Slug already exists' }, 409);
    }

    const post = savePost({
      slug,
      title: body.title!.trim(),
      summary: body.summary?.trim(),
      content: body.content ?? '',
      tags: parseTags(body.tags),
      status: body.status || 'draft',
      heroImage: body.heroImage?.trim(),
      publishedAt: parsePublishedAt(body.publishedAt),
    });

    try {
      await syncBlogPostToGit(post);
    } catch (syncError) {
      // Roll back local file on failure
      try {
        deletePost(slug);
      } catch {
        // ignored: best effort cleanup
      }
      throw syncError;
    }

    return c.json({
      success: true,
      post: formatListResponse(post),
    });
  } catch (error) {
    console.error('Error creating blog post', error);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }
    if (error instanceof Error && error.message.startsWith('Missing required fields')) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
}

export async function updateBlogPost(c: Context) {
  if (!ensureAdmin(c)) {
    return;
  }

  const currentSlug = c.req.param('slug');
  const existing = loadPost(currentSlug);

  if (!existing) {
    return c.json({ error: 'Post not found' }, 404);
  }

  try {
    const body = await c.req.json<PostPayload>();

    const requestedSlug = body.slug ? sanitizeSlug(body.slug) : currentSlug;

    if (!validateSlug(requestedSlug)) {
      return c.json({ error: 'Invalid slug. Use letters, numbers, and single hyphens.' }, 400);
    }

    if (requestedSlug !== currentSlug && postExists(requestedSlug)) {
      return c.json({ error: 'Slug already exists' }, 409);
    }

    const targetPath = resolvePostPath(requestedSlug);
    const previousContent = existsSync(targetPath) ? readFileSync(targetPath, 'utf-8') : null;

    const post = savePost({
      slug: requestedSlug,
      title: (body.title ?? existing.frontmatter.title).trim(),
      summary: body.summary !== undefined ? body.summary : existing.frontmatter.summary,
      content: body.content !== undefined ? body.content : existing.content,
      tags: body.tags !== undefined ? parseTags(body.tags) : existing.frontmatter.tags,
      status: body.status ?? existing.frontmatter.status,
      heroImage: body.heroImage !== undefined ? body.heroImage : existing.frontmatter.heroImage,
      publishedAt: parsePublishedAt(body.publishedAt) ?? existing.frontmatter.publishedAt,
    });

    try {
      await syncBlogPostToGit(post);
    } catch (syncError) {
      if (previousContent !== null) {
        writeFileSync(targetPath, previousContent, 'utf-8');
      } else {
        try {
          unlinkSync(targetPath);
        } catch {
          // ignore cleanup errors
        }
      }
      throw syncError;
    }

    if (requestedSlug !== currentSlug) {
      try {
        await deleteBlogPostFromGit(currentSlug);
      } catch (syncError) {
        // Attempt to roll back the new file
        try {
          unlinkSync(targetPath);
        } catch {
          // ignore cleanup errors
        }
        throw syncError;
      }
      deletePost(currentSlug);
    }

    return c.json({
      success: true,
      post: formatListResponse(post),
    });
  } catch (error) {
    console.error('Error updating blog post', error);
    if (error instanceof SyntaxError) {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }
    if (error instanceof Error && error.message.startsWith('Missing required fields')) {
      return c.json({ error: error.message }, 400);
    }
    return c.json({ error: 'Internal server error' }, 500);
  }
}

export function listAdminBlogPosts(c: Context) {
  if (!ensureAdmin(c)) {
    return;
  }

  const posts = listPosts().map(formatListResponse);
  return c.json({
    posts,
    stats: getPostStats(),
  });
}

export function getAdminBlogPost(c: Context) {
  if (!ensureAdmin(c)) {
    return;
  }

  const slug = c.req.param('slug');
  const post = loadPost(slug);

  if (!post) {
    return c.json({ error: 'Post not found' }, 404);
  }

  return c.json({
    post: {
      ...formatListResponse(post),
      content: post.content,
    },
  });
}

export async function deleteBlogPostHandler(c: Context) {
  if (!ensureAdmin(c)) {
    return;
  }

  const slug = c.req.param('slug');
  const filePath = resolvePostPath(slug);

  if (!existsSync(filePath)) {
    return c.json({ error: 'Post not found' }, 404);
  }

  const previousContent = readFileSync(filePath, 'utf-8');

  try {
    await deleteBlogPostFromGit(slug);
  } catch (error) {
    console.error('Error syncing blog delete', error);
    return c.json({ error: 'Failed to sync blog delete' }, 500);
  }

  const deleted = deletePost(slug);
  if (!deleted) {
    try {
      writeFileSync(filePath, previousContent, 'utf-8');
    } catch {
      // ignore restore failure
    }
    return c.json({ error: 'Failed to remove blog post locally' }, 500);
  }

  return c.json({ success: true });
}
