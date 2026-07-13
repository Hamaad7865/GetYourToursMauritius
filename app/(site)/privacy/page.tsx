import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const UPDATED = '22 June 2026';

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
            {SITE.legalName} (&quot;we&quot;, &quot;us&quot;) is the data controller for personal
            data collected through {SITE.name}. We handle it in line with the{' '}
            <strong>Mauritius Data Protection Act 2017</strong>, and with the EU GDPR where it
            applies to visitors in the European Economic Area.
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
          <P>
            We collect only what we need to take your booking and run your trip. Concretely, that
            is:
          </P>
          <LegalList
            items={[
              <>
                <strong>Contact details</strong> — your name, email and phone number, so we can
                confirm and run your booking.
              </>,
              <>
                <strong>Booking details</strong> — the activity, date, party size and options you
                choose, plus any <strong>pickup and drop-off location</strong> and custom itinerary
                you give us so your guide or driver can reach you.
              </>,
              <>
                <strong>Payment confirmation</strong> — the amount, currency, payment status and a
                reference from our payment provider. We do <strong>not</strong> receive or store
                your full card number.
              </>,
              <>
                <strong>Enquiries</strong> — if you send us an enquiry or contact us about an
                activity, we keep your name and the email or phone number you contacted us on, so we
                can reply and follow up.
              </>,
              <>
                <strong>Account details</strong> — creating an account is optional. If you do, we
                hold your email, an optional name and phone number, and a secured password we never
                see in plain text (handled by our authentication provider).
              </>,
              <>
                <strong>Trip planner</strong> — if you use the AI road-trip planner, your messages
                are sent to our AI provider to generate suggestions for that session. We don&apos;t
                use them to build a marketing profile of you.
              </>,
              <>
                <strong>Usage data</strong> — basic, mostly anonymous information about how the site
                is used, to keep it secure and working well.
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
            We don&apos;t sell your data. We share it only with the trusted service providers
            (&quot;processors&quot;) that help us run the platform, and only as far as each one
            needs:
          </P>
          <LegalList
            items={[
              <>
                <strong>Supabase</strong> — hosting and database for your booking, account and
                enquiry data.
              </>,
              <>
                <strong>Resend</strong> — sends your transactional email, such as booking
                confirmations, vouchers and receipts.
              </>,
              <>
                <strong>Peach Payments</strong> — processes your card payment. Your card details go
                directly to them; we only receive a confirmation.
              </>,
              <>
                <strong>Google</strong> — powers maps and location search, and the AI road-trip
                planner. Location searches and planner messages are processed by Google to return
                results.
              </>,
              <>
                <strong>Cloudflare</strong> — hosting and content delivery (CDN) that serves the
                site securely and quickly.
              </>,
              <>
                <strong>Guides, skippers and drivers</strong> who run your specific activity, with
                just the details they need to find you and deliver it.
              </>,
              <>
                <strong>Authorities or professional advisers</strong> where we are legally required
                to, or to establish or defend legal claims.
              </>,
            ]}
          />
          <P>
            Some of these providers process data outside Mauritius and the EU. Where that happens,
            we rely on appropriate safeguards — such as standard contractual clauses — so your data
            keeps a comparable level of protection. See{' '}
            <a href="#transfers">International transfers</a> below.
          </P>
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
            signed in, remember your cart, language and currency, and keep the site secure. We
            don&apos;t run third-party advertising trackers. This browser-stored data stays on your
            device and is cleared when you sign out.
          </P>
          <P>
            For the full detail of what we store in your browser and why, see our{' '}
            <Link href="/cookies">Cookie notice</Link>.
          </P>
        </LegalSection>

        <LegalSection id="retention" title="How long we keep it">
          <LegalList
            items={[
              <>
                <strong>Paid bookings</strong> — the financial records of a paid booking (invoice,
                amount, reference) are kept for the period required by Mauritius tax and accounting
                law. After that, your personal details on those records are anonymised while the
                figures we&apos;re obliged to keep remain.
              </>,
              <>
                <strong>Enquiries, draft bookings and your profile</strong> — non-essential data
                like this is kept while it&apos;s useful and is deleted when you ask us to, or when
                you delete your account.
              </>,
              <>
                <strong>Browser-stored data</strong> — your cart and preferences live on your
                device, not on our servers, and clear when you sign out.
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="rights" title="Your rights">
          <P>Subject to the applicable law, you can ask us to:</P>
          <LegalList
            items={[
              <>
                <strong>Access</strong> the personal data we hold about you, and receive a copy.
              </>,
              <>
                <strong>Rectify</strong> anything that is inaccurate or incomplete.
              </>,
              <>
                <strong>Erase</strong> your data where we no longer need it (financial records we
                are legally required to keep are anonymised rather than deleted).
              </>,
              <>
                <strong>Port</strong> your data — receive it in a portable, machine-readable format
                where that right applies.
              </>,
              <>
                <strong>Object to or restrict</strong> certain uses, and withdraw any consent you
                gave.
              </>,
            ]}
          />
          <Callout tone="info" title="How to exercise your rights">
            <P>
              <strong>If you have an account</strong>, the quickest way is the{' '}
              <Link href="/account/privacy">Data &amp; privacy</Link> section of your account. There you
              can <strong>Download my data</strong> (a copy of your profile and booking history) or{' '}
              <strong>Delete my account</strong> (which removes your personal details; paid bookings
              are anonymised for the legal reasons above).
            </P>
            <P>
              <strong>If you booked as a guest, or want to make a written request</strong>, email{' '}
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>. We aim to respond within{' '}
              <strong>30 days</strong>, and we may need to verify your identity first.
            </P>
          </Callout>
        </LegalSection>

        <LegalSection id="transfers" title="International transfers">
          <P>
            Some of our providers — including Supabase, Resend, Peach Payments, Google and
            Cloudflare — operate outside Mauritius and the EU. Where your data is transferred
            abroad, we rely on appropriate safeguards, such as{' '}
            <strong>standard contractual clauses</strong>, so it keeps a level of protection
            consistent with applicable data-protection law.
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
