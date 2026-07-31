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
