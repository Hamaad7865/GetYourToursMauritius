import { describe, expect, it } from 'vitest';
import {
  DRAFT_TTL_MS,
  draftHasContent,
  draftKey,
  parseDraft,
  type CheckoutDraft,
} from '@/lib/checkout/draft';

/**
 * Why this exists: "Continue with Google" and an email-confirmation sign-up both redirect the browser
 * away from checkout, and `next` carries only pathname + search. Nothing the customer typed is in the
 * URL (a pickup address must never ride a query string), so the return trip used to mount checkout
 * fresh — back at step 1 with an empty form, after they had already chosen their address.
 */
const NOW = 1_800_000_000_000;

function stored(draft: Partial<CheckoutDraft>, savedAt = NOW): string {
  return JSON.stringify({ savedAt, ...draft });
}

describe('draftKey', () => {
  it('scopes the draft to the occurrence, like the hold and cart-line stashes', () => {
    expect(draftKey('occ-1')).toBe('gytm:checkout:occ-1');
    expect(draftKey('occ-2')).not.toBe(draftKey('occ-1'));
  });
});

describe('parseDraft: what comes back', () => {
  it('restores the pickup the customer chose before signing in', () => {
    const d = parseDraft(
      stored({ pickupLoc: 'Hotel Ambre, Belle Mare', pickupCoords: { lat: -20.19, lng: 57.77 } }),
      NOW,
    );
    expect(d?.pickupLoc).toBe('Hotel Ambre, Belle Mare');
    expect(d?.pickupCoords).toEqual({ lat: -20.19, lng: 57.77 });
  });

  it('restores the transfer answers too — step 1 is flight details for a transfer', () => {
    const d = parseDraft(
      stored({
        tripDirection: 'return',
        dropoffSlug: 'shandrani-beachcomber',
        flightNumber: 'MK015',
        arrivalTime: '14:30',
        childSeatWanted: true,
        childSeatAge: '3',
      }),
      NOW,
    );
    expect(d?.tripDirection).toBe('return');
    expect(d?.dropoffSlug).toBe('shandrani-beachcomber');
    expect(d?.flightNumber).toBe('MK015');
    expect(d?.childSeatWanted).toBe(true);
  });

  it('keeps the false branch of a boolean — "no pickup" is an answer, not an absence', () => {
    const d = parseDraft(stored({ wantsPickup: false, dropoffSame: false }), NOW);
    expect(d?.wantsPickup).toBe(false);
    expect(d?.dropoffSame).toBe(false);
  });

  it('puts them back on the step they were on', () => {
    expect(parseDraft(stored({ step: 2 }), NOW)?.step).toBe(2);
  });

  // Step 3 is Pay, which needs a live booking owned by the separate gytm:booking:{occ} stash.
  // Restoring there from a draft would show a pay panel with nothing behind it.
  it('never restores past the sign-in/details step', () => {
    expect(parseDraft(stored({ step: 3 }), NOW)?.step).toBe(2);
    expect(parseDraft(stored({ step: 99 }), NOW)?.step).toBe(2);
    expect(parseDraft(stored({ step: 0 }), NOW)?.step).toBe(1);
    expect(parseDraft(stored({ step: -5 }), NOW)?.step).toBe(1);
  });
});

describe('parseDraft: what is rejected', () => {
  it('returns null for absent or malformed storage', () => {
    expect(parseDraft(null, NOW)).toBeNull();
    expect(parseDraft('', NOW)).toBeNull();
    expect(parseDraft('not json', NOW)).toBeNull();
    expect(parseDraft('"a string"', NOW)).toBeNull();
    expect(parseDraft('null', NOW)).toBeNull();
  });

  it('ignores an unstamped draft', () => {
    expect(parseDraft(JSON.stringify({ pickupLoc: 'somewhere' }), NOW)).toBeNull();
  });

  // A tab left open overnight must not resurrect yesterday's address into a new booking.
  it('expires a draft older than the window, and keeps one inside it', () => {
    expect(parseDraft(stored({ pickupLoc: 'x' }, NOW - DRAFT_TTL_MS - 1), NOW)).toBeNull();
    expect(parseDraft(stored({ pickupLoc: 'x' }, NOW - DRAFT_TTL_MS + 1000), NOW)?.pickupLoc).toBe(
      'x',
    );
  });

  it('ignores a draft stamped in the future (a clock change, or a hand-edited stash)', () => {
    expect(parseDraft(stored({ pickupLoc: 'x' }, NOW + 60_000), NOW)).toBeNull();
  });

  // Same-origin data the customer's own tab wrote, but still parsed input: a wrong-typed value must
  // degrade to "not set" rather than push undefined into a form field or a fare calculation.
  it('drops fields of the wrong type instead of trusting them', () => {
    const d = parseDraft(
      JSON.stringify({
        savedAt: NOW,
        pickupLoc: 42,
        wantsPickup: 'yes',
        tripDirection: 'sideways',
        pickupCoords: { lat: 'north', lng: 57 },
        dropoffCoords: { lat: Number.NaN, lng: 57 },
        childSeatAge: null,
      }),
      NOW,
    );
    expect(d).not.toBeNull();
    expect(d?.pickupLoc).toBeUndefined();
    expect(d?.wantsPickup).toBeUndefined();
    expect(d?.tripDirection).toBeUndefined();
    expect(d?.pickupCoords).toBeUndefined();
    expect(d?.dropoffCoords).toBeUndefined();
    expect(d?.childSeatAge).toBeUndefined();
  });
});

describe('draftHasContent', () => {
  it('is false for an empty form, so nothing is written before the customer types', () => {
    expect(draftHasContent({})).toBe(false);
    expect(draftHasContent({ savedAt: NOW, step: 1 })).toBe(false);
    expect(draftHasContent({ pickupLoc: '', dropoffText: '   ' })).toBe(false);
  });

  it('is true once anything real is entered', () => {
    expect(draftHasContent({ pickupLoc: 'Trou aux Biches' })).toBe(true);
    expect(draftHasContent({ pickupCoords: { lat: -20, lng: 57 } })).toBe(true);
    // "I don't want a pickup" is a real answer worth keeping.
    expect(draftHasContent({ wantsPickup: false })).toBe(true);
  });
});
