import type { Metadata } from 'next';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const UPDATED = '18 July 2026';

export const metadata: Metadata = {
  title: `Privacy policy · ${SITE.operator}`,
  description: `How ${SITE.legalName} collects, uses and protects your personal data when you book through ${SITE.name}, and the rights you have under Mauritius and EU data-protection law.`,
  alternates: { canonical: '/privacy' },
};

const TOC = [
  { id: 'controller', label: 'Who controls your data' },
  { id: 'collect', label: 'What we collect' },
  { id: 'use', label: 'How we use it' },
  { id: 'legal-bases', label: 'Legal bases' },
  { id: 'sharing', label: 'Who we share it with' },
  { id: 'payments', label: 'Payment data' },
  { id: 'cookies', label: 'Cookies & storage' },
  { id: 'retention', label: 'How long we keep it' },
  { id: 'rights', label: 'Your rights' },
  { id: 'transfers', label: 'International transfers' },
  { id: 'children', label: 'Children' },
  { id: 'contact', label: 'Contact & complaints' },
];

export default function PrivacyPage() {
  return (
    <InfoPage
      eyebrow="Legal"
      title="Privacy policy"
      intro="We only collect what we need to take your booking and run your trip, and we never sell your data. This page explains what we hold, why, and the control you have over it."
      meta={`Last updated ${UPDATED} · ${SITE.legalName}`}
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="controller" title="Who controls your data">
          <P>
            {SITE.legalName} (&quot;we&quot;, &quot;us&quot;) is the data controller for personal data
            collected through {SITE.name}. We handle it in line with the{' '}
            <strong>Mauritius Data Protection Act 2017</strong>, and with the EU GDPR where it applies
            to visitors in the European Economic Area.
          </P>
          <LegalList
            items={[
              <>
                <strong>Controller:</strong> {SITE.legalName} (BRN {SITE.brn})
              </>,
              <>
                <strong>Address:</strong> {SITE.street}, {SITE.region}, Mauritius
              </>,
              <>
                <strong>Contact:</strong> <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="collect" title="What we collect">
          <LegalList
            items={[
              <>
                <strong>Booking details</strong> — the activity, date, party size, options and any
                pickup location or itinerary you choose.
              </>,
              <>
                <strong>Contact details</strong> — your name, email and phone number, so we can
                confirm and run your booking.
              </>,
              <>
                <strong>Account details</strong> — if you create an account, your email and a secured
                password (we never see it in plain text), handled by our authentication provider.
              </>,
              <>
                <strong>Payment confirmation</strong> — the amount, currency and a reference from our
                payment provider. We do <strong>not</strong> receive or store your full card number.
              </>,
              <>
                <strong>Usage data</strong> — basic, mostly anonymous information about how the site is
                used, to keep it secure and working well.
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="use" title="How we use it">
          <LegalList
            items={[
              'Take, confirm and run your booking, and send your e-voucher and trip information.',
              'Provide customer support and handle cancellations, reschedules and refunds.',
              'Keep records we are required to keep (for example, accounting and tax).',
              'Keep the platform secure and prevent fraud or abuse.',
              'Improve our activities and website. We do not use your data for automated decisions that affect you.',
            ]}
          />
        </LegalSection>

        <LegalSection id="legal-bases" title="Legal bases">
          <P>Depending on the purpose, we rely on one of these legal bases:</P>
          <LegalList
            items={[
              <>
                <strong>Contract</strong> — to take and deliver the booking you ask for.
              </>,
              <>
                <strong>Legal obligation</strong> — to meet accounting, tax and regulatory duties.
              </>,
              <>
                <strong>Legitimate interests</strong> — to secure the platform, prevent fraud and
                improve our service, balanced against your privacy.
              </>,
              <>
                <strong>Consent</strong> — for anything optional; you can withdraw it at any time.
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="sharing" title="Who we share it with">
          <P>
            We don&apos;t sell your data. We share it only with the trusted providers that help us run
            the service, and only as far as needed:
          </P>
          <LegalList
            items={[
              'Our payment provider, to process your payment securely.',
              'Our hosting, database and email providers, to operate the platform and send confirmations.',
              'Guides, skippers and drivers who run your specific activity, with just the details they need to deliver it.',
              'Authorities or advisers where we are legally required to, or to protect our rights.',
            ]}
          />
        </LegalSection>

        <LegalSection id="payments" title="Payment data">
          <Callout tone="info" title="We don’t handle your card details">
            Card payments are processed by a third-party, PCI-DSS-compliant payment provider. Your
            card data goes directly to them — we only receive a confirmation that the payment
            succeeded, the amount and a reference.
          </Callout>
        </LegalSection>

        <LegalSection id="cookies" title="Cookies & storage">
          <P>
            We keep this light. We use essential cookies and similar browser storage to keep you
            signed in, remember your cart and keep the site secure. We default to declining
            non-essential cookies and we don&apos;t run third-party advertising trackers.
          </P>
        </LegalSection>

        <LegalSection id="retention" title="How long we keep it">
          <P>
            We keep booking and account data for as long as you have an account or an active booking
            with us, and afterwards only as long as needed for legal, accounting and dispute purposes
            (typically up to the period required by Mauritius law). We then delete or anonymise it.
          </P>
        </LegalSection>

        <LegalSection id="rights" title="Your rights">
          <P>Subject to the applicable law, you can ask us to:</P>
          <LegalList
            items={[
              'Access the personal data we hold about you, and receive a copy.',
              'Correct anything that is inaccurate or incomplete.',
              'Delete your data where we no longer need it.',
              'Restrict or object to certain uses, and withdraw any consent you gave.',
              'Receive your data in a portable format where that right applies.',
            ]}
          />
          <P>
            To exercise any of these, email{' '}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>. We&apos;ll respond within the time the
            law allows, and we may need to verify your identity first.
          </P>
        </LegalSection>

        <LegalSection id="transfers" title="International transfers">
          <P>
            Some of our providers operate outside Mauritius. Where your data is transferred abroad, we
            take steps to ensure it stays protected to a standard consistent with applicable
            data-protection law.
          </P>
        </LegalSection>

        <LegalSection id="children" title="Children">
          <P>
            The platform is intended for adults. We don&apos;t knowingly collect data from children
            under 18 except as part of a booking made by a supervising adult. If you believe a child
            has given us data directly, contact us and we&apos;ll remove it.
          </P>
        </LegalSection>

        <LegalSection id="contact" title="Contact & complaints">
          <P>
            For any privacy question or request, contact{' '}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>. If you&apos;re not satisfied with our
            response, you have the right to complain to the{' '}
            <strong>Data Protection Office of Mauritius</strong> (or, in the EEA, your local
            supervisory authority).
          </P>
          <EnquireRow message="Hi Belle Mare Tours! I have a question about my privacy / data." />
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}
