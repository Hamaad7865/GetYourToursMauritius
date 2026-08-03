import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { translate } from '@/lib/i18n/translate';

/**
 * Guards the gallery's photo-count button against "View all 1 photos".
 *
 * The label was built unconditionally as t('View all {n} photos', { n: images.length });
 * interpolation is plain string substitution (translate.ts), so an activity with exactly one
 * image rendered the grammatically broken "View all 1 photos" — observed live on
 * /activities/western-cruise-catamaran (2026-08-03) while it temporarily had a single photo.
 *
 * The fix branches on images.length === 1 to a distinct 'View photo' key, the same ternary idiom
 * the rest of the app uses for singular/plural (SearchBar's traveller count, checkout's guests).
 * Two halves have to hold, and each is pinned below:
 *   1. Gallery.tsx keeps the singular branch — source scan, because the suite runs in the node
 *      environment with no renderer; this repo already guards component drift this way
 *      (fixed-height-grid-rows, snap-rail-scroll-padding).
 *   2. The new key is translated: messages.ts is an EXACT-match table and a missing key silently
 *      falls back to English (docs/handbook/localisation.md), so the singular fix in English
 *      would otherwise quietly undo the French localisation of this button.
 */

const gallerySrc = readFileSync(
  join(process.cwd(), 'src', 'components', 'gyg', 'detail', 'Gallery.tsx'),
  'utf8',
);

describe('gallery photo-count button', () => {
  it('branches to a singular label for a one-photo activity', () => {
    expect(
      /images\.length === 1\s*\?\s*t\('View photo'\)/.test(gallerySrc),
      `Gallery.tsx must pick t('View photo') behind an images.length === 1 branch — without it ` +
        `a one-image activity renders "View all 1 photos" (western-cruise-catamaran, 2026-08-03).`,
    ).toBe(true);
  });

  it('keeps the plural label for multi-photo activities', () => {
    expect(
      gallerySrc.includes("t('View all {n} photos', { n: images.length })"),
      'the plural arm must survive the singular fix — multi-photo galleries still count.',
    ).toBe(true);
  });

  it('translates the singular key to French', () => {
    // Exact-match lookup: an absent key returns the English source, so equality with the English
    // key means the FR entry is missing (or was retyped instead of copied — the apostrophe trap).
    expect(translate('fr', 'View photo')).toBe('Voir la photo');
    expect(translate('fr', 'View all {n} photos', { n: 5 })).toBe('Voir les 5 photos');
  });
});
