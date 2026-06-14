import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Deterministic replacement for eslint-plugin-next-on-pages (which doesn't yet
 * support ESLint 9): every API route must run on the edge/Workers runtime, or the
 * next-on-pages build fails. This asserts each route file declares it.
 */
function findRouteFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
      found.push(fullPath);
    }
  }
  return found;
}

describe('API routes are edge-safe', () => {
  const routes = findRouteFiles(join(process.cwd(), 'app', 'api'));

  it('discovers route handlers', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it.each(routes)('%s declares the edge runtime', (file) => {
    const source = readFileSync(file, 'utf8');
    expect(source).toMatch(/export const runtime\s*=\s*['"]edge['"]/);
  });
});
