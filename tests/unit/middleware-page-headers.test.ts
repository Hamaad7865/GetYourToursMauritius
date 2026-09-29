import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware';
import { NO_STORE_PATHS, PAGE_SECURITY_HEADERS } from '@/lib/security-headers';

/* On Cloudflare Pages a response that passes through middleware loses every next.config header, so
 * the page-level ones are set by the middleware itself (technical audit, 30 Sep 2026: every HTML
 * page was served without them, while API routes and static files had them). */

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

const run = (path: string) => middleware(new NextRequest(`https://bellemaretours.com${path}`));

describe('page response headers', () => {
  it('match the site-wide security rule in next.config.mjs', () => {
    const siteWide = rules.find((r) => r.source === '/(.*)' && !r.has)!;
    for (const [name, value] of PAGE_SECURITY_HEADERS) {
      expect(siteWide.headers.find((h) => h.key === name)?.value, name).toBe(value);
    }
  });

  it('are set on English and French pages alike', () => {
    for (const path of ['/', '/activities', '/fr', '/fr/mauritius-catamaran-cruise']) {
      const res = run(path);
      for (const [name, value] of PAGE_SECURITY_HEADERS) {
        expect(res.headers.get(name), `${path} ${name}`).toBe(value);
      }
    }
  });

  it('name the page language for crawlers that skip JavaScript', () => {
    expect(run('/activities').headers.get('Content-Language')).toBe('en');
    expect(run('/fr/activities').headers.get('Content-Language')).toBe('fr');
  });

  it('keep checkout out of every cache in both languages, as next.config intends', () => {
    for (const path of NO_STORE_PATHS) {
      expect(rules.find((r) => r.source === path)?.headers[0]?.value).toContain('no-store');
      expect(run(path).headers.get('Cache-Control')).toContain('no-store');
      expect(run(`/fr${path}`).headers.get('Cache-Control')).toContain('no-store');
    }
    expect(run('/activities').headers.get('Cache-Control')).toBeNull();
  });

  it('still rewrite French onto the shared route', () => {
    expect(new URL(run('/fr/rent').headers.get('x-middleware-rewrite')!).pathname).toBe('/rent');
  });
});
