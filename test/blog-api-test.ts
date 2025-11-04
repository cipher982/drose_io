#!/usr/bin/env bun

const API_BASE = process.env.API_BASE || 'http://localhost:3000';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

type TestResult = { name: string; success: boolean; error?: string };

async function request<T = any>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  opts: { auth?: boolean; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  if (opts.auth !== false) {
    headers.Authorization = `Bearer ${ADMIN_PASSWORD}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch (error) {
    throw new Error(`Failed to parse JSON from ${path}: ${text}`);
  }

  return { status: res.status, data };
}

async function run() {
  const slug = `test-blog-${Date.now()}`;
  const results: TestResult[] = [];

  const tests: Array<{ name: string; run: () => Promise<TestResult> }> = [
    {
      name: 'Create post',
      run: async () => {
        const { status, data } = await request('POST', '/api/admin/blog/posts', {
          title: 'Test Blog Post',
          slug,
          summary: 'Integration test summary',
          content: '# Hello World\n\nThis is just a test post.',
          status: 'published',
          tags: ['test', 'blog'],
        });
        return {
          success: status === 200 && data?.post?.slug === slug,
          error: status === 200 ? undefined : `Unexpected status: ${status} (${data?.error || 'no body'})`,
        };
      },
    },
    {
      name: 'List posts (admin)',
      run: async () => {
        const { status, data } = await request('GET', '/api/admin/blog/posts');
        const found = Array.isArray(data?.posts) && data.posts.some((post: any) => post.slug === slug);
        return {
          success: status === 200 && found,
          error: status === 200 ? 'Post missing from list response' : `Unexpected status: ${status}`,
        };
      },
    },
    {
      name: 'Fetch single post',
      run: async () => {
        const { status, data } = await request('GET', `/api/admin/blog/posts/${slug}`);
        return {
          success: status === 200 && data?.post?.slug === slug && data.post.content.includes('Hello World'),
          error: status === 200 ? 'Response missing content' : `Unexpected status: ${status}`,
        };
      },
    },
    {
      name: 'Update post metadata',
      run: async () => {
        const { status, data } = await request('PATCH', `/api/admin/blog/posts/${slug}`, {
          summary: 'Updated integration test summary',
        });
        return {
          success: status === 200 && data?.post?.summary === 'Updated integration test summary',
          error: status === 200 ? 'Summary did not update' : `Unexpected status: ${status}`,
        };
      },
    },
    {
      name: 'Public blog route renders',
      run: async () => {
        const res = await fetch(`${API_BASE}/blog/${slug}`);
        return {
          success: res.status === 200,
          error: res.status === 200 ? undefined : `Unexpected status: ${res.status}`,
        };
      },
    },
    {
      name: 'Public blog API lists post',
      run: async () => {
        const { status, data } = await request('GET', '/api/blog/posts', undefined, { auth: false });
        const found = Array.isArray(data?.posts) && data.posts.some((post: any) => post.slug === slug);
        return {
          success: status === 200 && found,
          error: status === 200 ? 'Post missing from public list response' : `Unexpected status: ${status}`,
        };
      },
    },
    {
      name: 'Delete post',
      run: async () => {
        const { status } = await request('DELETE', `/api/admin/blog/posts/${slug}`);
        if (status !== 200) {
          return { name: 'Delete post', success: false, error: `Unexpected status: ${status}` };
        }
        const res = await fetch(`${API_BASE}/blog/${slug}`);
        return {
          success: res.status === 404,
          error: res.status === 404 ? undefined : `Expected 404 after deletion, got ${res.status}`,
        };
      },
    },
  ];

  for (const test of tests) {
    try {
      const result = await test.run();
      result.name = test.name;
      results.push(result);
    } catch (error) {
      results.push({
        name: test.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passed = results.filter(r => r.success).length;
  const failed = results.length - passed;

  results.forEach(result => {
    if (result.success) {
      console.log(`✓ ${result.name}`);
    } else {
      console.log(`✗ ${result.name}${result.error ? ` — ${result.error}` : ''}`);
    }
  });

  console.log(`\n${passed}/${results.length} blog tests passed`);
  process.exit(failed === 0 ? 0 : 1);
}

run();
