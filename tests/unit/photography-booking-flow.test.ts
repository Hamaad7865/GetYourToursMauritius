import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotographyBooking } from '@/components/photography/PhotographyBooking';

const state = vi.hoisted(() => ({
  checkoutParams: new URLSearchParams('occ=occurrence&slug=holiday&total=650'),
  seatsLeft: 1,
  total: 650 as number | null,
  availabilityError: false,
  updating: false,
  busy: false,
  date: '2026-11-01',
  supplementSel: {},
  activity: {
    slug: 'holiday',
    supplements: [{ id: 'drone', name: 'Drone aerials', priceEur: 120 }],
  },
  setSupplementQty: vi.fn(),
  continueToCheckout: vi.fn(),
}));
vi.mock('@/components/gyg/detail/BookingProvider', () => ({ useBooking: () => state }));
vi.mock('@/components/gyg/detail/BookingWidget', () => ({
  BookingWidget: ({ hideAction }: { hideAction: boolean }) =>
    hideAction ? 'Date picker' : 'Check availability',
}));
vi.mock('@/components/gyg/detail/OptionSelector', () => ({ OptionSelector: () => null }));
vi.mock('@/components/site/PreferencesProvider', () => ({ useT: () => (key: string) => key }));
vi.mock('@/components/site/Price', () => ({ Price: ({ eur }: { eur: number }) => `EUR ${eur}` }));

const render = () => renderToStaticMarkup(createElement(PhotographyBooking));
beforeEach(() => {
  state.checkoutParams = new URLSearchParams('occ=occurrence&slug=holiday&total=650');
  state.seatsLeft = 1;
  state.availabilityError = false;
  state.updating = false;
  state.busy = false;
});

describe('photography booking flow', () => {
  it('starts with date and extras and continues to the existing stepped checkout', () => {
    const html = render();
    for (const text of [
      'Date picker',
      'Drone aerials',
      'Continue to details',
      'Booking steps',
      'Back to package',
      'aria-current="step"',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('Check availability');
    expect(html).not.toContain('Full name');
    expect(html).not.toContain('disabled=""');
  });

  it.each(['no date', 'sold out', 'failed availability', 'updating', 'busy'])(
    'disables continuing while %s',
    (reason) => {
      if (reason === 'no date') state.checkoutParams.delete('occ');
      if (reason === 'sold out') state.seatsLeft = 0;
      if (reason === 'failed availability') state.availabilityError = true;
      if (reason === 'updating') state.updating = true;
      if (reason === 'busy') state.busy = true;
      expect(render()).toContain('disabled=""');
    },
  );
});
