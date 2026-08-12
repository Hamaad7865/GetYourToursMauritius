'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDialog } from '@/lib/a11y/useDialog';
import { BTN_GHOST, BTN_PRIMARY, Field, INPUT_CLS, SELECT_CLS } from '@/components/admin/ui';
import { IconX } from '@/components/ui/icons';
import { DatePicker } from '@/components/ui/DatePicker';
import { fmtDate, fmtTime, mauDay } from '@/lib/admin/format';
import {
  loadActivityDepartures,
  loadQuotableActivities,
  type QuotableActivity,
  type QuoteDeparture,
} from '@/lib/admin/quote-catalogue';
import {
  eurFromMinor,
  refusalMessage,
  tourLineDrafts,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';

/**
 * "Add tour": activity -> date -> departure -> party, priced from the catalogue.
 *
 * The order is the order the operator thinks in, and each step narrows the next: the tours are
 * listed once, the day decides which departures exist, and the departure decides which price tiers
 * a party can be counted in. The tiers are the ONLY prices offered here — `(option, price_label)` is
 * the key the pay route re-prices the finished line against, so a price typed at this stage would be
 * a line that cannot be paid for. Overriding a price is done afterwards, on the line itself, where
 * the editor can say what it costs (the line stops holding a seat — see `state.ts`).
 *
 * A departure whose option cannot become a catalogue line is shown and DISABLED with the reason,
 * rather than hidden: "the tour I want is not in the list" is not a fixable problem, "this option is
 * private, quote it as a custom line" is.
 */
export function TourPicker({
  onAdd,
  onClose,
}: {
  onAdd: (lines: QuoteLineDraft[]) => void;
  onClose: () => void;
}) {
  const dialogRef = useDialog(true, onClose);
  const [activities, setActivities] = useState<QuotableActivity[] | null>(null);
  const [activityId, setActivityId] = useState('');
  const [day, setDay] = useState(() => mauDay(new Date()));
  const [departures, setDepartures] = useState<QuoteDeparture[] | null>(null);
  const [occurrenceId, setOccurrenceId] = useState('');
  const [party, setParty] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadQuotableActivities()
      .then(setActivities)
      .catch((err: unknown) => {
        setActivities([]);
        setError(refusalMessage(err, 'Could not load the tours.'));
      });
  }, []);

  // Re-read whenever either half of "which departures" changes. `cancelled` guards the race: two
  // day clicks in quick succession must not let the first answer overwrite the second.
  useEffect(() => {
    if (!activityId || !day) {
      setDepartures(null);
      return;
    }
    let cancelled = false;
    setDepartures(null);
    setOccurrenceId('');
    setParty({});
    loadActivityDepartures(activityId, day)
      .then((rows) => {
        if (!cancelled) setDepartures(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDepartures([]);
        setError(refusalMessage(err, 'Could not load the departures for that day.'));
      });
    return () => {
      cancelled = true;
    };
  }, [activityId, day]);

  const activity = activities?.find((a) => a.id === activityId) ?? null;
  const departure = departures?.find((d) => d.occurrenceId === occurrenceId) ?? null;

  const total = useMemo(() => {
    if (!departure) return 0;
    return departure.tiers.reduce((sum, tier) => {
      const quantity = Number(party[tier.label] ?? '0');
      return sum + (Number.isInteger(quantity) && quantity > 0 ? quantity * tier.amountMinor : 0);
    }, 0);
  }, [departure, party]);

  function add() {
    if (!departure || !activity) return;
    const lines = tourLineDrafts({
      activityTitle: activity.title,
      optionName: departure.optionName,
      activityOptionId: departure.activityOptionId,
      sessionOccurrenceId: departure.occurrenceId,
      startsAt: departure.startsAt,
      tiers: departure.tiers.map((tier) => ({
        label: tier.label,
        amountMinor: tier.amountMinor,
        quantity: Math.max(0, Math.trunc(Number(party[tier.label] ?? '0')) || 0),
      })),
    });
    if (lines.length === 0) {
      setError('Nobody is travelling yet — put a number against at least one price.');
      return;
    }
    onAdd(lines);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close the tour picker"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add a tour to this quote"
        className="relative flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-[#EAEEF0] bg-white px-5 py-3.5">
          <span className="font-display text-lg font-semibold text-ink">Add a tour</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
          >
            <IconX width={18} height={18} />
          </button>
        </header>

        <div className="flex flex-col gap-4 p-5">
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral"
            >
              {error}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tour">
              <select
                value={activityId}
                onChange={(e) => setActivityId(e.target.value)}
                className={SELECT_CLS}
              >
                <option value="">{activities ? 'Choose a tour…' : 'Loading…'}</option>
                {(activities ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.status === 'published' ? '' : ` (${a.status})`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <DatePicker value={day} onChange={setDay} className={INPUT_CLS} />
            </Field>
          </div>

          {activityId && (
            <div>
              <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">Departure</span>
              {departures === null ? (
                <p className="text-[13px] text-ink-muted">Loading departures…</p>
              ) : departures.length === 0 ? (
                <p className="rounded-xl bg-[#F7F8FA] px-4 py-3 text-[13px] text-ink-muted">
                  Nothing runs on {fmtDate(`${day}T00:00:00+04:00`)}. Open the tour’s availability
                  to add a departure, or add this as a custom line instead.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {departures.map((d) => {
                    const selected = d.occurrenceId === occurrenceId;
                    return (
                      <li key={d.occurrenceId}>
                        <button
                          type="button"
                          disabled={d.refusal !== null}
                          onClick={() => {
                            setOccurrenceId(d.occurrenceId);
                            setParty({});
                          }}
                          className={`w-full rounded-xl border px-3.5 py-2.5 text-left text-[13.5px] ${
                            selected
                              ? 'border-teal bg-teal/5 text-ink'
                              : 'border-[#E2E7EA] text-ink hover:border-teal'
                          } disabled:cursor-not-allowed disabled:border-[#EAEEF0] disabled:bg-[#FAFBFC] disabled:text-ink-muted`}
                        >
                          <span className="font-bold">{fmtTime(d.startsAt)}</span> · {d.optionName}
                          {d.tiers.length > 0 && (
                            <span className="ml-2 text-[12.5px] text-ink-muted">
                              {d.tiers
                                .map((t) => `${t.label} ${eurFromMinor(t.amountMinor)}`)
                                .join(' · ')}
                            </span>
                          )}
                          {d.refusal && (
                            <span className="mt-1 block text-[12px] leading-relaxed text-coral">
                              {d.refusal}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {departure && departure.refusal === null && (
            <div>
              <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">Party</span>
              <div className="grid gap-3 sm:grid-cols-2">
                {departure.tiers.map((tier) => (
                  <label key={tier.label} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">
                      {tier.label}
                      <span className="ml-1.5 text-[12.5px] text-ink-muted">
                        {eurFromMinor(tier.amountMinor)}
                      </span>
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={party[tier.label] ?? ''}
                      onChange={(e) => setParty((p) => ({ ...p, [tier.label]: e.target.value }))}
                      aria-label={`${tier.label} guests`}
                      className={`${INPUT_CLS} w-20 shrink-0 text-right`}
                    />
                  </label>
                ))}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                Nothing is reserved by quoting it. The seat is taken in the transaction that mints
                the booking, when the guest pays — so a nearly-full departure can sell out before
                they accept.
              </p>
            </div>
          )}
        </div>

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[#EAEEF0] bg-white px-5 py-3.5">
          <span className="text-[13.5px] font-bold text-ink">
            {total > 0 ? eurFromMinor(total) : '—'}
          </span>
          <span className="flex gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Cancel
            </button>
            <button
              type="button"
              onClick={add}
              disabled={!departure || departure.refusal !== null || total <= 0}
              className={BTN_PRIMARY}
            >
              Add to quote
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}
