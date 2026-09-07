import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const externalBaseUrl = process.env.PLAYWRIGHT_TEST_BASE_URL;
const localChromium = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome 2.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
  ].find(existsSync);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: externalBaseUrl || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], ...(!process.env.CI && localChromium ? { launchOptions: { executablePath: localChromium } } : {}) } }],
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run dev',
    url: 'http://127.0.0.1:4173',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test',
      PORT: '4173',
      DATABASE_APP_URL: 'postgresql://app_backend:test@127.0.0.1:54322/postgres?schema=public',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'playwright-public-key'
    }
  }
});
