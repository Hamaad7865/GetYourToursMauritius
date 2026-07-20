import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

const UPDATED = '21 July 2026';

export const metadata: Metadata = {
  // absolute: the title already names the brand — stop the root "%s | Belle Mare Tours" template doubling it.
  title: { absolute: `Cancellations & refunds · ${SITE.operator}` },
  description:
    'Free cancellation until 12:00 noon Mauritius time on the day before your activity. See exactly how cancellations, refunds and reschedules work with Belle Mare Tours.',
  alternates: { canonical: '/refunds' },
};

const TOC = [
  { id: 'window', label: 'Free-cancellation window' },
  { id: 'example', label: 'A worked example' },
  { id: 'how-to-cancel', label: 'How to cancel' },
  { id: 'how-refunds-paid', label: 'How refunds are paid' },
  { id: 'we-cancel', label: 'If we cancel or change' },
  { id: 'reschedule', label: 'Changes & reschedules' },
  { id: 'non-refundable', label: 'Non-refundable cases' },
  { id: 'help', label: 'Still need a hand?' },
];

export default function RefundsPage() {
  return (
    <InfoPage
      eyebrow="Cancellations & refunds"
      title="Plans change — here's how cancellations work"
      intro="Most activities can be cancelled free of charge right up to the day before you travel. This page sets out the cut-off, how refunds are paid, and what happens if the weather or we have to change your plans."
      meta={`Last updated ${UPDATED} · ${SITE.legalName}`}
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="window" title="Free-cancellation window">
          <P>
            For most activities, you can cancel{' '}
            <strong>
              free of charge until 12:00 noon (Mauritius time, GMT+4) on the day before your
              activity date
            </strong>
            . Cancel within that window and you receive a full refund.
          </P>
          <Callout tone="danger" title="After the cut-off, the booking is non-refundable">
            From <strong>12:00 noon on the day before</strong> your activity onward — and for
            no-shows — no refund is due, because by then we have committed your boat seats, guide
            and vehicle for the day.
          </Callout>
          <P>
            A handful of experiences (private charters, multi-day trips and some third-party
            tickets) carry their own cancellation terms. Where that&apos;s the case, the difference
            is shown on the activity page and in your confirmation email before you pay.
          </P>
        </LegalSection>

        <LegalSection id="example" title="A worked example">
          <P>
            Say you book an activity for <strong>24 July</strong>:
          </P>
          <Callout tone="success" title="Cancel up to 23 July, 11:59 AM → full refund">
            Any cancellation before 12:00 noon on 23 July (the day before) is refunded in full.
          </Callout>
          <Callout tone="danger" title="Cancel from 23 July, 12:00 noon onward → no refund">
            From 12:00 noon on 23 July — or if you don&apos;t show up on 24 July — the booking is
            non-refundable.
          </Callout>
          <P>
            All times are <strong>Mauritius local time (GMT+4)</strong>. If you&apos;re booking from
            another timezone, convert to Mauritius time so you don&apos;t miss the cut-off.
          </P>
        </LegalSection>

        <LegalSection id="how-to-cancel" title="How to cancel">
          <P>To cancel before the cut-off, use whichever is quickest:</P>
          <LegalList
            items={[
              <>
                <strong>WhatsApp or call</strong> us on{' '}
                <a href={`tel:${SITE.phone.replace(/\s+/g, '')}`}>{SITE.phone}</a> with your booking
                reference (it starts with <strong>BMT</strong>).
              </>,
              <>
                <strong>Email</strong> <a href={`mailto:${SITE.email}`}>{SITE.email}</a> from the
                address you booked with.
              </>,
              <>
                Open <Link href="/account/bookings">your bookings</Link> if you have an account.
              </>,
            ]}
          />
          <P>
            Your cancellation takes effect from the time we receive it, so don&apos;t leave it to
            the last minute around the noon cut-off.
          </P>
        </LegalSection>

        <LegalSection id="how-refunds-paid" title="How refunds are paid">
          <LegalList
            items={[
              'Refunds go back to the original payment method — we can’t redirect them elsewhere.',
              'We process eligible refunds within 1–2 business days of your cancellation.',
              'Your bank or card issuer then takes a further 5–10 business days to show the money, depending on their timings.',
              'Refunds are made in the currency you paid in (EUR); we don’t cover any exchange-rate movement between payment and refund.',
            ]}
          />
        </LegalSection>

        <LegalSection id="we-cancel" title="If we cancel or change">
          <P>
            Your safety comes first. If we have to cancel for weather, sea conditions, a safety
            call, or because a minimum group size isn&apos;t met, you choose:
          </P>
          <LegalList
            items={[
              <>
                a <strong>full refund</strong>, or
              </>,
              <>
                a <strong>free reschedule</strong> to another date that suits you (subject to
                availability).
              </>,
            ]}
          />
          <P>
            If we need to make a small change to your itinerary or departure time, we&apos;ll let
            you know as early as we can. We&apos;re not able to refund costs you arrange separately
            (such as flights, hotels or other transfers).
          </P>
        </LegalSection>

        <LegalSection id="reschedule" title="Changes & reschedules">
          <P>
            Want to move your date or adjust your party size? Message us before the noon cut-off and
            we&apos;ll do our best to accommodate it, subject to availability on the new date.
            Changes requested after the cut-off are treated the same as a cancellation.
          </P>
          <P>
            Add-ons such as baby/child seats follow the same cancellation window as the activity
            they were booked with.
          </P>
        </LegalSection>

        <LegalSection id="non-refundable" title="Non-refundable cases">
          <LegalList
            items={[
              'Cancellations made from 12:00 noon on the day before the activity onward.',
              'No-shows, or arriving too late to join the departure.',
              'Experiences explicitly marked as non-refundable on the activity page.',
              'Unused portions of an activity once it has started.',
            ]}
          />
          <P>
            This policy doesn&apos;t affect any rights you may have under Mauritius consumer law.
            See our <Link href="/terms">Terms of service</Link> for the full booking conditions.
          </P>
        </LegalSection>

        <LegalSection id="help" title="Still need a hand?">
          <P>
            If anything about your booking or a refund is unclear, talk to a real person —
            we&apos;re a local team and happy to help. You&apos;ll also find quick answers in our{' '}
            <Link href="/help">Help centre</Link>.
          </P>
          <EnquireRow message="Hi Belle Mare Tours! I have a question about cancelling a booking." />
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}
