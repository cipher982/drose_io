import { test, expect } from './fixtures.js';
import { getVisitorId } from './helpers.js';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'temp_dev_password_123';

test('admin can login, view threads, and send a reply', async ({ page }) => {
  await page.goto('/');
  const visitorId = await getVisitorId(page);

  await page.context().request.post('/api/feedback', {
    data: {
      visitorId,
      type: 'message',
      text: 'Admin UI test message',
      page: '/admin-test',
    },
    headers: { 'Content-Type': 'application/json' },
  });

  await page.goto('/admin.html');
  await page.fill('#password-input', ADMIN_PASSWORD);
  await page.click('button:has-text("Login")');

  const threadItem = page.locator('.thread-item', { hasText: visitorId.substring(0, 16) });
  await expect(threadItem).toBeVisible({ timeout: 5_000 });

  await threadItem.click();

  await expect(page.locator('.message.visitor .text').last()).toContainText('Admin UI test message');

  const replyText = 'Admin reply from Playwright';
  await page.fill('#reply-text', replyText);
  await page.click('button:has-text("Send Reply")');

  await expect(page.locator('#reply-success')).toBeVisible();
  await expect(page.locator('.message.david .text').last()).toContainText(replyText);

  const response = await page.context().request.get(`/api/threads/${visitorId}/messages`);
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const texts = (data.messages || []).map(m => m.text);
  expect(texts).toContain(replyText);
});
