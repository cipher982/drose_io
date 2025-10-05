import { expect } from '@playwright/test';
import { promises as fs } from 'fs';
import { join } from 'path';

export const TEST_VISITOR_PREFIX = 'test-';
export const THREADS_DIR = process.env.THREADS_DIR ?? './data/threads/test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'temp_dev_password_123';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 10;

export async function seedTestVisitor(page, testId) {
  const visitorId = `${TEST_VISITOR_PREFIX}${testId}`;
  await page.addInitScript((id, maxAge) => {
    window.localStorage.setItem('__vid', id);
    document.cookie = `__vid=${id};max-age=${maxAge};path=/;SameSite=Lax`;
  }, visitorId, COOKIE_MAX_AGE_SECONDS);
}

export async function prepareContext(context, testId) {
  const visitorId = `${TEST_VISITOR_PREFIX}${testId}`;
  await context.addInitScript((id, maxAge) => {
    window.localStorage.setItem('__vid', id);
    document.cookie = `__vid=${id};max-age=${maxAge};path=/;SameSite=Lax`;
  }, visitorId, COOKIE_MAX_AGE_SECONDS);
}

export async function getVisitorId(page) {
  return page.evaluate(() => window.localStorage.getItem('__vid') || '');
}

export async function sendAdminReply(request, visitorId, text) {
  const response = await request.post(`/api/admin/threads/${visitorId}/reply`, {
    data: { text },
    headers: {
      Authorization: `Bearer ${ADMIN_PASSWORD}`,
      'Content-Type': 'application/json',
    },
  });

  expect(response.ok(), 'admin reply should succeed').toBeTruthy();
  return response.json();
}

export async function postVisitorMessage(request, visitorId, text, pagePath = '/') {
  const response = await request.post('/api/feedback', {
    data: {
      visitorId,
      type: 'message',
      text,
      page: pagePath,
    },
    headers: { 'Content-Type': 'application/json' },
  });

  expect(response.ok(), 'visitor message should succeed').toBeTruthy();
  return response.json();
}

export async function waitForSSE(page, timeout = 4_000) {
  await page.waitForFunction(() => {
    return document.getElementById('connection-status')?.textContent === '🟢';
  }, { timeout });
}

export async function cleanupTestData() {
  await new Promise((resolve) => setTimeout(resolve, 50));

  try {
    await fs.mkdir(THREADS_DIR, { recursive: true });
    const entries = await fs.readdir(THREADS_DIR);
    const targets = entries.filter((entry) => entry.startsWith(TEST_VISITOR_PREFIX));

    await Promise.all(targets.map(async (entry) => {
      await fs.rm(join(THREADS_DIR, entry), { force: true });
    }));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
}
