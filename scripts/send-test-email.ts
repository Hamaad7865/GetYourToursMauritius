/**
 * One-shot Resend verification — sends a REAL sample booking-confirmation email (branded HTML +
 * the invoice/receipt PDF attachment) through the app's actual render pipeline, so you can confirm
 * Resend is configured correctly before launch.
 *
 *   1. Put RESEND_API_KEY + RESEND_FROM in `.env.local` (RESEND_FROM must use a domain you've
 *      verified in Resend, e.g. `Belle Mare Tours <bookings@bellemaretours.com>`).
 *   2. Run:  npm run email:test -- you@example.com
 *
 * It reads `.env.local` at runtime and NEVER prints the API key. Nothing is sent until you run it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildInvoice } from '../src/lib/invoice/model';
import { renderInvoicePdf } from '../src/lib/invoice/pdf';
import { renderConfirmationEmail } from '../src/lib/email/booking-confirmation';
import { ResendNotificationProvider } from '../src/lib/notifications/resend';
import { SITE } from '../src/lib/seo/site';

/** Minimal .env.local reader (the repo has no dotenv dep; mirrors the peach-probe scripts). */
function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw = '';
  try {
    raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  } catch {
    return out;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1];
    if (key === undefined) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[key] = v;
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return Buffer.from(binary, 'binary').toString('base64');
}

async function main() {
  const recipient = process.argv[2];
  if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    console.error('Usage: npm run email:test -- recipient@example.com');
    process.exit(1);
  }

  const env = { ...readEnvLocal(), ...process.env };
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!apiKey || !from) {
    console.error(
      'Missing RESEND_API_KEY and/or RESEND_FROM in .env.local — see .env.example lines 82-86.',
    );
    console.error('RESEND_FROM must use a domain verified in your Resend dashboard.');
    process.exit(1);
  }

  const business = {
    legalName: SITE.legalName,
    brn: SITE.brn,
    vat: SITE.vat,
    street: SITE.street,
    locality: SITE.locality,
    region: SITE.region,
    country: SITE.country,
    email: SITE.email,
    phone: SITE.phone,
  };
  const model = buildInvoice(
    {
      ref: 'BMT-TEST01',
      customerName: 'Test Customer',
      customerEmail: recipient,
      currency: 'EUR',
      totalEur: 191,
      activityTitle: 'Deep Sea Fishing — Full Day',
      when: '2026-08-09T06:30:00Z',
      pickupLocation: 'Le Touessrok Resort, Trou d’Eau Douce',
      dropoffLocation: null,
      childSeats: 2,
      transportEur: 30,
      items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 155 }],
    },
    {
      chargedAmountMinor: 20700,
      chargedCurrency: 'USD',
      paidAt: '2026-06-20T10:15:00Z',
      providerRef: 'test_ref',
    },
    business,
  );

  const email = renderConfirmationEmail(model);
  const pdf = await renderInvoicePdf(model);

  const provider = new ResendNotificationProvider({ apiKey, from });
  console.log(`Sending a test invoice+receipt email…`);
  console.log(`  from:    ${from}`);
  console.log(`  to:      ${recipient}`);
  console.log(`  subject: ${email.subject}`);
  console.log(`  pdf:     invoice-${model.invoiceNumber}.pdf (${pdf.length} bytes)`);

  await provider.send({
    id: 'test',
    channel: 'email',
    recipient,
    template: 'booking_confirmation',
    payload: {
      ref: model.invoiceNumber,
      customerName: model.customer.name,
      totalMinor: 19100,
      currency: 'EUR',
    },
    subject: email.subject,
    text: email.text,
    html: email.html,
    attachments: [
      {
        filename: `invoice-${model.invoiceNumber}.pdf`,
        content: bytesToBase64(pdf),
        contentType: 'application/pdf',
      },
    ],
  });

  console.log(
    '\n✓ Resend accepted the email. Check the inbox (and the Resend dashboard → Emails).',
  );
}

main().catch((err) => {
  console.error('\n✗ Send failed:', err instanceof Error ? err.message : err);
  console.error(
    'Common causes: unverified RESEND_FROM domain, wrong API key, or the from-address not on a verified domain.',
  );
  process.exit(1);
});
