'use client';

import { useState } from 'react';
import { BTN_GHOST, Card, INPUT_CLS } from '@/components/admin/ui';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';
import { fmtDate, fmtTime } from '@/lib/admin/format';
import { TourPicker } from '@/components/admin/quotes/TourPicker';
import {
  customLineDraft,
  eurFromMinor,
  formLineProblem,
  formTotalMinor,
  moveLine,
  parseEurosToMinor,
  parseQuantity,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';

/**
 * The line editor: what the guest is being offered, in the order they will read it.
 *
 * ORDER IS DATA HERE, not presentation. `quote_items.position` is the array index, and the email,
 * the public quote page and (after conversion) `booking_custom_items` all read the lines by it — so
 * the up/down controls are moving the guest's itemisation, not just the operator's view.
 *
 * Money is typed in euros and held as TEXT until the save parses it (see `state.ts`): a half-typed
 * '12.' is a legal thing to be looking at, and every figure shown here — subtotal, total — is
 * derived from that text through the same parser the save uses, so nothing on screen can disagree
 * with what would be stored.
 */

/** A line's own subtotal, or null while its numbers are still half-typed. */
function subtotalMinor(line: QuoteLineDraft): number | null {
  try {
    return (
      parseQuantity(line.quantityText, 'Quantity') * parseEurosToMinor(line.unitText, 'Unit price')
    );
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  catalogue: 'Tour',
  custom: 'Custom',
  rental: 'Rental',
};

export function LinesPane({
  form,
  setLines,
}: {
  form: QuoteFormValues;
  setLines: (lines: QuoteLineDraft[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const lines = form.lines;
  const total = formTotalMinor(form);
  const problem = formLineProblem(form);

  function update(index: number, patch: Partial<QuoteLineDraft>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[14px] font-extrabold text-ink">Lines</h2>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPicking(true)} className={BTN_GHOST}>
              <IconPlus width={15} height={15} /> Add tour
            </button>
            <button
              type="button"
              onClick={() => setLines([...lines, customLineDraft()])}
              className={BTN_GHOST}
            >
              <IconPlus width={15} height={15} /> Add custom line
            </button>
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="rounded-xl bg-[#F7F8FA] px-4 py-6 text-center text-[13.5px] text-ink-muted">
            Nothing on this quote yet. Add a tour from the catalogue, or a custom line for anything
            that isn’t in it — a private charter, a guide, a transfer we price by hand.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((line, index) => {
              const subtotal = subtotalMinor(line);
              const overridden =
                line.kind === 'catalogue' &&
                line.catalogueUnitMinor !== null &&
                subtotal !== null &&
                parseEurosToMinor(line.unitText, 'Unit price') !== line.catalogueUnitMinor;
              return (
                <li
                  key={line.key}
                  className="rounded-xl border border-[#E2E7EA] bg-[#FCFDFD] p-3.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                      {KIND_LABEL[line.kind] ?? line.kind}
                    </span>
                    {line.kind === 'catalogue' && line.startsAt && (
                      <span className="text-[12px] text-ink-muted">
                        {fmtDate(line.startsAt)}, {fmtTime(line.startsAt)}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Move line ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => setLines(moveLine(lines, index, -1))}
                        className="grid h-7 w-7 place-items-center rounded-lg text-ink-muted hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
                      >
                        <IconChevron width={14} height={14} className="rotate-180" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move line ${index + 1} down`}
                        disabled={index === lines.length - 1}
                        onClick={() => setLines(moveLine(lines, index, 1))}
                        className="grid h-7 w-7 place-items-center rounded-lg text-ink-muted hover:bg-ink/[0.06] hover:text-ink disabled:opacity-30"
                      >
                        <IconChevron width={14} height={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Remove line ${index + 1}`}
                        onClick={() => setLines(lines.filter((_, i) => i !== index))}
                        className="grid h-7 w-7 place-items-center rounded-lg text-coral hover:bg-coral/10"
                      >
                        <IconX width={14} height={14} />
                      </button>
                    </span>
                  </div>

                  <input
                    value={line.description}
                    onChange={(e) => update(index, { description: e.target.value })}
                    aria-label={`Line ${index + 1} description`}
                    placeholder="What the guest is buying — e.g. Private catamaran charter, 23 Aug"
                    className={INPUT_CLS}
                  />

                  <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_1fr_5rem_7rem]">
                    {line.kind === 'catalogue' ? (
                      <p className="hidden text-[12px] text-ink-muted sm:col-span-2 sm:block">
                        Priced from the catalogue at {eurFromMinor(line.catalogueUnitMinor ?? 0)}{' '}
                        per {line.priceLabel || 'guest'}.
                      </p>
                    ) : (
                      <>
                        <input
                          type="date"
                          value={line.date}
                          onChange={(e) => update(index, { date: e.target.value })}
                          aria-label={`Line ${index + 1} date`}
                          className={INPUT_CLS}
                        />
                        <input
                          type="time"
                          value={line.time}
                          onChange={(e) => update(index, { time: e.target.value })}
                          aria-label={`Line ${index + 1} time`}
                          className={INPUT_CLS}
                        />
                      </>
                    )}
                    <input
                      value={line.quantityText}
                      onChange={(e) => update(index, { quantityText: e.target.value })}
                      inputMode="numeric"
                      aria-label={`Line ${index + 1} quantity`}
                      placeholder="Qty"
                      className={`${INPUT_CLS} text-right`}
                    />
                    <input
                      value={line.unitText}
                      onChange={(e) => update(index, { unitText: e.target.value })}
                      inputMode="decimal"
                      aria-label={`Line ${index + 1} unit price in euros`}
                      placeholder="0.00"
                      className={`${INPUT_CLS} text-right`}
                    />
                  </div>

                  <div className="mt-2 flex items-baseline justify-between gap-3">
                    <span className="text-[12px] text-ink-muted">
                      {line.kind === 'catalogue' && !overridden
                        ? 'Holds a seat on this departure when the guest pays.'
                        : 'Holds nothing — a free-text line reserves no capacity.'}
                    </span>
                    <span className="text-[13.5px] font-extrabold text-ink">
                      {subtotal === null ? '—' : eurFromMinor(subtotal)}
                    </span>
                  </div>

                  {overridden && (
                    <p className="mt-2 rounded-lg bg-gold-light/20 px-3 py-2 text-[12px] leading-relaxed text-ink">
                      This is not the catalogue price ({eurFromMinor(line.catalogueUnitMinor ?? 0)}
                      ), so the line will be saved as a <strong>custom line</strong>. The guest pays
                      your figure — but the payment path re-prices catalogue lines from the
                      catalogue and would refuse this one, and a custom line reserves no seat. The
                      departure stays on the line for the guest and for the day sheet.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {problem && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral"
          >
            {problem}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-[#EAEEF0] pt-3.5">
          <span className="text-[13.5px] font-bold text-ink">Total</span>
          <span className="text-[19px] font-extrabold text-ink">
            {total === null ? '—' : eurFromMinor(total)}
          </span>
        </div>
      </Card>

      {picking && (
        <TourPicker
          onAdd={(added) => setLines([...lines, ...added])}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
