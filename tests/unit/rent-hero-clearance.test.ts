import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the /rent hero against the car photo underlapping the intro copy.
 *
 * <CarHero> is an `absolute inset-0` overlay on the InfoPage hero band, with the car cutout pinned
 * to the bottom edge. On xl+ that composes with the text column (max-w-2xl on the left, car on the
 * right — measured 2026-08-01: only the low bonnet grazes the text's right edge, kept legible by
 * the scrim). Below xl the text is effectively full-width, so the same overlay put ~94px (375px
 * viewport) to ~138px (768px) of white paragraph on top of the red car — unreadable (reported on
 * mobile 2026-08-01).
 *
 * The contract that keeps them apart below xl:
 *  - InfoPage reserves the car scene's height as extra bottom padding on the text block, sized in
 *    vw because the car itself is vw-sized: height = width × (525/922 image aspect) → ~35vw for
 *    the w-[62%] mobile car (reserve 36vw + gutter), ~30vw for the sm:w-[52%] one. From xl the
 *    band returns to the shipped pb-28 overlay layout.
 *  - CarHero pins the car a FIXED distance up (bottom-5) below xl, so the reservation arithmetic
 *    holds at any text height; the %-of-band offset only returns with the xl overlay mode.
 *
 * Source scan on purpose: the suite runs in the `node` environment with no layout engine; this
 * repo guards rendering drift this way (hydration-safety, edge-runtime). The numbers were
 * verified against real DOM geometry at 375/768/1024/1280 before landing.
 */

const infoPage = readFileSync(
  join(process.cwd(), 'src', 'components', 'site', 'InfoPage.tsx'),
  'utf8',
);
const carHero = readFileSync(
  join(process.cwd(), 'src', 'components', 'rental', 'CarHero.tsx'),
  'utf8',
);

describe('rent hero clearance', () => {
  it('InfoPage reserves a vw-sized bottom band for the hero art below xl', () => {
    // The heroArt branch of the hero band's padding. Literal on purpose: if the design changes,
    // re-verify the geometry in a browser (375/768/1024/1280) and update this together with it.
    expect(infoPage).toMatch(
      /heroArt\s*\?\s*'pb-\[calc\(36vw\+2rem\)\] sm:pb-\[calc\(30vw\+2rem\)\] xl:pb-28'/,
    );
  });

  it('InfoPage keeps the plain-band padding for pages without hero art', () => {
    expect(infoPage).toMatch(/'pb-14 sm:pb-20'/);
  });

  it('CarHero pins the car a fixed distance up below xl, %-of-band only from xl', () => {
    expect(carHero).toMatch(/(?:^|[\s"'`])bottom-5(?:[\s"'`]|$)/m);
    expect(carHero).toMatch(/xl:bottom-\[7%\]/);
    // The un-prefixed %-offset must be gone — it made the reserved-band arithmetic circular
    // (offset grows with the padding that tries to clear it).
    expect(carHero).not.toMatch(/(?:^|[\s"'`])bottom-\[7%\]/m);
  });
});
