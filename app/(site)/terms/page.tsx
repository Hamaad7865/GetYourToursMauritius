import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const UPDATED = '18 July 2026';

export const metadata: Metadata = {
  title: `Terms of service · ${SITE.operator}`,
  description: `The booking conditions for ${SITE.legalName} (${SITE.name}) — payments, vouchers, cancellations, your responsibilities and our liability, under the laws of Mauritius.`,
  alternates: { canonical: '/terms' },
};

const TOC = [
  { id: 'about', label: 'About these terms' },
  { id: 'who', label: 'Who we are' },
  { id: 'booking', label: 'Booking & payment' },
  { id: 'prices', label: 'Prices & currency' },
  { id: 'voucher', label: 'Vouchers & check-in' },
  { id: 'cancellations', label: 'Cancellations & refunds' },
  { id: 'changes', label: 'Changes by us' },
  { id: 'your-responsibilities', label: 'Your responsibilities' },
  { id: 'safety', label: 'Safety & health' },
  { id: 'liability', label: 'Liability' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'law', label: 'Governing law' },
  { id: 'contact', label: 'Contact' },
];

export default function TermsPage() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Terms of service"
      intro="These terms explain how booking with us works and the conditions that apply when you book an activity, transfer or rental through this platform. Please read them before you book."
      meta={`Last updated ${UPDATED} · ${SITE.legalName}`}
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="about" title="About these terms">
          <P>
            These Terms of Service (&quot;Terms&quot;) form the agreement between you and{' '}
            <strong>{SITE.legalName}</strong> when you book through {SITE.name} (the
            &quot;platform&quot;). By placing a booking you confirm you have read, understood and
            accept these Terms and our <Link href="/privacy">Privacy policy</Link>.
          </P>
        </LegalSection>

        <LegalSection id="who" title="Who we are">
          <P>
            {SITE.name} is the official booking platform of {SITE.legalName}, a tour operator based
            in Belle Mare, Mauritius. We operate or directly partner on every experience listed.
          </P>
          <LegalList
            items={[
              <>
                <strong>Company:</strong> {SITE.legalName}
              </>,
              <>
                <strong>Registered office:</strong> {SITE.street}, {SITE.region}, Mauritius
              </>,
              <>
                <strong>Business Registration Number (BRN):</strong> {SITE.brn}
              </>,
              <>
                <strong>VAT:</strong> {SITE.vat}
              </>,
              <>
                <strong>Contact:</strong> <a href={`mailto:${SITE.email}`}>{SITE.email}</a> ·{' '}
                <a href={`tel:${SITE.phone.replace(/\s+/g, '')}`}>{SITE.phone}</a>
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="booking" title="Booking & payment">
          <LegalList
            items={[
              'A booking is a request to reserve a place on an activity. It is confirmed only once payment is completed and we issue a confirmation (your e-voucher).',
              'You must be at least 18 years old to make a booking and you are responsible for the accuracy of the details you provide (names, contact details, party size and date).',
              'Payment is taken securely through our third-party payment provider. We never see or store your full card details.',
              'If a payment fails or a place sells out before your booking is confirmed, we will tell you and will not charge you.',
            ]}
          />
        </LegalSection>

        <LegalSection id="prices" title="Prices & currency">
          <LegalList
            items={[
              'Prices are shown in euro (EUR) and include applicable taxes unless stated otherwise on the activity page.',
              'The price you pay is the total shown at checkout for your selected date, party size and any add-ons.',
              'We may change listed prices at any time, but a change never affects a booking already confirmed.',
              'Your bank or card issuer may apply its own currency-conversion or transaction fees, which are outside our control.',
            ]}
          />
        </LegalSection>

        <LegalSection id="voucher" title="Vouchers & check-in">
          <P>
            After payment we send a confirmation e-voucher by email with your booking reference
            (starting <strong>BMT</strong>), the meeting point or pickup details, and the time to be
            ready. Please have it available — on your phone is fine — at check-in.
          </P>
          <P>
            Arrive or be ready for pickup at the stated time. Departures run to schedule for
            everyone on board, so we may be unable to wait for late arrivals.
          </P>
        </LegalSection>

        <LegalSection id="cancellations" title="Cancellations & refunds">
          <P>
            Most activities can be cancelled free of charge until{' '}
            <strong>9:00 AM Mauritius time on the day before</strong> your activity date. After
            that, bookings are non-refundable. The full policy, worked examples and how refunds are
            paid are on our <Link href="/refunds">Cancellations &amp; refunds</Link> page, which
            forms part of these Terms.
          </P>
        </LegalSection>

        <LegalSection id="changes" title="Changes & cancellations by us">
          <P>
            Some things are outside anyone&apos;s control. We may change, reschedule or cancel an
            activity for weather, sea or road conditions, safety, or if a minimum group size is not
            met. If we cancel, you may choose a full refund or a free reschedule (subject to
            availability). We are not responsible for separate costs you arrange, such as flights,
            accommodation or onward transfers.
          </P>
        </LegalSection>

        <LegalSection id="your-responsibilities" title="Your responsibilities">
          <LegalList
            items={[
              'Give complete, accurate booking and pickup information, and tell us promptly if it changes.',
              'Disclose any medical condition, pregnancy, mobility need or relevant non-swimmer status that could affect safe participation, so we can advise suitability.',
              'Arrive on time, behave responsibly and follow the reasonable instructions of our guides, skippers and drivers.',
              'Ensure anyone under 18 in your party is supervised by a responsible adult at all times.',
              'Respect the marine environment and local rules and customs.',
            ]}
          />
        </LegalSection>

        <LegalSection id="safety" title="Safety & health">
          <P>
            Watersports and excursions carry inherent risks. Our crews are experienced and we
            provide appropriate safety equipment and briefings, but you take part on the basis that
            you are in a fit state to do so. We may decline participation, without refund, where
            someone is visibly unwell, under the influence of alcohol or drugs, or unwilling to
            follow safety instructions.
          </P>
        </LegalSection>

        <LegalSection id="liability" title="Liability">
          <P>
            We take reasonable care to deliver your experience as described. To the extent permitted
            by law:
          </P>
          <LegalList
            items={[
              'We are not liable for loss, delay or disappointment caused by events beyond our reasonable control (weather, sea state, road conditions, strikes, acts of authorities or other force majeure).',
              'We are not responsible for goods or services you arrange through third parties.',
              'Nothing in these Terms limits or excludes liability for death or personal injury caused by our negligence, for fraud, or anything else that cannot lawfully be limited.',
              'Where we are liable, our liability is limited to the total amount you paid for the affected booking.',
            ]}
          />
          <P>
            We strongly recommend you hold suitable travel insurance covering activities,
            cancellation and personal belongings.
          </P>
        </LegalSection>

        <LegalSection id="privacy" title="Privacy">
          <P>
            We handle your personal data in line with our{' '}
            <Link href="/privacy">Privacy policy</Link> and applicable Mauritius data-protection
            law. Please read it to understand what we collect and why.
          </P>
        </LegalSection>

        <LegalSection id="law" title="Governing law">
          <P>
            These Terms are governed by the laws of the <strong>Republic of Mauritius</strong>, and
            the courts of Mauritius have jurisdiction over any dispute. If any provision is found
            unenforceable, the rest continues to apply.
          </P>
          <Callout tone="info" title="These Terms may be updated">
            We may revise these Terms from time to time. The version in force when you book is the
            one that applies to your booking. The date at the top shows when this page was last
            updated.
          </Callout>
        </LegalSection>

        <LegalSection id="contact" title="Contact">
          <P>
            Questions about these Terms? Email <a href={`mailto:${SITE.email}`}>{SITE.email}</a>,
            call <a href={`tel:${SITE.phone.replace(/\s+/g, '')}`}>{SITE.phone}</a>, or see our{' '}
            <Link href="/help">Help centre</Link>.
          </P>
          <EnquireRow message="Hi Belle Mare Tours! I have a question about your terms of service." />
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}
