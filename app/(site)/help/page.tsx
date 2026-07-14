import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, Faq, FaqItem } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  // absolute: the title already names the brand — without this the root "%s | Belle Mare Tours"
  // template would append it a second time.
  title: { absolute: `Help centre · ${SITE.operator}` },
  description: `Answers about booking, payment, pickups, vouchers, cancellations and your account with ${SITE.operator} — plus how to reach our local team in Mauritius.`,
  alternates: { canonical: '/help' },
};

const TOC = [
  { id: 'booking-payment', label: 'Booking & payment' },
  { id: 'before-you-go', label: 'Before your trip' },
  { id: 'cancellations', label: 'Cancellations & changes' },
  { id: 'vouchers', label: 'Vouchers & confirmation' },
  { id: 'account', label: 'Account & login' },
  { id: 'contact', label: 'Contact us' },
];

export default function HelpPage() {
  return (
    <InfoPage
      eyebrow="Help centre"
      title="How can we help?"
      intro="Quick answers to the questions we get most. Can't find what you need? We're a local team in Belle Mare and a message away."
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="booking-payment" title="Booking & payment">
          <Faq>
            <FaqItem q="How do I book an activity?">
              Pick your activity, choose a date and party size, then go through checkout. Your place
              is confirmed once payment is complete and we email your e-voucher. You can{' '}
              <Link href="/activities">browse all activities</Link> to get started.
            </FaqItem>
            <FaqItem q="What payment methods can I use?">
              You pay securely by card at checkout. Prices are shown and charged in euro (EUR). Your
              card details go straight to our payment provider — we never see or store them.
            </FaqItem>
            <FaqItem q="When am I charged?">
              Payment is taken at the time of booking to confirm your place. If a payment fails or a
              place sells out before your booking is confirmed, you&apos;re not charged.
            </FaqItem>
            <FaqItem q="Do I need an account to book?">
              An account makes it easy to see your bookings, but you can complete most bookings by
              providing just your name, email and phone number.
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="before-you-go" title="Before your trip">
          <Faq>
            <FaqItem q="Where and when do I meet?">
              Your e-voucher shows the meeting point or pickup details and the time to be ready. If
              pickup is included, be ready a few minutes early at the location you gave us.
            </FaqItem>
            <FaqItem q="Do you offer hotel pickup?">
              Many activities include pickup across the island — it&apos;s shown on the activity
              page. Add your hotel or address at checkout, or message us if you&apos;re unsure
              whether your location is covered.
            </FaqItem>
            <FaqItem q="What should I bring?">
              For water activities: swimwear, a towel, reef-safe sunscreen, a hat and water. Bring
              your booking reference (on your phone is fine). Specific items are noted on the
              activity page.
            </FaqItem>
            <FaqItem q="Can children join? Are baby seats available?">
              Most activities welcome families. Where car seats are relevant, the first baby/child
              seat is free and any extra seats are a small add-on — choose them when you book.
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="cancellations" title="Cancellations & changes">
          <Faq>
            <FaqItem q="What is your cancellation policy?">
              Most activities can be cancelled free of charge until{' '}
              <strong>9:00 AM Mauritius time on the day before</strong> your activity date; after
              that they&apos;re non-refundable. Full details and examples are on our{' '}
              <Link href="/refunds">Cancellations &amp; refunds</Link> page.
            </FaqItem>
            <FaqItem q="How do I cancel or change my booking?">
              Message us on WhatsApp, call{' '}
              <a href={`tel:${SITE.phone.replace(/\s+/g, '')}`}>{SITE.phone}</a>, or email{' '}
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a> with your <strong>BMT</strong>{' '}
              reference, before the cut-off. Changes are subject to availability on the new date.
            </FaqItem>
            <FaqItem q="What if you cancel because of the weather?">
              Your safety comes first. If we cancel for weather, sea conditions or safety, you
              choose a full refund or a free reschedule to another date.
            </FaqItem>
            <FaqItem q="How long does a refund take?">
              We process eligible refunds within 1–2 business days to your original payment method;
              your bank then takes a further 5–10 business days to show it.
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="vouchers" title="Vouchers & confirmation">
          <Faq>
            <FaqItem q="I haven’t received my confirmation email">
              Check your spam or promotions folder first. If it&apos;s still missing after a few
              minutes, message us with the name and date you booked under and we&apos;ll resend it.
            </FaqItem>
            <FaqItem q="Do I need to print my voucher?">
              No — showing it on your phone at check-in is perfectly fine.
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="account" title="Account & login">
          <Faq>
            <FaqItem q="How do I see my bookings?">
              Sign in and open <Link href="/account/bookings">your bookings</Link> to see upcoming
              and past trips.
            </FaqItem>
            <FaqItem q="I’ve forgotten my password">
              Use the &quot;forgot password&quot; option on the sign-in screen to reset it by email.
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="contact" title="Contact us">
          <P>
            Still stuck, or want a tailored recommendation? Talk to our local team directly —
            we&apos;re happy to help plan your day. You can also read our{' '}
            <Link href="/terms">Terms of service</Link> and{' '}
            <Link href="/privacy">Privacy policy</Link>.
          </P>
          <EnquireRow message="Hi Belle Mare Tours! I have a question and need a hand." />
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/help', DEFAULT_METADATA);
}
