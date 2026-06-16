import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/lib/openapi/document';
import { apiPaths } from '@/lib/openapi/registry';

/** Maps every app/api/v1/**\/route.ts file to its OpenAPI path (`[slug]` -> `{slug}`). */
function discoverRoutePaths(): string[] {
  const root = join(process.cwd(), 'app', 'api', 'v1');
  const found: string[] = [];
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), [...segments, entry.name]);
      } else if (entry.name === 'route.ts') {
        found.push('/' + segments.map((s) => s.replace(/^\[(.+)\]$/, '{$1}')).join('/'));
      }
    }
  };
  walk(root, []);
  return found;
}

describe('OpenAPI document', () => {
  it('builds a valid 3.1 document from the Zod schemas', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('GetYourToursMauritius API');
  });

  it('registers the catalogue + booking operations with a bearer scheme', () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/activities']?.get?.operationId).toBe('searchActivities');
    expect(doc.paths?.['/bookings']?.post?.operationId).toBe('createBooking');
    expect(doc.paths?.['/bookings/{ref}']?.get?.operationId).toBe('getBooking');
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });

  it('registers every /api/v1 route in the spec (webhooks intentionally excluded)', () => {
    const documented = new Set(Object.keys(apiPaths));
    const missing = discoverRoutePaths()
      .filter((path) => !path.startsWith('/webhooks'))
      .filter((path) => !documented.has(path));
    expect(missing).toEqual([]);
  });
});
