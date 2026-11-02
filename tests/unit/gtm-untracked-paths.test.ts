import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { isUntrackedPath } from '@/lib/analytics/untracked-paths';
import { bootstrap } from '@/components/site/GoogleTagManager';

describe('isUntrackedPath', () => {
  it('keeps GTM off the whole back office', () => {
    expect(isUntrackedPath('/admin')).toBe(true);
    expect(isUntrackedPath('/admin/')).toBe(true);
    expect(isUntrackedPath('/admin/bookings')).toBe(true);
    expect(isUntrackedPath('/admin/activities/abc/edit')).toBe(true);
  });

  it('tracks every public page, including ones that merely start with the letters', () => {
    expect(isUntrackedPath('/')).toBe(false);
    expect(isUntrackedPath('/fr')).toBe(false);
    expect(isUntrackedPath('/bookings/BMT123')).toBe(false);
    expect(isUntrackedPath('/administration-fees')).toBe(false);
    expect(isUntrackedPath('/blog/admin-tips')).toBe(false);
  });
});

/** Runs the real inline bootstrap against a fake page and reports what it did. */
function runBootstrap(pathname: string) {
  const inserted: Array<{ src: string }> = [];
  const page = {
    location: { pathname },
    localStorage: { getItem: () => null },
    document: {
      createElement: () => ({ async: false, src: '' }),
      getElementsByTagName: () => [
        { parentNode: { insertBefore: (el: { src: string }) => inserted.push(el) } },
      ],
    },
  } as Record<string, unknown>;
  page.window = page;
  // Strict mode, so the test cannot pass on sloppy-mode hoisting of a block function declaration.
  runInNewContext(`'use strict';\n${bootstrap}`, page);
  return { dataLayer: page.dataLayer as unknown[] | undefined, gtag: page.gtag, inserted };
}

describe('GTM bootstrap', () => {
  it('loads the container with consent denied first on a public page', () => {
    const { dataLayer, gtag, inserted } = runBootstrap('/activities/seaplane');
    // applyConsent (the cookie banner) calls window.gtag: it must be global, not block-scoped.
    expect(typeof gtag).toBe('function');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.src).toContain('googletagmanager.com/gtm.js?id=');
    // ORDERING IS LOAD-BEARING: the consent default is in the dataLayer before gtm.js is requested.
    const first = Array.from(dataLayer?.[0] as ArrayLike<unknown>);
    expect(first.slice(0, 2)).toEqual(['consent', 'default']);
    expect(dataLayer?.at(-1)).toMatchObject({ event: 'gtm.js' });
  });

  it('does nothing at all on the back office: no container, no dataLayer, no consent pings', () => {
    for (const path of ['/admin', '/admin/bookings']) {
      const { dataLayer, gtag, inserted } = runBootstrap(path);
      expect(inserted).toHaveLength(0);
      expect(dataLayer).toBeUndefined();
      expect(gtag).toBeUndefined();
    }
  });
});
