import { describe, expect, it } from 'vitest';
import {
  applyDefaults,
  highlightsAreOverridden,
  mergeList,
  replaceList,
  type ActivityContent,
  type ContentDefaultsMap,
} from '@/lib/catalogue/content-defaults';

/**
 * Per-category standard content. Spec:
 * docs/superpowers/specs/2026-07-16-activity-content-defaults-design.md
 *
 * The asymmetry is the whole point and is easy to "tidy" away later, so it is pinned here: the four
 * list fields MERGE (shared first, deduped), Highlights REPLACE. Highlights replace because a tour's
 * own `highlights` are bare place names (the stops it visits) while the shared set is prose operator
 * promises — merging them renders six sentences followed by five labels, across 9 live sightseeing
 * tours.
 */
const own: ActivityContent = {
  highlights: ['Trou aux Biches Beach', 'Mont Choisy Beach'],
  inclusions: ['Bottled water'],
  exclusions: ['Tips'],
  whatToBring: ['Towel', 'Sunscreen'],
  importantInfo: ['Bring cash'],
};

const defaults: ContentDefaultsMap = {
  'Taxi Sightseeing tours': {
    highlights: ['Private, air-conditioned vehicle with a driver-guide.'],
    inclusions: ['Hotel pickup'],
    exclusions: ['Entrance fees'],
    whatToBring: ['Sunscreen'], // deliberately duplicates one of `own.whatToBring`
    importantInfo: ['Bring cash'], // deliberately duplicates `own.importantInfo`
  },
};

describe('mergeList', () => {
  it('puts shared first, then the activity’s own', () => {
    expect(mergeList(['a', 'b'], ['c'])).toEqual(['a', 'b', 'c']);
  });

  it('drops exact-string duplicates from the activity’s own', () => {
    expect(mergeList(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('handles either side being empty', () => {
    expect(mergeList([], ['a'])).toEqual(['a']);
    expect(mergeList(['a'], [])).toEqual(['a']);
    expect(mergeList([], [])).toEqual([]);
  });

  it('is case- and whitespace-SENSITIVE (only exact duplicates collapse)', () => {
    expect(mergeList(['Towel'], ['towel', 'Towel '])).toEqual(['Towel', 'towel', 'Towel ']);
  });
});

describe('replaceList (highlights)', () => {
  it('shared wins outright when present — the activity’s own is discarded', () => {
    expect(replaceList(['shared'], ['own1', 'own2'])).toEqual(['shared']);
  });

  it('falls back to the activity’s own when shared is empty', () => {
    // A category with a standard set but no highlights must not blank the section.
    expect(replaceList([], ['own1'])).toEqual(['own1']);
  });
});

describe('applyDefaults', () => {
  it('merges the four lists and REPLACES highlights', () => {
    const out = applyDefaults('Taxi Sightseeing tours', own, defaults);
    expect(out.highlights).toEqual(['Private, air-conditioned vehicle with a driver-guide.']);
    expect(out.highlights).not.toContain('Trou aux Biches Beach'); // the 50-hidden-lines regression
    expect(out.inclusions).toEqual(['Hotel pickup', 'Bottled water']);
    expect(out.exclusions).toEqual(['Entrance fees', 'Tips']);
    expect(out.whatToBring).toEqual(['Sunscreen', 'Towel']); // duplicate collapsed, shared first
    expect(out.importantInfo).toEqual(['Bring cash']); // duplicate collapsed entirely
  });

  it('a category with NO standard set renders the activity’s own content untouched', () => {
    // Also the fail-soft path: if the defaults RPC is unavailable we pass an empty map.
    expect(applyDefaults('Speedboat Tours', own, defaults)).toEqual(own);
    expect(applyDefaults('Taxi Sightseeing tours', own, {})).toEqual(own);
  });

  it('does not mutate its inputs', () => {
    const snapshot = structuredClone(own);
    applyDefaults('Taxi Sightseeing tours', own, defaults);
    expect(own).toEqual(snapshot);
  });

  it('Airport transfers get NO sightseeing content — pins the intended scope delta', () => {
    // Today the sightseeing set is keyed off pricing_mode='vehicle', which sweeps in Airport transfers.
    // Scoping by category deliberately drops them; nobody should "restore" the vehicle rule later.
    const out = applyDefaults('Airport transfers', own, defaults);
    expect(out.highlights).toEqual(own.highlights);
    expect(out.importantInfo).toEqual(own.importantInfo);
  });
});

describe('highlightsAreOverridden (drives the admin notice)', () => {
  it('true when the category has non-empty standard highlights', () => {
    expect(highlightsAreOverridden('Taxi Sightseeing tours', defaults)).toBe(true);
  });

  it('false for a category with no set, or a set with no highlights', () => {
    expect(highlightsAreOverridden('Speedboat Tours', defaults)).toBe(false);
    expect(
      highlightsAreOverridden('X', {
        X: { ...defaults['Taxi Sightseeing tours']!, highlights: [] },
      }),
    ).toBe(false);
  });
});
