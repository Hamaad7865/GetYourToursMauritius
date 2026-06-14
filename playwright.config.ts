import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the app. Phase 0 ships a placeholder smoke test;
 * the booking -> payment -> webhook flow lands in Phase 4 and runs against
 * `wrangler pages dev` for edge fidelity.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
