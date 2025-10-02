import { test, expect } from './fixtures.js';
import { waitForSSE } from './helpers.js';

test('connection indicator flips to red when offline and recovers when back online', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');
  await waitForSSE(page);

  await page.context().setOffline(true);
  await expect(page.locator('#connection-status')).toHaveText('🔴', { timeout: 6_000 });

  await page.context().setOffline(false);
  await expect(page.locator('#connection-status')).toHaveText('🟢', { timeout: 10_000 });
});

test('widget retries SSE connection after transient failure', async ({ page }) => {
  const streamPattern = '**/api/threads/**/stream';

  await page.route(streamPattern, (route) => route.abort());

  await page.goto('/');
  await page.click('#feedback-button');

  await expect(page.locator('#connection-status')).toHaveText('🔴', { timeout: 5_000 });

  await page.unroute(streamPattern);

  await expect(page.locator('#connection-status')).toHaveText('🟢', { timeout: 10_000 });
});
