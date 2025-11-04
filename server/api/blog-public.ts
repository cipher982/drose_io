import type { Context } from 'hono';
import { getRecentPosts } from '../storage/blog';

function formatPostForApi(post: ReturnType<typeof getRecentPosts>[number]) {
  const { frontmatter } = post;
  return {
    title: frontmatter.title,
    slug: frontmatter.slug,
    summary: frontmatter.summary || '',
    publishedAt: frontmatter.publishedAt,
    updatedAt: frontmatter.updatedAt,
    tags: frontmatter.tags || [],
    heroImage: frontmatter.heroImage,
    status: frontmatter.status,
  };
}

export function listPublicBlogPosts(c: Context) {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.max(1, Math.min(100, Number.parseInt(limitParam, 10) || 0)) : 20;
  const posts = getRecentPosts(limit, 'published').map(formatPostForApi);
  return c.json({ posts });
}
