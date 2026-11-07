'use client';

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import Link from '@/components/site/LocaleLink';
import { useAuth } from '@/components/auth/AuthProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { ResumePaymentButton } from '@/components/checkout/ResumePaymentButton';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { useWhatsAppNumber } from '@/components/site/WhatsAppNumberProvider';
import { useZilAiOptional } from '@/components/planner/assistant/ZilAiProvider';
import { opensInPlace } from '@/components/planner/assistant/open-in-place';
import { formatTripDate } from '@/lib/i18n/format';
import { whatsappUrl } from '@/lib/seo/site';
import { responsiveImage } from '@/lib/images/resize';
import { bookingProgress, type ProgressStep } from '@/lib/booking/booking-progress';
import { isAwaitingDisruptionChoice, wasRescheduled } from '@/lib/booking/reschedule-dates';
import { balanceIsOutstanding } from '@/lib/quotes/deposit';
import { Price } from '@/components/site/Price';
import { IconCalendar, IconCheck, IconUsers } from '@/components/ui/icons';
import { AccountPanel, SignedOutPrompt, AccountSpinner } from './AccountChrome';

interface BookingItem {
  price_label: string;
  quantity: number;
  /** People on board for a vehicle booking (there quantity is the vehicle count = 1); null otherwise. */
  pax: number | null;
  session_occurrences: {
    starts_at: string | null;
    activity_options: {
      activities: {
        title: string | null;
        slug: string | null;
        /** Readable only while the activity is published (RLS), so it can come back empty. */
        activity_images: { url: string; alt: string | null; position: number }[] | null;
      } | null;
    } | null;
  } | null;
}

export interface BookingRow {
  ref: string;
  status: string;
  payment_state: string;
  total_minor: number;
  /** The deposit taken (a partial deposit is 0 < deposit_minor < total_minor); 0 for a full charge. */
  deposit_minor: number;
  balance_due_minor: number;
  currency: string;
  created_at: string;
  /** Set only when WE called the departure off; a null resolvedAt means the guest still owes a choice. */
  disruption: { resolvedAt?: string | null; resolution?: string | null } | null;
  booking_items: BookingItem[];
  /** Custom/quote lines (a converted quote's lines live HERE, not in booking_items). Used for the card
   *  title and so a custom-only booking doesn't read as "0 guests". */
  booking_custom_items: { description: string; quantity: number }[];
}

