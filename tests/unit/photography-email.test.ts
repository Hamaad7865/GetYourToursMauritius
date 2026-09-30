import { describe, expect, it } from 'vitest';
import { renderGalleryReadyEmail, renderPhotoBalanceEmail } from '@/lib/email/photography';
import { SITE } from '@/lib/seo/site';

/**
 * The two photography delivery renderers. The gallery-ready one has TWO callers whose inputs must
 * stay aligned with the notify_balance_paid trigger payload (20261013000000): the admin send route
 * (no galleryUrl — the renderer builds /bookings/{ref}#gallery off SITE.url) and the notification
 * drain (galleryUrl = the RELATIVE path the trigger persisted, absolutised here). Both shapes are
 * pinned, so a payload/render drift goes red instead of mailing a broken link.
 */
const base = { ref: 'BMT-TEST-1', customerName: 'Jane Doe', packageTitle: 'Couples shoot' };

describe('renderGalleryReadyEmail', () => {
  it('builds the gallery URL off SITE.url when no galleryUrl is passed (admin send route)', () => {
    const email = renderGalleryReadyEmail({ ...base, photoCount: 3, locale: 'en' });
    expect(email.subject).toBe('Your gallery is ready — booking BMT-TEST-1');
    expect(email.html).toContain(`${SITE.url}/bookings/BMT-TEST-1#gallery`);
    expect(email.text).toContain(`${SITE.url}/bookings/BMT-TEST-1#gallery`);
    expect(email.html).toContain('3 photos');
    expect(email.html).toContain('Couples shoot');
  });

  it('absolutises the relative galleryUrl the trigger persists on the outbox payload (drain)', () => {
    const email = renderGalleryReadyEmail({
      ...base,
      photoCount: 1,
      locale: 'en',
      galleryUrl: '/bookings/BMT-TEST-1#gallery',
    });
    expect(email.text).toContain(`${SITE.url}/bookings/BMT-TEST-1#gallery`);
  });

  it('uses an absolute galleryUrl as-is', () => {
    const email = renderGalleryReadyEmail({
      ...base,
      photoCount: 2,
      locale: 'en',
      galleryUrl: 'https://files.example.com/g/BMT-TEST-1',
    });
    expect(email.text).toContain('https://files.example.com/g/BMT-TEST-1');
  });

  it('renders French and falls back to the generic package wording', () => {
    const email = renderGalleryReadyEmail({
      ref: base.ref,
      customerName: base.customerName,
      packageTitle: null,
      photoCount: 5,
      locale: 'fr',
    });
    expect(email.subject).toBe('Votre galerie est prête — réservation BMT-TEST-1');
    expect(email.html).toContain('votre séance photo');
    expect(email.html).toContain('Voir ma galerie');
  });

  it('refuses to render for an empty gallery', () => {
    expect(() => renderGalleryReadyEmail({ ...base, photoCount: 0, locale: 'en' })).toThrow(
      /no gallery photos/,
    );
  });
});

describe('renderPhotoBalanceEmail', () => {
  it('refuses a zero balance — there is nothing to collect', () => {
    expect(() =>
      renderPhotoBalanceEmail({
        ...base,
        currency: 'EUR',
        balanceDueMinor: 0,
        locale: 'en',
      }),
    ).toThrow(/no balance/);
  });

  it('renders French with the amount and the booking-page link', () => {
    const email = renderPhotoBalanceEmail({
      ...base,
      currency: 'EUR',
      balanceDueMinor: 7500,
      locale: 'fr',
    });
    expect(email.subject).toBe('Vos photos sont prêtes — solde de la réservation BMT-TEST-1');
    expect(email.html).toContain('EUR 75.00');
    expect(email.text).toContain(`${SITE.url}/bookings/BMT-TEST-1`);
  });
});
