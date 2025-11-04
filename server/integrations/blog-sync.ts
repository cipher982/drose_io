import { Buffer } from 'buffer';
import matter from 'gray-matter';
import type { BlogPost } from '../storage/blog';

const repo = Bun.env.BLOG_GITHUB_REPO;
const token = Bun.env.BLOG_GITHUB_TOKEN;
const branch = Bun.env.BLOG_GITHUB_BRANCH || 'main';
const committerName = Bun.env.BLOG_GITHUB_COMMIT_NAME;
const committerEmail = Bun.env.BLOG_GITHUB_COMMIT_EMAIL;

function shouldSync(): boolean {
  return Boolean(repo && token);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function buildFileContent(post: BlogPost): string {
  return matter.stringify(`${post.content.trim()}\n`, post.frontmatter).trimEnd() + '\n';
}

async function fetchGitHub(url: string, init?: RequestInit) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'drose-io-blog-sync',
    ...(init?.headers || {}),
  } as Record<string, string>;

  const response = await fetch(url, {
    ...init,
    headers,
  });

  return response;
}

async function getCurrentFileSha(filePath: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${repo}/contents/${encodePath(filePath)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetchGitHub(url, { method: 'GET' });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub lookup failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { sha?: string };
  if (!data.sha) {
    throw new Error('GitHub response missing sha');
  }
  return data.sha;
}

export async function syncBlogPostToGit(post: BlogPost) {
  if (!shouldSync()) {
    return;
  }

  const filePath = `content/blog/${post.frontmatter.slug}.md`;
  const fileContent = buildFileContent(post);
  const sha = await getCurrentFileSha(filePath);

  const body: Record<string, unknown> = {
    message: sha ? `chore(blog): update ${post.frontmatter.slug}` : `chore(blog): add ${post.frontmatter.slug}`,
    content: Buffer.from(fileContent, 'utf-8').toString('base64'),
    branch,
  };

  if (sha) {
    body.sha = sha;
  }

  if (committerName && committerEmail) {
    body.committer = { name: committerName, email: committerEmail };
  }

  const url = `https://api.github.com/repos/${repo}/contents/${encodePath(filePath)}`;
  const res = await fetchGitHub(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to sync blog post to GitHub (${res.status}): ${text}`);
  }
}

export async function deleteBlogPostFromGit(slug: string) {
  if (!shouldSync()) {
    return;
  }

  const filePath = `content/blog/${slug}.md`;
  const sha = await getCurrentFileSha(filePath);

  if (!sha) {
    return;
  }

  const body: Record<string, unknown> = {
    message: `chore(blog): remove ${slug}`,
    sha,
    branch,
  };

  if (committerName && committerEmail) {
    body.committer = { name: committerName, email: committerEmail };
  }

  const url = `https://api.github.com/repos/${repo}/contents/${encodePath(filePath)}`;
  const res = await fetchGitHub(url, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete blog post from GitHub (${res.status}): ${text}`);
  }
}
