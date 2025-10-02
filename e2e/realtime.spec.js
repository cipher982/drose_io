import { test, expect } from './fixtures.js';
import { getVisitorId, prepareContext, sendAdminReply, waitForSSE } from './helpers.js';

test('visitor receives admin reply via SSE', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');
  await waitForSSE(page);

  await page.fill('#feedback-text', 'Realtime test message');
  await page.click('#send-btn');

  const visitorId = await getVisitorId(page);
  await sendAdminReply(page.context().request, visitorId, 'Instant reply via SSE!');

  await expect(page.locator('.conversation .message.david .text').last()).toContainText('Instant reply via SSE!', {
    timeout: 4_000,
  });
});

test('notification box appears when panel is closed and admin replies', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');
  await waitForSSE(page);

  await page.fill('#feedback-text', 'Message before closing panel');
  await page.click('#send-btn');

  const visitorId = await getVisitorId(page);

  await page.click('#feedback-panel .close-btn');
  await expect(page.locator('#feedback-panel')).toBeHidden();

  await sendAdminReply(page.context().request, visitorId, 'Reply while panel closed');

  const notification = page.locator('#feedback-notification');
  await expect(notification).toBeVisible({ timeout: 4_000 });
  await expect(notification).toContainText('David replied!');
});

test('multiple tabs remain in sync via SSE broadcasts', async ({ browser, testId }) => {
  const context = await browser.newContext();
  await prepareContext(context, testId);

  const tab1 = await context.newPage();
  const tab2 = await context.newPage();

  try {
    await tab1.goto('/');
    await tab1.click('#feedback-button');
    await waitForSSE(tab1);

    await tab1.fill('#feedback-text', 'Message from tab one');
    await tab1.click('#send-btn');

    const visitorId = await getVisitorId(tab1);

    await tab2.goto('/');
    await tab2.click('#feedback-button');
    await waitForSSE(tab2);

    await expect(tab2.locator('.conversation .message.visitor .text').last()).toContainText('Message from tab one');

    await sendAdminReply(tab1.context().request, visitorId, 'Reply visible everywhere');

    await expect(tab1.locator('.conversation .message.david .text').last()).toContainText('Reply visible everywhere', { timeout: 4_000 });
    await expect(tab2.locator('.conversation .message.david .text').last()).toContainText('Reply visible everywhere', { timeout: 4_000 });
  } finally {
    await context.close();
  }
});
