import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Read the config as text rather than importing it — next.config.mjs pulls in
// '@cloudflare/next-on-pages/next-dev', which has no place loading under the node test env. We only
// need to pin the caching invariant, which a text assertion does reliably.
const config = readFileSync(join(process.cwd(), 'next.config.mjs'), 'utf8');

describe('next.config headers() caching', () => {
  it('does NOT blanket-cache the activity detail path (headers() ignore status, so it would cache 404s)', () => {
    // Match the actual rule, not any mention — the explanatory comment legitimately names the path.
    expect(config).not.toContain("source: '/activities/:slug*'");
  });

  it('still edge-caches the listing paths, which never 404', () => {
    expect(config).toContain("source: '/activities'");
    expect(config).toContain('s-maxage=300');
  });

  it('sets no-store on /checkout so a bfcache re-execution cannot create a duplicate booking', () => {
    expect(config).toContain("source: '/checkout'");
    expect(config).toContain('no-store');
  });
});
