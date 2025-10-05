import { test, expect } from './fixtures.js';
import { getVisitorId } from './helpers.js';

test('widget loads and ping triggers toast message', async ({ page }) => {
  await page.goto('/');

  const widgetButton = page.locator('#feedback-button');
  await expect(widgetButton).toBeVisible();

  await widgetButton.click();

  await expect(page.locator('#feedback-panel')).toBeVisible();
  await expect(page.locator('#feedback-toast')).toContainText("phone just buzzed", { timeout: 5_000 });
});

test('visitor message appears in conversation and is persisted on the server', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');

  const messageText = 'Hello from Playwright basic flow test';
  await page.fill('#feedback-text', messageText);
  await page.click('#send-btn');

  await expect(page.locator('.conversation .message.visitor .text').last()).toContainText(messageText);

  const visitorId = await getVisitorId(page);
  const response = await page.context().request.get(`/api/threads/${visitorId}/messages`);
  expect(response.ok(), 'conversation history request should succeed').toBeTruthy();

  const data = await response.json();
  const texts = (data.messages || []).map(m => m.text);
  expect(texts).toContain(messageText);
});

test('character counter updates while typing and resets after send', async ({ page }) => {
  await page.goto('/');
  await page.click('#feedback-button');

  const textarea = page.locator('#feedback-text');
  const counter = page.locator('#char-count');

  await textarea.fill('Typing...');
  await expect(counter).toHaveText('9');

  await page.click('#send-btn');
  await expect(counter).toHaveText('0');
});
