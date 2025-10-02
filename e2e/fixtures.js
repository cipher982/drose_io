import { test as base } from '@playwright/test';
import { cleanupTestData, prepareContext, seedTestVisitor } from './helpers.js';

export const test = base.extend({
  testId: async ({}, use, testInfo) => {
    const sanitizedTitle = testInfo.title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
    const uniqueSuffix = `${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await use(`${sanitizedTitle || 'test'}-${uniqueSuffix}`);
  },
  context: async ({ context, testId }, use) => {
    await prepareContext(context, testId);
    await use(context);
  },
  page: async ({ page, testId }, use) => {
    await seedTestVisitor(page, testId);
    await use(page);
  },
});

export const expect = test.expect;

test.afterEach(async () => {
  await cleanupTestData();
});
