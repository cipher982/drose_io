import { test, expect } from './fixtures.js';
import { getVisitorId } from './helpers.js';

test('conversation history persists across full page reloads', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');

  const message = 'This should still be here after reload';
  await page.fill('#feedback-text', message);
  await page.click('#send-btn');

  await page.reload();
  await page.click('#feedback-button');

  await expect(page.locator('.conversation .message.visitor .text').last()).toContainText(message);
});

test('cookie fallback restores visitor ID when localStorage is cleared', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');

  const message = 'Cookie fallback message';
  await page.fill('#feedback-text', message);
  await page.click('#send-btn');

  const before = await getVisitorId(page);

  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  const after = await getVisitorId(page);
  expect(after).toBe(before);

  await page.click('#feedback-button');
  await expect(page.locator('.conversation .message.visitor .text').last()).toContainText(message);
});

test('existing conversations load immediately on widget open', async ({ page }) => {
  await page.goto('/');
  const visitorId = await getVisitorId(page);

  await page.context().request.post('/api/feedback', {
    data: {
      visitorId,
      type: 'message',
      text: 'Pre-seeded message',
      page: '/',
    },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.reload();
  await page.click('#feedback-button');

  await expect(page.locator('.conversation .message.visitor .text').first()).toContainText('Pre-seeded message');
});
