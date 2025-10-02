require('ts-node/register');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  globalSetup: './e2e/global-setup.js',
  webServer: {
    command: 'bun run dev',
    port: 3000,
    timeout: 10_000,
    reuseExistingServer: true,
    env: {
      TEST_MODE: 'true',
      ADMIN_PASSWORD: 'temp_dev_password_123',
      NTFY_TOPIC: '',
      NTFY_SERVER: 'https://ntfy.sh',
      THREADS_DIR: './data/threads/test',
      BLOCKED_DIR: './data/blocked/test',
    },
  },
});
