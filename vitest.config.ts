import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  // Component .tsx files in this repo rely on Next.js's SWC to inject the automatic JSX runtime, so
  // they never `import React` themselves. esbuild's default (classic) transform then throws
  // "React is not defined" the first time a test imports one — tell esbuild to use the same
  // automatic runtime so a .tsx module (or anything it transitively imports) loads cleanly under Vite.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    globals: false,
    // Vitest's default is 5s, which is too tight for THIS suite's setup costs — not for its
    // assertions. Several tests re-import a module graph under a fresh mock (`vi.resetModules()` then
    // a dynamic `import()` of a route or client — auth-email-hook, release-queue, payment-provider,
    // health-release-metadata), and the first such test in a file pays that graph's cold transform.
    // Under the full suite's parallelism that alone can exceed 5s: a failing run reported 434s of
    // transform and 837s of collect summed across workers. The symptom was a different test timing
    // out on maybe one run in three — release-queue one time, auth-email-hook the next — which reads
    // as "flaky suite" and is really "budget too small for the work being done".
    //
    // Raising it costs nothing on a passing test (a timeout only fires when something is stuck) and
    // buys back a deterministic suite. That matters more than usual here: a red CI silently stops the
    // Cloudflare deploy, so an intermittent test blocks shipping rather than just being noise.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    setupFiles: ['./tests/setup/test-env.ts'],
    include: ['tests/**/*.{test,spec}.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**', '.next/**', '.vercel/**'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/supabase/types.ts', 'src/lib/**/*.d.ts'],
      // Enforced by CI (`npm run test:coverage`). Floors sit a few points below the current numbers
      // (statements/lines ~86%, branches ~76%, functions ~75%) so ordinary churn doesn't trip them, but
      // a real regression — a whole module left untested — fails the build instead of sliding silently.
      thresholds: {
        statements: 80,
        lines: 80,
        functions: 68,
        branches: 68,
      },
    },
  },
});