const STATUS_TONE: Record<string, { pill: string; dot: string }> = {
  confirmed: { pill: 'border-teal/20 bg-teal/10 text-teal-dark', dot: 'bg-teal' },
  completed: { pill: 'border-teal/20 bg-teal/10 text-teal-dark', dot: 'bg-teal' },
  payment_pending: { pill: 'border-gold/30 bg-gold-light/20 text-ink', dot: 'bg-gold' },
  held: { pill: 'border-gold/30 bg-gold-light/20 text-ink', dot: 'bg-gold' },
  refund_pending: { pill: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  refunded: { pill: 'border-ink/10 bg-ink/5 text-ink-muted', dot: 'bg-ink-muted' },
  cancelled: { pill: 'border-coral/20 bg-coral/10 text-coral-dark', dot: 'bg-coral' },
  expired: { pill: 'border-coral/20 bg-coral/10 text-coral-dark', dot: 'bg-coral' },
  failed: { pill: 'border-coral/20 bg-coral/10 text-coral-dark', dot: 'bg-coral' },
};
const NEUTRAL_TONE = { pill: 'border-ink/10 bg-ink/5 text-ink-muted', dot: 'bg-ink-muted' };

const CANCELLED = new Set(['cancelled', 'expired', 'refunded', 'refund_pending', 'failed']);

/** The card's photo column: ~176px wide from sm, full width above the text on a phone. */
const CARD_PHOTO = { sizes: '(min-width: 640px) 176px, 92vw', widths: [400, 800] } as const;

const BUTTON_PRIMARY =
  'inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-teal-dark disabled:opacity-60';
const BUTTON_SECONDARY =
  'inline-flex items-center justify-center rounded-full border border-ink/15 bg-white px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-ink/30 hover:bg-ink/5';
const BUTTON_LINK =
  'text-[13px] font-bold text-teal-dark underline underline-offset-2 hover:text-ink';

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Earliest trip date across a booking's items, or null if none is known. */
function tripDate(b: BookingRow): Date | null {
  const times = b.booking_items
    .map((i) => i.session_occurrences?.starts_at)
    .filter((s): s is string => !!s)
    .map((s) => new Date(s).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

function tripActivity(b: BookingRow) {
  for (const i of b.booking_items) {
    const a = i.session_occurrences?.activity_options?.activities;
    if (a?.title) return a;
  }
  return null;
}

function tripTitle(b: BookingRow): string | null {
  const activity = tripActivity(b);
  if (activity?.title) return activity.title;
  // A converted quote has no booking_items — its lines are custom, so name the card from the first
  // custom line rather than falling all the way back to the bare ref.
  const custom = b.booking_custom_items?.find((c) => c.description?.trim());
  return custom?.description?.trim() ?? null;
}

function tripPhoto(b: BookingRow): { url: string; alt: string | null } | null {
  const images = tripActivity(b)?.activity_images ?? [];
  const first = [...images].sort((x, y) => x.position - y.position)[0];
  return first ? { url: first.url, alt: first.alt } : null;
}

function BookingCard({ b, isPast }: { b: BookingRow; isPast: boolean }) {
  const t = useT();
  const { language } = usePreferences();
  const waNumber = useWhatsAppNumber();
  // Vehicle bookings store the headcount in pax (quantity is the vehicle count = 1); fall back to
  // quantity for per-person/per-group lines — same as the admin manifest's coalesce(pax, quantity).
  const guests = b.booking_items.reduce((sum, i) => sum + (i.pax ?? i.quantity), 0);
  // A genuine PARTIAL deposit (0 < deposit < total): only then does the guest pay a fraction now, and
  // the card should say so — otherwise a small deposit (e.g. a €0.10 deposit on a €1 quote → MUR ~5)
  // reads like a broken exchange rate.
  const isPartialDeposit = b.deposit_minor > 0 && b.deposit_minor < b.total_minor;
  // Money that ARRIVED and left a remainder — never merely "not fully paid" (see balanceIsOutstanding).
  const balanceOwed = balanceIsOutstanding({
    deposit: b.deposit_minor,
    balanceDue: b.balance_due_minor,
    total: b.total_minor,
  });
  const date = tripDate(b);
  const when = formatTripDate(date ?? b.created_at, language);
  const title = tripTitle(b);
  const photo = tripPhoto(b);
  const slug = tripActivity(b)?.slug ?? null;
  const tone = STATUS_TONE[b.status] ?? NEUTRAL_TONE;
  // An unpaid booking (e.g. the customer abandoned the payment step or returned later) needs a working
  // way to pay. ResumePaymentButton mints a fresh checkout session and lands on /pay?cid=… — without it
  // the bookings list offered no pay affordance at all and the email "Complete payment" link was dead.
  const awaitingPayment = b.status === 'payment_pending' && b.payment_state !== 'paid';
  // We called this departure off and the guest still owes us a choice — the one card that needs them.
  const awaitingChoice = b.status === 'confirmed' && isAwaitingDisruptionChoice(b.disruption);
  const moved = wasRescheduled(b.disruption);
  const steps = bookingProgress({ status: b.status, isPast, depositOnly: balanceOwed });
  const detailsHref = `/bookings/${b.ref}`;

  // What the figure means. Deliberately no "to be refunded": a deposit booking refunds only what was
  // paid, and the total is not that figure.
  const priceNote =
    (b.status === 'confirmed' || b.status === 'completed') &&
    b.payment_state === 'paid' &&
    !balanceOwed
      ? t('Paid')
      : awaitingPayment
        ? t('To pay')
        : t('Total');

  return (
    <li className="overflow-hidden rounded-2xl border border-ink/10 bg-white transition-shadow hover:shadow-[0_16px_34px_-24px_rgba(10,46,54,0.5)] sm:flex">
      <div className="relative h-32 shrink-0 bg-teal-tint sm:h-auto sm:w-44">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- responsive Supabase/CDN srcset, as on the tour cards
          <img
            {...responsiveImage(photo.url, CARD_PHOTO)}
            alt={photo.alt ?? title ?? ''}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <PhotoFallback />
        )}
      </div>

      <div className="min-w-0 flex-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${tone.pill}`}
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                {t(statusLabel(b.status))}
              </span>
              {awaitingChoice && (
                <span className="inline-flex items-center rounded-full border border-coral/30 bg-coral/10 px-2.5 py-0.5 text-[11.5px] font-bold text-coral-dark">
                  {t('Action needed')}
                </span>
              )}
              {moved && !awaitingChoice && (
                <span className="inline-flex items-center gap-1 rounded-full border border-teal/20 bg-teal-tint px-2.5 py-0.5 text-[11.5px] font-bold text-teal-dark">
                  <IconCheck width={12} height={12} aria-hidden />
                  {t('New date')}
                </span>
              )}
            </div>
            <h3 className="mt-2 font-display text-lg font-bold leading-snug text-ink">
              {title ?? b.ref}
            </h3>
          </div>
          <div className="shrink-0 text-right">
            <div className="font-display text-xl font-extrabold text-ink sm:text-[22px]">
              <Price eur={b.total_minor / 100} />
            </div>
            <div className="text-[11.5px] text-ink-muted">{priceNote}</div>
          </div>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-ink/80">
          <span className="inline-flex items-center gap-1.5">
            <IconCalendar width={15} height={15} aria-hidden className="text-ink-muted" />
            {when}
          </span>
          {/* Only per-person lines have a headcount — a custom/quote line does not, so don't say
              "0 guests" for one. */}
          {guests > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <IconUsers width={15} height={15} aria-hidden className="text-ink-muted" />
              {guests} {guests === 1 ? t('guest') : t('guests')}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className="font-mono text-[12px] tracking-wide text-ink-muted">{b.ref}</span>
            <CopyRef value={b.ref} />
          </span>
        </div>

        {awaitingChoice && (
          <p className="mt-3 rounded-xl border border-coral/25 bg-coral/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink/85">
            {t('We called this trip off. Choose a new date or a full refund — both are free.')}
          </p>
        )}

        {awaitingPayment && isPartialDeposit && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-teal-dark">
            {t('Deposit due now:')} <Price eur={b.deposit_minor / 100} /> · {t('Total:')}{' '}
            <Price eur={b.total_minor / 100} />
          </p>
        )}

        {balanceOwed && b.status === 'confirmed' && (
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink/80">
            {t('Balance still to pay')}{' '}
            <span className="font-bold text-ink">
              <Price eur={b.balance_due_minor / 100} />
            </span>
          </p>
        )}

        {steps && !awaitingChoice && <Tracker steps={steps} />}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2.5">
          {awaitingPayment ? (
            <>
              <ResumePaymentButton
                bookingRef={b.ref}
                label={t('Pay now')}
                depositMinor={b.deposit_minor}
                totalMinor={b.total_minor}
                className={BUTTON_PRIMARY}
              />
              <Link href={detailsHref} className={BUTTON_SECONDARY}>
                {t('View details')}
              </Link>
            </>
          ) : awaitingChoice ? (
            <Link href={detailsHref} className={BUTTON_PRIMARY}>
              {t('Choose a new date or refund')}
            </Link>
          ) : isPast || CANCELLED.has(b.status) ? (
            <>
              {slug && (
                <Link href={`/activities/${slug}`} className={BUTTON_PRIMARY}>
                  {t('Book again')}
                </Link>
              )}
              <Link href={detailsHref} className={slug ? BUTTON_SECONDARY : BUTTON_PRIMARY}>
                {t('View details')}
              </Link>
              {b.status === 'refund_pending' && (
                <a
                  href={whatsappUrl(
                    t(
                      'Hi Belle Mare Tours! Could I have an update on the refund for booking {ref}?',
                      {
                        ref: b.ref,
                      },
                    ),
                    waNumber,
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={BUTTON_LINK}
                >
                  {t('Ask about this refund')}
                </a>
              )}
            </>
          ) : (
            <>
              <Link href={detailsHref} className={BUTTON_PRIMARY}>
                {t('View details')}
              </Link>
              <a
                href={whatsappUrl(
                  t('Hi Belle Mare Tours! I have a question about my booking {ref}.', {
                    ref: b.ref,
                  }),
                  waNumber,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className={BUTTON_LINK}
              >
                {t('Ask a question')}
              </a>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/** Where the booking is, as three steps: ticked, in progress (gold), or still to come (dashed). */
function Tracker({ steps }: { steps: ProgressStep[] }) {
  const t = useT();
  const stateText = { done: t('done'), current: t('in progress'), todo: t('not yet') } as const;
  return (
    <ol className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-[#F4F6F7] px-3 py-2.5">
      {steps.map((s) => (
        <li
          key={s.label}
          aria-current={s.state === 'current' ? 'step' : undefined}
          // A phone's third of a card is ~90px: dot above label there, side by side from sm.
          className="flex min-w-0 flex-col items-start gap-1.5 text-[12px] leading-tight sm:flex-row sm:items-center sm:gap-2"
        >
          {s.state === 'done' ? (
            <span
              aria-hidden
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-dark text-white"
            >
              <IconCheck width={12} height={12} />
            </span>
          ) : s.state === 'current' ? (
            <span
              aria-hidden
              className="h-5 w-5 shrink-0 rounded-full bg-gold-light ring-4 ring-gold-light/20"
            />
          ) : (
            <span
              aria-hidden
              className="h-5 w-5 shrink-0 rounded-full border border-dashed border-ink/30"
            />
          )}
          <span className={s.state === 'todo' ? 'text-ink-muted' : 'font-semibold text-ink'}>
            {t(s.label)}
            <span className="sr-only"> ({stateText[s.state]})</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function CopyRef({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => {
            /* clipboard refused (permissions, http) — the ref is still on screen to copy by hand */
          });
      }}
      aria-label={copied ? t('Copied') : t('Copy reference {ref}', { ref: value })}
      title={copied ? t('Copied') : t('Copy reference')}
      className="grid h-7 w-7 place-items-center rounded-lg border border-ink/10 text-ink-muted transition hover:border-ink/25 hover:text-ink"
    >
      {copied ? (
        <IconCheck width={14} height={14} aria-hidden className="text-teal-dark" />
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="8" y="8" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      )}
    </button>
  );
}

/** No photo to show (none uploaded, or the activity is no longer published): a calm sea-and-sun tile. */
function PhotoFallback() {
  return (
    <svg
      viewBox="0 0 160 120"
      fill="none"
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <circle cx="104" cy="44" r="14" className="fill-gold-light/80" />
      <path
        d="M0 78c13-7 27-7 40 0s27 7 40 0 27-7 40 0 27 7 40 0"
        className="stroke-teal/60"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M0 92c13-7 27-7 40 0s27 7 40 0 27-7 40 0 27 7 40 0"
        className="stroke-teal/30"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PalmArt() {
  return (
    <svg viewBox="0 0 120 96" fill="none" aria-hidden className="h-24 w-28 shrink-0">
      <circle cx="80" cy="26" r="12" className="fill-gold-light" />
      <path
        d="M56 80c1-17 3-31 10-46"
        className="stroke-teal-dark"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path d="M66 34C52 24 36 26 26 36c14-4 28-4 40-2z" className="fill-teal-dark" />
      <path d="M66 34C58 20 46 14 34 16c12 6 22 12 32 18z" className="fill-teal-dark" />
      <path d="M66 34c6-14 18-18 30-14-12 4-22 8-30 14z" className="fill-teal-dark" />
      <path d="M66 34c14-6 28-2 34 10-12-6-22-8-34-10z" className="fill-teal-dark" />
      <path
        d="M10 84c10-5 20-5 30 0s20 5 30 0 20-5 30 0"
        className="stroke-teal"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M28 92c10-5 20-5 30 0s20 5 30 0"
        className="stroke-teal/40"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** "Plan a day with AI": opens the assistant in place, or follows the link to the planner page. */
function PlanDayLink() {
  const t = useT();
  const assistant = useZilAiOptional();
  return (
    <Link
      href="/ai-road-trip-planner"
      onClick={(e: MouseEvent) => {
        if (!assistant?.available || !opensInPlace(e)) return;
        e.preventDefault();
        assistant.openAssistant();
      }}
      onPointerEnter={assistant?.preload}
      onFocus={assistant?.preload}
      className={BUTTON_SECONDARY}
    >
      {t('Plan a day with AI')}
    </Link>
  );
}

function EmptyUpcoming() {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl bg-teal-tint px-6 py-8 text-center sm:flex-row sm:gap-8 sm:px-10 sm:text-left">
      <PalmArt />
      <div>
        <h3 className="font-display text-xl font-bold text-ink">
          {t('Your next island day is waiting')}
        </h3>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-muted">
          {t(
            'No trips coming up. Once you book an activity, tour or transfer, it’ll show up here with everything you need on the day.',
          )}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2.5 sm:justify-start">
          <Link
            href="/activities"
            className="inline-flex items-center justify-center rounded-full bg-teal-dark px-5 py-2.5 text-[13px] font-bold text-white transition hover:bg-ink"
          >
            {t('Explore activities')}
          </Link>
          <PlanDayLink />
        </div>
      </div>
    </div>
  );
}

function BookingsSection({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id}>
      <AccountPanel>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={id} className="font-display text-xl font-bold text-ink">
            {title}
          </h2>
          <span className="rounded-full bg-[#F4F6F7] px-2.5 py-1 text-[11.5px] font-semibold text-ink-muted">
            {count}
          </span>
        </div>
        {children}
      </AccountPanel>
    </section>
  );
}

export function AccountBookings() {
  const t = useT();
  // `session`, not `user`: this is the one account screen a guest can use. Their bookings are theirs.
  const { session, loading: authLoading } = useAuth();
  const ownerId = session?.user.id ?? null;
  const [bookings, setBookings] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerId) return;
    let active = true;
    (async () => {
      const { data, error } = await getBrowserSupabase()
        .from('bookings')
        .select(
          'ref, status, payment_state, total_minor, deposit_minor, balance_due_minor, currency, created_at, disruption, booking_items(price_label, quantity, pax, session_occurrences(starts_at, activity_options(activities(title, slug, activity_images(url, alt, position))))), booking_custom_items(description, quantity)',
        )
        // Filter to the SIGNED-IN user's OWN bookings explicitly. For a customer this just matches RLS;
        // for a staff/admin it stops "My bookings" (a personal view) from listing every booking in the
        // system via the staff RLS branch — that belongs on the admin screen, not here.
        .eq('user_id', ownerId)
        .order('created_at', { ascending: false })
        .returns<BookingRow[]>();
      if (!active) return;
      if (error) {
        setError(error.message);
        // Still render both sections (with empty states) rather than collapsing to a bare error.
        setBookings([]);
      } else {
        setBookings(data ?? []);
      }
    })();
    return () => {
      active = false;
    };
  }, [ownerId]);

  if (authLoading) return <AccountSpinner />;
  if (!session) return <SignedOutPrompt message={t('Sign in to see your booking history.')} />;
  return <BookingsView bookings={bookings} error={error} />;
}

/** The two sections, from rows already loaded — split from the fetch so it renders without a session. */
export function BookingsView({
  bookings,
  error,
}: {
  bookings: BookingRow[] | null;
  error: string | null;
}) {
  const t = useT();
  if (bookings === null && !error) return <AccountSpinner />;

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const upcoming: { b: BookingRow; at: number }[] = [];
  const past: { b: BookingRow; at: number }[] = [];
  for (const b of bookings ?? []) {
    // Fall back to the booking date when the trip date is unknown (e.g. a since-unpublished
    // activity whose occurrence is no longer readable), so old bookings still bucket as past.
    const date = tripDate(b) ?? new Date(b.created_at);
    const isPast = date < startOfToday;
    if (CANCELLED.has(b.status) || isPast) past.push({ b, at: date.getTime() });
    else upcoming.push({ b, at: date.getTime() });
  }
  // Soonest trip first; the most recent past trip first.
  upcoming.sort((x, y) => x.at - y.at);
  past.sort((x, y) => y.at - x.at);

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-coral/25 bg-white px-4 py-3 text-[13px] font-medium text-coral-dark"
        >
          {error}
        </p>
      )}

      <BookingsSection
        id="upcoming-bookings"
        title={t('Upcoming')}
        count={upcoming.length === 1 ? t('1 trip') : t('{n} trips', { n: upcoming.length })}
      >
        {upcoming.length === 0 ? (
          <EmptyUpcoming />
        ) : (
          <ul className="flex flex-col gap-4">
            {upcoming.map(({ b }) => (
              <BookingCard key={b.ref} b={b} isPast={false} />
            ))}
          </ul>
        )}
      </BookingsSection>

      <BookingsSection
        id="past-bookings"
        title={t('Past & cancelled')}
        count={past.length === 1 ? t('1 booking') : t('{n} bookings', { n: past.length })}
      >
        {past.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('You don’t have any past bookings.')}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {past.map(({ b, at }) => (
              <BookingCard key={b.ref} b={b} isPast={at < startOfToday.getTime()} />
            ))}
          </ul>
        )}
      </BookingsSection>
    </div>
  );
}
