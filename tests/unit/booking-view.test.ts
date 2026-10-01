import { describe, expect, it } from 'vitest';
import { bookingCardHidden, galleryPhase } from '@/lib/booking/booking-view';

/**
 * /bookings/REF is the booking-confirmation card (receipt, pickup, invoice, cancel) followed by the
 * guest's private gallery. The gallery's own links (the delivery email, Account → Galleries, Account →
 * Bookings) all end in #gallery, and a guest who comes for their PHOTOS should land on the photos, not
 * on a receipt they already have. These tests pin WHEN the card steps aside: only for a gallery that is
 * really open, only when the guest asked for it by that link, and never in a way that could hide the
 * pay / cancel / invoice controls for good.
 */

describe('galleryPhase', () => {
  const settled = { authLoading: false, hasSession: true, hasData: true, open: true };

  it('is pending while the session check is still running, even though there is no session YET', () => {
    // Treating "no session yet" as "no gallery" would flash the card at every signed-in guest.
    expect(galleryPhase({ ...settled, authLoading: true, hasSession: false, hasData: false })).toBe(
      'pending',
    );
  });

  it('is "other" once the session check has finished with nobody signed in', () => {
    expect(galleryPhase({ ...settled, hasSession: false, hasData: false, open: false })).toBe(
      'other',
    );
  });

  it('is pending while the signed-in guest’s gallery request is in flight', () => {
    expect(galleryPhase({ ...settled, hasData: false, open: false })).toBe('pending');
  });

  it('is open only for an unlocked gallery that has something in it', () => {
    expect(galleryPhase(settled)).toBe('open');
  });

  it('is "other" for a locked gallery, a booking without one, or a failed request', () => {
    expect(galleryPhase({ ...settled, open: false })).toBe('other');
  });
});

describe('bookingCardHidden', () => {
  const grace = (graceOver: boolean) => ({ graceOver });

  it('hides the card for an open gallery opened by its own link', () => {
    expect(bookingCardHidden({ hash: '#gallery', phase: 'open', ...grace(false) })).toBe(true);
    expect(bookingCardHidden({ hash: '#gallery', phase: 'open', ...grace(true) })).toBe(true);
  });

  it('keeps the card for every other way into the page', () => {
    for (const hash of [
      '',
      '#',
      '#booking-details',
      '#balance-payment',
      '#gallery-2',
      '#Gallery',
    ]) {
      expect(bookingCardHidden({ hash, phase: 'open', ...grace(true) })).toBe(false);
    }
  });

  it('keeps the card when the gallery is locked, missing or failed — it holds the balance box', () => {
    expect(bookingCardHidden({ hash: '#gallery', phase: 'other', ...grace(false) })).toBe(false);
    expect(bookingCardHidden({ hash: '#gallery', phase: 'other', ...grace(true) })).toBe(false);
  });

  it('holds the card back while the gallery is still loading, to avoid a flash…', () => {
    expect(bookingCardHidden({ hash: '#gallery', phase: 'pending', ...grace(false) })).toBe(true);
  });

  it('…but never for good: a hung request gives the card back after the grace period', () => {
    expect(bookingCardHidden({ hash: '#gallery', phase: 'pending', ...grace(true) })).toBe(false);
  });

  it('never hides the card on a page opened without the gallery link, whatever the phase', () => {
    for (const phase of ['pending', 'open', 'other'] as const) {
      expect(bookingCardHidden({ hash: '', phase, ...grace(false) })).toBe(false);
    }
  });
});
