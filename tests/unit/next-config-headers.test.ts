import { describe, expect, it } from 'vitest';

/**
 * These assertions run the real `headers()` and inspect what it returns, rather than grepping the
 * config as text. The text form pinned the same invariants only as long as the rules stayed written
 * out one literal at a time — the moment they were generated (to mirror every rule under /fr) the
 * assertions broke while the behaviour was fine, which is the wrong way round for a guard test.
 */
interface Rule {
  source: string;
  headers: { key: string; value: string }[];
  has?: unknown;
}

const rules: Rule[] = await (
  (await import('../../next.config.mjs')) as unknown as {
    default: { headers: () => Promise<Rule[]> };
  }
).default.headers();

/** The value of `key` on the rule for exactly `source`, ignoring the site-wide security rule. */
function headerFor(source: string, key: string): string | undefined {
  for (const rule of rules) {
    if (rule.source !== source || rule.has) continue;
    const hit = rule.headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
    if (hit) return hit.value;
  }
  return undefined;
}

const cachedSources = rules
  .filter((r) => !r.has && r.headers.some((h) => h.key === 'Cache-Control'))
  .map((r) => r.source);

describe('next.config headers() caching', () => {
  // headers() match by path regardless of RESPONSE STATUS, so a rule here would also cache the 404
  // of an unpublished or renamed tour — and hold it at the edge for five minutes after an admin
  // publishes it.
  it('does NOT blanket-cache the activity detail path', () => {
    expect(cachedSources).not.toContain('/activities/:slug*');
    expect(cachedSources).not.toContain('/fr/activities/:slug*');
  });

  it('still edge-caches the listing paths, which never 404', () => {
    expect(headerFor('/activities', 'Cache-Control')).toContain('s-maxage=300');
  });

  it('sets no-store on /checkout so a bfcache re-execution cannot create a duplicate booking', () => {
    expect(headerFor('/checkout', 'Cache-Control')).toContain('no-store');
  });

  // A cached page is served from the edge to N readers while Postgres sees ~one revalidation. The
  // rules match by path, so French — which lives at its own URLs — needs its own copy of every rule
  // or the entire French half of the site bypasses that shield.
  it('mirrors every cache rule under /fr', () => {
    const french = cachedSources.filter((s) => s === '/fr' || s.startsWith('/fr/'));
    const english = cachedSources.filter((s) => s !== '/fr' && !s.startsWith('/fr/'));
    expect(french).toHaveLength(english.length);
    for (const source of english) {
      expect(french).toContain(source === '/' ? '/fr' : `/fr${source}`);
    }
  });

  // Locale comes from the URL under /fr, but DISPLAY CURRENCY is still a cookie — so a shared cache
  // that ignored it could hand one visitor's EUR rendering to the next visitor expecting USD.
  it('varies on Cookie everywhere it caches, French included', () => {
    for (const source of cachedSources) {
      expect(headerFor(source, 'Vary')).toBe('Cookie');
    }
  });

  it('keeps /fr/checkout out of any cache, exactly like /checkout', () => {
    expect(headerFor('/fr/checkout', 'Cache-Control')).toContain('no-store');
  });
});
