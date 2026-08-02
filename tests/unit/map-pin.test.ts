import { afterEach, describe, expect, it, vi } from 'vitest';
import { bmtMarkerContent } from '@/components/maps/pin';

/**
 * The branded activity marker's badge logic. The map pin now carries the ACTIVITY'S OWN photo (so a
 * traveller can tell forty pins apart) with the brand mark as the fallback — this pins that choice,
 * including the error path, which is the part that can't be eyeballed in the browser.
 *
 * The suite runs in the `node` environment (see vitest.config.ts) and no DOM library is installed, so
 * the handful of element APIs this builder touches are stubbed rather than pulling in jsdom.
 */
interface StubEl {
  style: { cssText: string };
  children: StubEl[];
  append: (...kids: StubEl[]) => void;
  [k: string]: unknown;
}

function stubDocument(): void {
  vi.stubGlobal('document', {
    createElement: (): StubEl => {
      const el: StubEl = {
        style: { cssText: '' },
        children: [],
        append(...kids: StubEl[]) {
          el.children.push(...kids);
        },
      };
      return el;
    },
  });
}

/** The pill's children in append order: [badge, price]. `unknown` because the builder's real return
 *  type is HTMLElement, which the stub only structurally imitates. */
function childOf(pill: unknown, i: number): StubEl {
  return (pill as StubEl).children[i]!;
}
const badgeOf = (pill: unknown): StubEl => childOf(pill, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bmtMarkerContent — the pin depicts the activity', () => {
  it('uses the activity’s own photo when it has one', () => {
    stubDocument();
    const pill = bmtMarkerContent({ priceLabel: '€90', imageUrl: 'https://cdn/x/hero.jpg' });
    expect(badgeOf(pill).src).toBe('https://cdn/x/hero.jpg');
  });

  it('falls back to the brand mark when the activity has no photo', () => {
    stubDocument();
    expect(badgeOf(bmtMarkerContent({ priceLabel: '€90', imageUrl: null })).src).toBe('/icon.svg');
    // No photo ⇒ no error handler to install (nothing could fail to load).
    expect(
      badgeOf(bmtMarkerContent({ priceLabel: '€90', imageUrl: null })).onerror,
    ).toBeUndefined();
  });

  it('swaps a dead photo URL for the brand mark exactly once — never a broken-image glyph, never a loop', () => {
    stubDocument();
    const badge = badgeOf(
      bmtMarkerContent({ priceLabel: '€90', imageUrl: 'https://cdn/gone.jpg' }),
    );
    (badge.onerror as () => void)();
    expect(badge.src).toBe('/icon.svg');
    // Cleared, so a failing /icon.svg can't re-enter the handler forever.
    expect(badge.onerror).toBeNull();
  });

  it('carries the price on both the browse and the recommended (selected) pill', () => {
    stubDocument();
    for (const selected of [false, true]) {
      const pill = bmtMarkerContent({ priceLabel: '€265', selected, imageUrl: null });
      expect(childOf(pill, 1).textContent).toBe('€265');
    }
  });
});
