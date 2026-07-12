import { defineConfig, devices } from '@playwright/test';

const PORT = 3000;

/**
 * End-to-end tests run against the app. Today this is a homepage smoke (brand chrome renders) that runs
 * in CI without any Supabase/Peach config — the homepage degrades gracefully (the catalogue fetch is
 * try/caught to []), so the smoke still catches edge-runtime boot failures, hydration breakage, and 500s
 * that `next build` alone never exercises. The full booking -> payment -> webhook journey (which needs a
 * provisioned test Supabase) lands later and would run against `wrangler pages dev` for edge fidelity.
 *
 * `webServer` builds + starts the app so CI needs no separate serve step; locally, set E2E_BASE_URL to
 * skip it and point at an already-running dev server.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  // Skip the managed server when E2E_BASE_URL is set (local dev against a running server).
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run build && npx next start -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        timeout: 180_000,
        reuseExistingServer: !process.env.CI,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
