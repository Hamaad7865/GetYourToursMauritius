import { expect, test } from '@playwright/test';

/**
 * Homepage smoke — runs in CI (the `e2e` job) against the app built + served by playwright.config's
 * webServer. It needs no Supabase/Peach config (the homepage catalogue fetch degrades to []), so it's a
 * cheap guard that the app actually BOOTS in a browser: it catches edge-runtime boot failures, hydration
 * breakage, and 500s that `next build` alone never exercises. The full booking -> payment -> webhook
 * journey (which needs a provisioned test Supabase) lands later.
 */
test('home page boots and renders the brand', async ({ page }) => {
  const response = await page.goto('/');
  // The page served without a 5xx (a boot/render crash) — the core thing this smoke protects.
  expect(response?.status() ?? 0).toBeLessThan(400);

  // The hero H1 renders (there is exactly one level-1 heading).
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The brand is in the document title — a single, unambiguous element (`getByText('Belle Mare Tours')`
  // would match the many brand links/headings on the page and trip Playwright's strict mode).
  await expect(page).toHaveTitle(/Belle Mare Tours/);
});
