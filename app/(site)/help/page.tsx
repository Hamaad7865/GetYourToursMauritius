import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, Faq, FaqItem } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  // absolute: the title already names the brand — without this the root "%s | Belle Mare Tours"
  // template would append it a second time.
  title: { absolute: `Help centre · ${SITE.operator}` },
  description: `Answers about booking, payment, pickups, vouchers, cancellations and your account with ${SITE.operator} — plus how to reach our local team in Mauritius.`,
  alternates: { canonical: '/help' },
};

export default async function HelpPage() {
  const t = await getT();
  const TOC = [
    { id: 'booking-payment', label: t('Booking & payment') },
    { id: 'before-you-go', label: t('Before your trip') },
    { id: 'cancellations', label: t('Cancellations & changes') },
    { id: 'vouchers', label: t('Vouchers & confirmation') },
    { id: 'account', label: t('Account & login') },
    { id: 'contact', label: t('Contact us') },
  ];

  return (
    <InfoPage
      eyebrow={t('Help centre')}
      title={t('How can we help?')}
      intro={t(
        "Quick answers to the questions we get most. Can't find what you need? We're a local team in Belle Mare and a message away.",
      )}
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="booking-payment" title={t('Booking & payment')}>
          <Faq>
            <FaqItem q={t('How do I book an activity?')}>
              {t(
                'Pick your activity, choose a date and party size, then go through checkout. Your place is confirmed once payment is complete and we email your e-voucher. You can',
              )}{' '}
              <Link href="/activities">{t('browse all activities')}</Link> {t('to get started.')}
            </FaqItem>
            <FaqItem q={t('What payment methods can I use?')}>
              {t(
                'You pay securely by card at checkout. Prices are shown in euro (EUR); your card is charged the equivalent in Mauritian rupees (MUR) at the rate applied at checkout — the exact amount is shown before you enter your card details. Your card details go straight to our payment provider — we never see or store them.',
              )}
            </FaqItem>
            <FaqItem q={t('When am I charged?')}>
              {t(
                "Payment is taken at the time of booking to confirm your place. If a payment fails or a place sells out before your booking is confirmed, you're not charged.",
              )}
            </FaqItem>
            <FaqItem q={t('Do I need an account to book?')}>
              {t(
                'An account makes it easy to see your bookings, but you can complete most bookings by providing just your name, email and phone number.',
              )}
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="before-you-go" title={t('Before your trip')}>
          <Faq>
            <FaqItem q={t('Where and when do I meet?')}>
              {t(
                'Your e-voucher shows the meeting point or pickup details and the time to be ready. If pickup is included, be ready a few minutes early at the location you gave us.',
              )}
            </FaqItem>
            <FaqItem q={t('Do you offer hotel pickup?')}>
              {t(
                "Many activities include pickup across the island — it's shown on the activity page. Add your hotel or address at checkout, or message us if you're unsure whether your location is covered.",
              )}
            </FaqItem>
            <FaqItem q={t('What should I bring?')}>
              {t(
                'For water activities: swimwear, a towel, reef-safe sunscreen, a hat and water. Bring your booking reference (on your phone is fine). Specific items are noted on the activity page.',
              )}
            </FaqItem>
            <FaqItem q={t('Can children join? Are baby seats available?')}>
              {t(
                'Most activities welcome families. Where car seats are relevant, the first baby/child seat is free and any extra seats are a small add-on — choose them when you book.',
              )}
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="cancellations" title={t('Cancellations & changes')}>
          <Faq>
            <FaqItem q={t('What is your cancellation policy?')}>
              {t('Most activities can be cancelled free of charge until')}{' '}
              <strong>{t('12:00 noon Mauritius time on the day before')}</strong>{' '}
              {t(
                "your activity date; after that they're non-refundable. Full details and examples are on our",
              )}{' '}
              <Link href="/refunds">{t('Cancellations & refunds')}</Link> {t('page.')}
            </FaqItem>
            <FaqItem q={t('How do I cancel or change my booking?')}>
              {t('Message us on WhatsApp, call')}{' '}
              <a href={`tel:${SITE.phone.replace(/\s+/g, '')}`}>{SITE.phone}</a>, {t('or email')}{' '}
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a> {t('with your')}{' '}
              <strong>BMT</strong>{' '}
              {t(
                'reference, before the cut-off. Changes are subject to availability on the new date.',
              )}
            </FaqItem>
            <FaqItem q={t('What if you cancel because of the weather?')}>
              {t(
                'Your safety comes first. If we cancel for weather, sea conditions or safety, you choose a full refund or a free reschedule to another date.',
              )}
            </FaqItem>
            <FaqItem q={t('How long does a refund take?')}>
              {t(
                'We process eligible refunds within 1–2 business days to your original payment method; your bank then takes a further 5–10 business days to show it.',
              )}
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="vouchers" title={t('Vouchers & confirmation')}>
          <Faq>
            <FaqItem q={t('I haven’t received my confirmation email')}>
              {t(
                "Check your spam or promotions folder first. If it's still missing after a few minutes, message us with the name and date you booked under and we'll resend it.",
              )}
            </FaqItem>
            <FaqItem q={t('Do I need to print my voucher?')}>
              {t('No — showing it on your phone at check-in is perfectly fine.')}
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="account" title={t('Account & login')}>
          <Faq>
            <FaqItem q={t('How do I see my bookings?')}>
              {t('Sign in and open')} <Link href="/account/bookings">{t('your bookings')}</Link>{' '}
              {t('to see upcoming and past trips.')}
            </FaqItem>
            <FaqItem q={t('I’ve forgotten my password')}>
              {t('Use the "forgot password" option on the sign-in screen to reset it by email.')}
            </FaqItem>
          </Faq>
        </LegalSection>

        <LegalSection id="contact" title={t('Contact us')}>
          <P>
            {t('Still stuck, or want a tailored recommendation? Talk to our local team directly —')}{' '}
            {t("we're happy to help plan your day. You can also read our")}{' '}
            <Link href="/terms">{t('Terms of service')}</Link> {t('and')}{' '}
            <Link href="/privacy">{t('Privacy policy')}</Link>.
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
