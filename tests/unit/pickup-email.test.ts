import { describe, expect, it } from 'vitest';
import { renderPickupConfirmedEmail, renderPickupReminderEmail } from '@/lib/email/pickup';
import { shouldKeepPollingPickup } from '@/lib/checkout/confirm-poll';

/**
 * The late-pickup guest emails and the poll that waits for the supplement to settle.
 *
 * Both emails are sent off-request — the reminder by a cron sweep 48h/24h out, the confirmation from
 * the webhook thread — so the guest's STORED booking locale is the only correct language source. And
 * the pickup poll is the piece the status poll cannot cover: its booking is already confirmed.
 */

const BOOKING_URL = 'https://bellemaretours.com/bookings/BMT1042';

describe('pickup reminder email', () => {
  it('escalates its wording at the 24h threshold', () => {
    const two = renderPickupReminderEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      bookingUrl: BOOKING_URL,
      hoursBefore: 48,
    });
    const one = renderPickupReminderEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      bookingUrl: BOOKING_URL,
      hoursBefore: 24,
    });
    expect(two.subject).not.toContain('Tomorrow');
    expect(one.subject).toContain('Tomorrow');
    expect(one.text).toContain('tomorrow');
  });

  it('always carries the link that fixes the problem', () => {
    const email = renderPickupReminderEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      bookingUrl: BOOKING_URL,
      hoursBefore: 48,
    });
    expect(email.html).toContain(BOOKING_URL);
    expect(email.text).toContain(BOOKING_URL);
  });

  it('renders in the guest’s booking locale, not the sender’s', () => {
    const fr = renderPickupReminderEmail({
      customerName: 'Ada',
      activityTitle: 'Croisière en catamaran',
      bookingUrl: BOOKING_URL,
      hoursBefore: 48,
      locale: 'fr',
    });
    expect(fr.subject).toContain('Où devons-nous vous récupérer');
    expect(fr.html).toContain('Ajouter votre prise en charge');
  });

  it('falls back to English for an unrecognised locale rather than throwing', () => {
    const email = renderPickupReminderEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      bookingUrl: BOOKING_URL,
      hoursBefore: 48,
      locale: 'klingon',
    });
    expect(email.subject).toContain('Where should we collect you');
  });
});

describe('pickup confirmed email', () => {
  it('states the address verbatim and the supplement actually charged', () => {
    const email = renderPickupConfirmedEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      pickupLocation: 'Le Morne Beach Villa',
      bookingUrl: BOOKING_URL,
      feeEur: 50,
    });
    expect(email.html).toContain('Le Morne Beach Villa');
    expect(email.text).toContain('Le Morne Beach Villa');
    expect(email.text).toContain('50.00');
  });

  it('says nothing about a supplement when none was charged', () => {
    const email = renderPickupConfirmedEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      pickupLocation: 'Grand Baie',
      bookingUrl: BOOKING_URL,
      feeEur: 0,
    });
    expect(email.text).not.toContain('supplement');
    expect(email.html).not.toContain('Transport supplement paid');
  });

  it('escapes a hostile address rather than letting it inject markup', () => {
    const email = renderPickupConfirmedEmail({
      customerName: 'Ada',
      activityTitle: 'Catamaran Cruise',
      pickupLocation: '<script>alert(1)</script>',
      bookingUrl: BOOKING_URL,
      feeEur: 0,
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });
});

describe('shouldKeepPollingPickup', () => {
  it('keeps polling while the supplement has not settled', () => {
    expect(shouldKeepPollingPickup({ pendingPickup: true, elapsedMs: 1_000, maxMs: 90_000 })).toBe(
      true,
    );
  });

  it('stops the moment the pickup is applied', () => {
    expect(shouldKeepPollingPickup({ pendingPickup: false, elapsedMs: 1_000, maxMs: 90_000 })).toBe(
      false,
    );
  });

  it('stops when the window elapses, so it can never spin forever', () => {
    expect(shouldKeepPollingPickup({ pendingPickup: true, elapsedMs: 90_000, maxMs: 90_000 })).toBe(
      false,
    );
  });
});
