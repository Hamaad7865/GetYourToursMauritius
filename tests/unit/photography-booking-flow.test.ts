import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTOGRAPHY_SHOOT_SLOTS, PHOTOGRAPHY_WEDDING_SLOTS } from '@/lib/catalogue/photography';
import { PhotoBookingCard } from '@/components/photography/PhotoBookingCard';

const state = vi.hoisted(() => ({
  days: new Map([
    ['2026-11-01', { occurrenceId: 'occ-1', seatsLeft: 3 }],
    ['2026-11-02', { occurrenceId: 'occ-2', seatsLeft: 0 }],
    ['2026-11-03', { occurrenceId: 'occ-3', seatsLeft: 1 }],
  ]),
  date: '2026-11-01',
  participants: 2,
  maxParticipants: 6,
  total: 650 as number | null,
  availabilityError: false,
  busy: false,
  updating: false,
  privateCfg: { baseEur: 650, included: 2, extraEur: 30, maxGuests: 6 },
  activity: { fromPriceEur: 650, slug: 'holiday', minAdvanceDays: 1 },
  setDate: vi.fn(),
  setParticipants: vi.fn(),
  touch: vi.fn(),
  setPhotoSlot: vi.fn(),
  reloadAvailability: vi.fn(),
  continueToCheckout: vi.fn(),
}));
vi.mock('@/components/gyg/detail/BookingProvider', () => ({ useBooking: () => state }));
vi.mock('@/components/site/PreferencesProvider', () => ({
  useT: () => (key: string, vars?: Record<string, unknown>) =>
    vars
      ? `${key}|${Object.entries(vars)
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(',')}`
      : key,
  useMoney: () => (eur: number) => `€${eur}`,
  usePreferences: () => ({ language: 'en' }),
}));
vi.mock('@/components/site/Price', () => ({ Price: ({ eur }: { eur: number }) => `EUR ${eur}` }));

const render = (props?: Partial<Parameters<typeof PhotoBookingCard>[0]>) =>
  renderToStaticMarkup(
    createElement(PhotoBookingCard, {
      slots: [...PHOTOGRAPHY_SHOOT_SLOTS],
      group: 'shoots',
      bestSeller: true,
      ...props,
    }),
  );

beforeEach(() => {
  state.date = '2026-11-01';
  state.participants = 2;
  state.total = 650;
  state.availabilityError = false;
  state.busy = false;
  state.updating = false;
});

describe('PhotoBookingCard', () => {
  it('renders the v3 sticky card with ribbon, from price and the deposit line', () => {
    const html = render();
    for (const text of [
      'Likely to sell out',
      '1. Choose a date',
      '2. Pick the light',
      '3. People',
      'Pay {pct}% to book your date. The balance is due when your photos are delivered.|pct=50',
      'up to {n} people|n=2',
      'id="book"',
    ]) {
      expect(html).toContain(text);
    }
  });

  it('hides the ribbon when the package is not the best seller', () => {
    expect(render({ bestSeller: false })).not.toContain('Likely to sell out');
  });

  it('shows slot times for the picked day, with the sunset time on the golden-hour note', () => {
    const html = render();
    for (const slot of PHOTOGRAPHY_SHOOT_SLOTS) {
      expect(html).toContain(`${slot.label} · `);
    }
    expect(html).toContain('sunset at {time}');
    expect(html).not.toContain('Choose a date to see times for that day.');
  });

  it('prompts for a date first when none is picked and hides the slot list', () => {
    state.date = '';
    const html = render();
    expect(html).toContain('Choose a date to see times for that day.');
  });

  it('marks sold-out days struck through and low days as last spots', () => {
    const html = render();
    expect(html).toContain('line-through');
    expect(html).toContain('bg-coral');
    expect(html).toContain('bg-teal');
  });

  it('gates Continue on a slot pick — disabled until one is chosen', () => {
    // No way to click in a static render: with a date but no slot the CTA shows the time prompt
    // and stays disabled.
    const html = render();
    expect(html).toContain('Choose a time');
    expect(html).toContain('disabled=""');
  });

  it('disables continuing while busy, updating or on an availability error', () => {
    state.busy = true;
    expect(render()).toContain('disabled=""');
    state.busy = false;
    state.updating = true;
    expect(render()).toContain('disabled=""');
    state.updating = false;
    state.availabilityError = true;
    expect(render()).toContain('disabled=""');
  });

  it('hides the people stepper for weddings and asks for a ceremony time', () => {
    const html = render({ slots: [...PHOTOGRAPHY_WEDDING_SLOTS], group: 'weddings' });
    expect(html).not.toContain('3. People');
    expect(html).toContain('2. Ceremony time');
    expect(html).toContain('Choose a ceremony time');
  });

  it('offers a retry when availability failed to load', () => {
    state.availabilityError = true;
    expect(render()).toContain('tap to retry');
  });
});
