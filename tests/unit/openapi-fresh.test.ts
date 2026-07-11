import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { buildOpenApiDocument } from '@/lib/openapi/document';

/**
 * The committed openapi.json (consumed by the mobile team / external tooling) must match what the
 * generator emits. It had drifted — missing the private-option, age-band, and transfer-coordinate
 * schema changes — because nobody re-ran `npm run openapi:write` after those features. This guard
 * fails CI the moment the committed spec lags the generator.
 *
 * Fix when it fails: `npm run openapi:write` and commit openapi.json.
 */
const norm = (s: string) => s.replace(/\r\n/g, '\n');

describe('openapi.json is in sync with the generator', () => {
  it('equals buildOpenApiDocument() output (run `npm run openapi:write` to refresh)', () => {
    const committed = norm(readFileSync(join(process.cwd(), 'openapi.json'), 'utf8'));
    // Must match write-openapi.ts byte-for-byte: 2-space indent + a trailing newline.
    const fresh = `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
    expect(committed).toBe(fresh);
  });
});
