import { describe, expect, it } from 'vitest';
import { buildInvoice } from '@/lib/invoice/model';
import { renderConfirmationEmail } from '@/lib/email/booking-confirmation';

/**
 * `renderConfirmationEmail` is a PURE renderer: an InvoiceModel (from buildInvoice) -> a branded,
 * inline-styled HTML confirmation email + a plain-text fallback. The invoice/receipt PDF is attached
 * separately (Task 6), so this module only renders the message body.
 *
 * It MUST escape every interpolated dynamic value (customer name, activity title, line descriptions,
 * pickup/dropoff) so a hostile string can never inject markup into the HTML.
 */
const business = {
  legalName: 'Belle Mare Tours Ltd',
  brn: 'C09091906',
  vat: '20529965',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  email: 'hello@getyourtoursmauritius.com',
  phone: '+230 5772 9919',
};

function representativeModel() {
  return buildInvoice(
    {
      ref: 'BMT-1042',
      customerName: 'Jean Dupont',
      customerEmail: 'jean@example.com',
      currency: 'EUR',
      totalEur: 191,
      activityTitle: 'Catamaran Cruise to Île aux Cerfs',
      when: '2026-08-09T06:00:00Z',
      pickupLocation: 'Le Touessrok Resort',
      dropoffLocation: 'Trou d’Eau Douce jetty',
      childSeats: 2, // first free + 1 extra @ €6 = €6 child-seat line
      transportEur: 30,
      items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 155 }],
    },
    { chargedAmountMinor: 20700, chargedCurrency: 'USD', paidAt: '2026-06-20T10:00:00Z', providerRef: 'pe_123' },
    business,
  );
}

describe('renderConfirmationEmail', () => {
  it('puts the booking ref (invoice number) in the subject', () => {
    const { subject } = renderConfirmationEmail(representativeModel());
    expect(subject).toContain('BMT-1042');
  });

  it('renders the ref, activity, total, every line, and the business legalName in the html', () => {
    const model = representativeModel();
    const { html } = renderConfirmationEmail(model);

    expect(html).toContain('BMT-1042');
    expect(html).toContain('Catamaran Cruise to');
    // total formatted as `{currency} {total}`
    expect(html).toContain('EUR 191.00');
    expect(html).toContain('Belle Mare Tours Ltd');

    // every line description appears (escaped)
    expect(html).toContain('Door-to-door transport');
    expect(html).toContain('Child seats (2)');
    // the item line "Catamaran Cruise to Île aux Cerfs — Adult" (Adult tier appears)
    expect(html).toContain('Adult');
  });

  it('escapes hostile markup in dynamic values (no raw <script> in the html)', () => {
    const model = buildInvoice(
      {
        ref: 'BMT-2000',
        customerName: '<script>alert(1)</script> & "friends" <Bob>',
        customerEmail: 'x@x.com',
        currency: 'EUR',
        totalEur: 115,
        activityTitle: 'Trip <script>steal()</script> & <b>more</b>',
        when: '2026-08-09T06:00:00Z',
        pickupLocation: null,
        dropoffLocation: null,
        childSeats: 0,
        transportEur: 0,
        items: [{ priceLabel: 'Adult & "VIP"', quantity: 1, pax: null, subtotalEur: 115 }],
      },
      { chargedAmountMinor: 12500, chargedCurrency: 'USD', paidAt: '2026-06-20T10:00:00Z' },
      business,
    );

    const { html } = renderConfirmationEmail(model);

    // no raw, executable script tag survives
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    // the dangerous chars are entity-encoded instead
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('returns a non-empty plain-text fallback containing the ref and total', () => {
    const { text } = renderConfirmationEmail(representativeModel());
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain('BMT-1042');
    expect(text).toContain('EUR 191.00');
  });
});
