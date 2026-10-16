import { describe, expect, it } from 'vitest';
import { renderCheckoutRecoveryEmail } from '@/lib/email/checkout-recovery';

const BASE = {
  customerName: 'Sam',
  activityTitle: 'Ile aux Cerfs',
  startsAt: '2026-12-20T05:00:00Z',
  bookAgainUrl: 'https://bellemaretours.com/activities/ile-aux-cerfs',
  stopUrl: 'https://bellemaretours.com/reminders/stop?t=abc',
};

describe('renderCheckoutRecoveryEmail', () => {
  it('says nothing was charged, links to the activity page and offers the stop link', () => {
    const email = renderCheckoutRecoveryEmail(BASE);
    expect(email.subject).toContain('Ile aux Cerfs');
    expect(email.text).toContain('nothing was charged');
    expect(email.text).toContain('Sunday 20 December');
    expect(email.html).toContain('href="https://bellemaretours.com/activities/ile-aux-cerfs"');
    expect(email.html).toContain('/reminders/stop?t=abc');
    expect(email.text).toContain('Mauritian rupees (MUR)');
  });

  it('renders in French for a French booking', () => {
    const email = renderCheckoutRecoveryEmail({ ...BASE, locale: 'fr' });
    expect(email.subject).toBe('Votre réservation pour Ile aux Cerfs n’a pas été finalisée');
    expect(email.text).toContain('dimanche 20 décembre');
  });

  it('drops the date from the copy when it cannot be read, and escapes HTML', () => {
    const email = renderCheckoutRecoveryEmail({
      ...BASE,
      startsAt: 'not a date',
      activityTitle: '<b>x</b>',
    });
    expect(email.text).toContain('your booking for <b>x</b> wasn’t completed');
    expect(email.html).not.toContain('<b>x</b>');
  });
});
