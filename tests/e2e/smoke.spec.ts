import { expect, test } from '@playwright/test';

/**
 * Phase 0 placeholder smoke test. Runs with `npm run test:e2e` against a running
 * dev server (not part of the unit/integration gate). The full booking ->
 * payment -> webhook journey lands in Phase 4.
 */
test('home page renders the brand hero', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText('Belle Mare Tours')).toBeVisible();
});
