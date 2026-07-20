'use client';

import { useCallback, useEffect, useState } from 'react';
import { useT, usePreferences } from '@/components/site/PreferencesProvider';
import { formatLocaleDate } from '@/lib/i18n/format';
import { whatsappUrl } from '@/lib/seo/site';
import {
  pickRescheduleDates,
  rescheduleAvailabilityUrl,
  RESCHEDULE_PAGE_SIZE,
  type AvailabilitySlot,
  type RescheduleDate,
} from '@/lib/booking/reschedule-dates';

/** Completes "…because of {reason}". Keys mirror the SQL check constraint on disruption.reason. */
const REASON_COPY: Record<string, string> = {
  weather: 'the weather',
  sea_conditions: 'the sea conditions',
  safety: 'a safety call',
  min_group: 'too few travellers on the day',
};

export interface DisruptionBannerBooking {
  ref: string;
  serviceDate?: string | null;
  activitySlug?: string | null;
  activityOptionId?: string | null;
  /** Booking UNITS (sum of quantity) — what a replacement date needs room for. Not the headcount. */
  unitsNeeded?: number | null;
  disruption?: { reason?: string | null; resolvedAt?: string | null } | null;
  items?: Array<{ occurrenceId?: string | null }>;
}

/**
 * Shown when WE called a guest's departure off and they have not yet chosen. Both arms are free and
 * deliberately given equal visual weight — the published policy is that the guest chooses, so nudging
 * them toward the cheaper-for-us option would be dishonest.
 *
 * Replacement dates are a LIST, not a calendar: a guest picking a new date wants to see their options,
 * and a list sidesteps the popover offset-parent trap that the booking widget's calendar lives with.
 */
