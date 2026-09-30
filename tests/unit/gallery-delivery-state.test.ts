import { describe, expect, it } from 'vitest';
import { galleryDeliveryState } from '@/lib/admin/photography';

/**
 * Where a gallery is in the studio's delivery flow — what the admin card shows and which press is
 * next. The two facts that decide it are the studio's confirmation (galleryReadyAt) and the live
 * balance; the interesting rows are the ones where they disagree with the happy path.
 */
const STAMP = '2026-10-14T09:00:00.000Z';

describe('galleryDeliveryState', () => {
  it('is empty until something is uploaded, whatever else is true', () => {
    expect(
      galleryDeliveryState({ photoCount: 0, galleryReadyAt: null, balanceDueMinor: 5000 }),
    ).toBe('empty');
    expect(galleryDeliveryState({ photoCount: 0, galleryReadyAt: STAMP, balanceDueMinor: 0 })).toBe(
      'empty',
    );
  });

  it('is a draft while photos are up but unconfirmed and the balance is owed', () => {
    expect(
      galleryDeliveryState({ photoCount: 12, galleryReadyAt: null, balanceDueMinor: 5000 }),
    ).toBe('draft');
  });

  it('flags a guest who paid BEFORE the studio confirmed — they are waiting on the press', () => {
    expect(galleryDeliveryState({ photoCount: 12, galleryReadyAt: null, balanceDueMinor: 0 })).toBe(
      'paid_unconfirmed',
    );
  });

  it('awaits the balance once confirmed with a balance owed', () => {
    expect(
      galleryDeliveryState({ photoCount: 12, galleryReadyAt: STAMP, balanceDueMinor: 5000 }),
    ).toBe('awaiting_balance');
  });

  it('is delivered once confirmed and paid in full', () => {
    expect(
      galleryDeliveryState({ photoCount: 12, galleryReadyAt: STAMP, balanceDueMinor: 0 }),
    ).toBe('delivered');
  });
});