export function DisruptionBanner({
  booking,
  accessToken,
  onResolved,
}: {
  booking: DisruptionBannerBooking;
  accessToken: string;
  onResolved: () => Promise<unknown> | void;
}) {
  const t = useT();
  const { language } = usePreferences();

  const [mode, setMode] = useState<'idle' | 'dates' | 'confirmRefund'>('idle');
  const [dates, setDates] = useState<RescheduleDate[] | null>(null);
  const [datesError, setDatesError] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const slug = booking.activitySlug ?? null;
  const currentOccurrence = booking.items?.[0]?.occurrenceId ?? null;

  // Load replacement dates on demand — a guest who takes the refund never pays for this fetch.
  useEffect(() => {
    if (mode !== 'dates' || dates !== null || !slug) return;
    let active = true;
    setLoadingDates(true);
    setDatesError(false);
    fetch(rescheduleAvailabilityUrl(slug, new Date()))
      .then((r) => r.json())
      .then((body: { ok?: boolean; data?: AvailabilitySlot[] }) => {
        if (!active) return;
        if (!body?.ok || !Array.isArray(body.data)) {
          setDatesError(true);
          setDates([]);
          return;
        }
        setDates(
          pickRescheduleDates(body.data, {
            activityOptionId: booking.activityOptionId,
            unitsNeeded: booking.unitsNeeded ?? 1,
            excludeOccurrenceId: currentOccurrence,
          }),
        );
      })
      .catch(() => {
        if (!active) return;
        // Distinguish "couldn't load" from "genuinely nothing free" — never show a lying empty state.
        setDatesError(true);
        setDates([]);
      })
      .finally(() => {
        if (active) setLoadingDates(false);
      });
    return () => {
      active = false;
    };
  }, [mode, dates, slug, booking.activityOptionId, booking.unitsNeeded, currentOccurrence]);

  const post = useCallback(
    async (path: string, body: unknown, fallback: string): Promise<boolean> => {
      setError(null);
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${accessToken}`,
            ...(body ? { 'content-type': 'application/json' } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!res.ok) {
          let msg = fallback;
          try {
            const parsed = (await res.json()) as { error?: { message?: string } };
            if (parsed?.error?.message) msg = parsed.error.message;
          } catch {
            /* non-JSON — keep the generic message */
          }
          throw new Error(msg);
        }
        await onResolved(); // the server is the authority — refetch rather than guessing
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : fallback);
        return false;
      }
    },
    [accessToken, onResolved],
  );

  const move = useCallback(
    async (occurrenceId: string) => {
      setBusy(occurrenceId);
      await post(
        `/api/v1/bookings/${booking.ref}/reschedule`,
        { occurrenceId },
        t('Could not move your booking. Please try again.'),
      );
      setBusy(null);
    },
    [booking.ref, post, t],
  );

  const refund = useCallback(async () => {
    setBusy('refund');
    await post(
      `/api/v1/bookings/${booking.ref}/cancel`,
      null,
      t('Could not start your refund. Please try again.'),
    );
    setBusy(null);
  }, [booking.ref, post, t]);

  const when = booking.serviceDate ? formatLocaleDate(booking.serviceDate, language) : null;
  const reason = REASON_COPY[booking.disruption?.reason ?? 'weather'] ?? t('the conditions');
  const visible = dates && !showAll ? dates.slice(0, RESCHEDULE_PAGE_SIZE) : (dates ?? []);

  return (
    <section
      role="group"
      aria-label={t('Your trip was called off — choose what happens next')}
      className="mb-5 rounded-2xl border border-coral/30 bg-coral/[0.06] p-4 sm:p-5"
    >
      <h2 className="font-display text-lg font-semibold text-ink">
        {when
          ? t('Your trip on {date} has been called off', { date: when })
          : t('Your trip has been called off')}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-ink/80">
        {t(
          "We're sorry — we called it off because of {reason}, and we don't make that decision lightly.",
          { reason },
        )}{' '}
        {t('What happens next is your choice, and both options are free.')}
      </p>

      {mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setMode('dates')}
            className="rounded-full bg-teal px-5 py-2.5 text-[13px] font-bold text-white hover:bg-teal-dark"
          >
            {t('Move to another date')}
          </button>
          <button
            type="button"
            onClick={() => setMode('confirmRefund')}
            className="rounded-full border border-ink/20 px-5 py-2.5 text-[13px] font-bold text-ink hover:bg-ink/5"
          >
            {t('Get a full refund')}
          </button>
        </div>
      )}

      {mode === 'dates' && (
        <div className="mt-4">
          <p className="text-[13px] font-bold text-ink">{t('Pick a new date')}</p>
          {loadingDates && (
            <p className="mt-2 text-[13px] text-ink-muted" aria-live="polite">
              {t('Loading available dates…')}
            </p>
          )}
          {!loadingDates && datesError && (
            <p className="mt-2 text-[13px] text-coral" role="alert">
              {t("We couldn't load the available dates.")}{' '}
              <button
                type="button"
                onClick={() => setDates(null)}
                className="font-bold underline underline-offset-2"
              >
                {t('Try again')}
              </button>
            </p>
          )}
          {!loadingDates && !datesError && dates?.length === 0 && (
            // Honest dead-end: nothing free with room for the whole party. Hand them to a human
            // rather than leaving them staring at an empty list.
            <p className="mt-2 text-[13px] text-ink/75">
              {t('No dates with room for your whole party in the next few months.')}{' '}
              <a
                href={whatsappUrl(
                  t('Hi Belle Mare Tours! My trip {ref} was called off — can we find a new date?', {
                    ref: booking.ref,
                  }),
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="font-bold text-teal underline underline-offset-2"
              >
                {t('Message us')}
              </a>{' '}
              {t('and we’ll sort something out, or take the refund below.')}
            </p>
          )}
          {visible.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {visible.map((d) => (
                <li key={d.occurrenceId}>
                  <button
                    type="button"
                    disabled={busy != null}
                    aria-busy={busy === d.occurrenceId}
                    onClick={() => void move(d.occurrenceId)}
                    className="flex w-full items-center justify-between gap-3 rounded-xl border border-ink/15 bg-white px-4 py-3 text-left text-sm hover:border-teal/50 hover:bg-teal/5 disabled:opacity-60"
                  >
                    <span className="font-bold text-ink">
                      {formatLocaleDate(d.startsAt, language, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                    <span className="shrink-0 text-[12px] text-ink-muted">
                      {busy === d.occurrenceId
                        ? t('Moving…')
                        : t('{n} seats left', { n: d.seatsLeft })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {dates && dates.length > RESCHEDULE_PAGE_SIZE && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="mt-2 text-[13px] font-bold text-teal underline underline-offset-2"
            >
              {t('Show more dates ({n})', { n: dates.length - RESCHEDULE_PAGE_SIZE })}
            </button>
          )}
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => setMode('confirmRefund')}
              className="text-[13px] font-bold text-ink/70 underline underline-offset-2 hover:text-ink"
            >
              {t('I’d rather have a refund')}
            </button>
          </div>
        </div>
      )}

      {mode === 'confirmRefund' && (
        <div className="mt-4 rounded-xl border border-ink/15 bg-white p-4">
          <p className="text-sm text-ink">
            {t(
              'Refund booking {ref} in full? Your money goes back to the card you paid with, usually within a few days.',
              { ref: booking.ref },
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={busy != null}
              aria-busy={busy === 'refund'}
              onClick={() => void refund()}
              className="rounded-full bg-coral px-4 py-2 text-[13px] font-bold text-white hover:bg-coral/90 disabled:opacity-60"
            >
              {busy === 'refund' ? t('Refunding…') : t('Yes, refund me in full')}
            </button>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => setMode('dates')}
              className="rounded-full border border-ink/20 px-4 py-2 text-[13px] font-bold text-ink hover:bg-ink/5 disabled:opacity-60"
            >
              {t('Show me dates instead')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}
    </section>
  );
}
