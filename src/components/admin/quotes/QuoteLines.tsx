'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Panel, PANEL_BODY, buttonClass, INPUT_CLS } from '@/components/admin/ui';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';
import { fmtDate } from '@/lib/admin/format';
import { TourPicker } from '@/components/admin/quotes/TourPicker';
import { RentalPicker } from '@/components/admin/quotes/RentalPicker';
import { LineTransport } from '@/components/admin/quotes/LineTransport';
import { LinePickup } from '@/components/admin/quotes/LinePickup';
import { AddItemBox } from '@/components/admin/quotes/AddItemBox';
import {
  loadOptionRegions,
  loadTransportPricing,
  type OptionRegion,
} from '@/lib/admin/quote-catalogue';
import type { RegionDistanceMap, TransportBandPricing } from '@/lib/services/pricing';
import type { QuotePickup } from '@/components/admin/quotes/pickup';
import { DatePicker } from '@/components/ui/DatePicker';
import {
  customLineDraft,
  eurFromMinor,
  formLineProblem,
  moveLine,
  parseEurosToMinor,
  parseQuantity,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import {
  newItemDraft,
  pastLineDraft,
  type ItemSuggestion,
} from '@/components/admin/quotes/suggest';

/**
 * "What they're buying": the quote's lines, in the order the guest reads them, and the one box that
 * adds the next one. It replaces the old Lines pane and keeps everything it did — every line kind,
 * reordering, a custom line's date, time, headcount and pickup hotel (`LinePickup`), a tour or custom
 * line's attached transfer (`LineTransport`, auto-priced from the transport tables), and the catalogue
 * price warning when a tour line's price is changed.
 *
 * ORDER IS DATA. `quote_items.position` is the array index, and the email, the public quote page and
 * (after conversion) `booking_custom_items` all read the lines by it — so the arrows move the guest's
 * itemisation, not just the operator's view.
 *
 * Money stays TEXT until the save parses it (see `state.ts`), and every figure here comes through the
 * same parser the save uses, so nothing on screen can disagree with what would be stored.
 *
 * The maps behind `LinePickup` and `LineTransport` load on demand (`next/dynamic` inside them), so
 * nothing here pulls the Maps client into the bundle.
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

/** A stored transfer fare, as euros. */
function fareLabel(fareText: string): string {
  try {
    return eurFromMinor(parseEurosToMinor(fareText, 'Transfer fare'));
  } catch {
    return '—';
  }
}

const KIND_LABEL: Record<string, string> = {
  catalogue: 'Tour',
  custom: 'Custom',
  rental: 'Rental',
};

const ICON_BTN =
  'grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-line-soft hover:text-ink disabled:opacity-30 motion-reduce:transition-none';

export function QuoteLines({
  form,
  setLines,
  pickup,
  setPickup,
  locked,
}: {
  form: QuoteFormValues;
  setLines: (lines: QuoteLineDraft[]) => void;
  pickup: QuotePickup;
  /** The raw state setter: the map updates the label and the coords from two callbacks fired in ONE
   *  event, so both have to compose functionally. */
  setPickup: Dispatch<SetStateAction<QuotePickup>>;
  /** The guest has opened checkout or paid: the lines are the itemisation behind a charge. */
  locked: boolean;
}) {
  const [picking, setPicking] = useState<{ activityId: string } | null>(null);
  const [pickingRental, setPickingRental] = useState<{ slug: string } | null>(null);
  // Transport pricing + the option→region map, so each line's transfer can be auto-priced. Both
  // degrade to null (the operator types the fare) rather than block.
  const [pricing, setPricing] = useState<{
    bands: TransportBandPricing;
    distances: RegionDistanceMap;
  } | null>(null);
  const [optionRegions, setOptionRegions] = useState<Map<string, OptionRegion> | null>(null);
  useEffect(() => {
    loadTransportPricing()
      .then(setPricing)
      .catch(() => setPricing(null));
    loadOptionRegions()
      .then(setOptionRegions)
      .catch(() => setOptionRegions(null));
  }, []);

  const lines = form.lines;
  const problem = formLineProblem(form);

  function update(index: number, patch: Partial<QuoteLineDraft>) {
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function picked(s: ItemSuggestion) {
    if (s.kind === 'past') setLines([...lines, pastLineDraft(s.line)]);
    else if (s.kind === 'new') setLines([...lines, newItemDraft(s.text)]);
    else if (s.kind === 'tour') setPicking({ activityId: s.tour.id });
    else setPickingRental({ slug: s.vehicle.slug });
  }

  return (
    <Panel
      title="What they’re buying"
      meta={lines.length === 1 ? '1 item' : `${lines.length} items`}
    >
      {lines.length === 0 ? (
        <p className={`${PANEL_BODY} text-[13px] text-ink-soft`}>
          Nothing on this quote yet. Add a tour from the catalogue, a rental car, or a line for
          anything that isn’t in it — a private charter, a guide, a transfer priced by hand.
        </p>
      ) : (
        <ul>
          {lines.map((line, index) => {
            const n = index + 1;
            const subtotal = subtotalMinor(line);
            const overridden =
              line.kind === 'catalogue' &&
              line.catalogueUnitMinor !== null &&
              subtotal !== null &&
              parseEurosToMinor(line.unitText, 'Unit price') !== line.catalogueUnitMinor;
            return (
              <li key={line.key} className="border-b border-line-soft px-4 py-3">
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <div className="min-w-0 flex-1 basis-64">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-line-soft px-1.5 py-px text-[11px] font-semibold text-ink-muted">
                        {KIND_LABEL[line.kind] ?? line.kind}
                      </span>
                      {/* The day alone: the slot's clock is a placeholder, and the tour's start time
                          already rides in the description. */}
                      {line.kind === 'catalogue' && line.startsAt && (
                        <span className="text-[12px] text-ink-soft">{fmtDate(line.startsAt)}</span>
                      )}
                    </div>
                    <input
                      value={line.description}
                      onChange={(e) => update(index, { description: e.target.value })}
                      aria-label={`Line ${n} description`}
                      placeholder="What the guest is buying, e.g. Private catamaran charter"
                      disabled={locked}
                      className={`${INPUT_CLS} font-semibold`}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span
                        aria-hidden="true"
                        className="mb-[5px] block text-[11.5px] font-semibold text-ink-soft"
                      >
                        Qty
                      </span>
                      <input
                        value={line.quantityText}
                        onChange={(e) => update(index, { quantityText: e.target.value })}
                        inputMode="numeric"
                        aria-label={`Line ${n} quantity`}
                        disabled={locked}
                        className={`${INPUT_CLS} w-16 text-right`}
                      />
                    </label>
                    <label className="block">
                      <span
                        aria-hidden="true"
                        className="mb-[5px] block text-[11.5px] font-semibold text-ink-soft"
                      >
                        Each, €
                      </span>
                      <input
                        value={line.unitText}
                        onChange={(e) => update(index, { unitText: e.target.value })}
                        inputMode="decimal"
                        aria-label={`Line ${n} unit price in euros`}
                        placeholder="0.00"
                        disabled={locked}
                        className={`${INPUT_CLS} w-24 text-right`}
                      />
                    </label>
                    <span className="min-w-[5.5rem] pb-2 text-right text-[13.5px] font-bold text-ink">
                      {subtotal === null ? '—' : eurFromMinor(subtotal)}
                    </span>
                    {!locked && (
                      <span className="flex items-center pb-0.5">
                        <button
                          type="button"
                          aria-label={`Move line ${n} up`}
                          disabled={index === 0}
                          onClick={() => setLines(moveLine(lines, index, -1))}
                          className={ICON_BTN}
                        >
                          <IconChevron width={14} height={14} className="rotate-180" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move line ${n} down`}
                          disabled={index === lines.length - 1}
                          onClick={() => setLines(moveLine(lines, index, 1))}
                          className={ICON_BTN}
                        >
                          <IconChevron width={14} height={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove line ${n}`}
                          onClick={() => setLines(lines.filter((_, i) => i !== index))}
                          className={`${ICON_BTN} hover:!bg-coral-tint hover:!text-coral-dark`}
                        >
                          <IconX width={14} height={14} />
                        </button>
                      </span>
                    )}
                  </div>
                </div>

                {line.kind === 'catalogue' ? (
                  <p className="mt-1.5 text-[12px] text-ink-soft">
                    Priced from the catalogue at {eurFromMinor(line.catalogueUnitMinor ?? 0)} per{' '}
                    {line.priceLabel || 'guest'}.{' '}
                    {overridden
                      ? 'Holds nothing — a changed price reserves no seat.'
                      : 'Holds a seat on this departure when the guest pays.'}
                  </p>
                ) : locked ? (
                  <p className="mt-1.5 text-[12px] text-ink-soft">
                    {line.date
                      ? `${fmtDate(`${line.date}T12:00:00+04:00`)} ${line.time}`
                      : 'No date'}
                    {line.kind === 'custom' && line.guests ? ` · ${line.guests} guests` : ''}
                    {line.kind === 'custom' && line.pickupLabel
                      ? ` · pickup ${line.pickupLabel}`
                      : ''}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <DatePicker
                      value={line.date}
                      onChange={(v) => update(index, { date: v })}
                      ariaLabel={`Line ${n} date`}
                      className={`${INPUT_CLS} w-40`}
                    />
                    <input
                      type="time"
                      value={line.time}
                      onChange={(e) => update(index, { time: e.target.value })}
                      aria-label={`Line ${n} time`}
                      disabled={locked}
                      className={`${INPUT_CLS} w-28`}
                    />
                    {line.kind === 'custom' && (
                      <label className="inline-flex items-center gap-2 text-[12px] font-semibold text-ink-muted">
                        Guests
                        <input
                          value={line.guests}
                          onChange={(e) => update(index, { guests: e.target.value })}
                          inputMode="numeric"
                          aria-label={`Line ${n} number of guests`}
                          placeholder="e.g. 2"
                          disabled={locked}
                          className={`${INPUT_CLS} w-20 text-right`}
                        />
                      </label>
                    )}
                    <span className="text-[12px] text-ink-soft">
                      Holds nothing — a hand-priced line reserves no capacity.
                    </span>
                  </div>
                )}

                {overridden && (
                  <p className="mt-2 rounded-lg bg-gold-tint px-3 py-2 text-[12px] leading-relaxed text-ink">
                    This is not the catalogue price ({eurFromMinor(line.catalogueUnitMinor ?? 0)}),
                    so the line will be saved as a <strong>custom line</strong>. The guest pays your
                    figure, but a custom line reserves no seat. The departure stays on the line for
                    the guest and for the day sheet.
                  </p>
                )}

                {/* A bespoke tour's run-sheet pickup for the operations calendar. Never money. */}
                {line.kind === 'custom' && !locked && (
                  <LinePickup
                    pickupLabel={line.pickupLabel}
                    onChange={(label) => update(index, { pickupLabel: label })}
                    pickup={pickup}
                    setPickup={setPickup}
                  />
                )}

                {/* A locked line still says what its transfer is — the guest paid for it. */}
                {locked && line.transport && (
                  <p className="mt-1.5 text-[12px] text-ink-soft">
                    Round-trip transfer from {line.transport.pickupLabel || 'the guest’s hotel'}
                    {line.transport.dropoffLabel ? ` to ${line.transport.dropoffLabel}` : ''} ·{' '}
                    {fareLabel(line.transport.fareText)}
                  </p>
                )}

                {line.kind !== 'rental' && !locked && (
                  <LineTransport
                    line={line}
                    onChange={(transport) => update(index, { transport })}
                    pickup={pickup}
                    setPickup={setPickup}
                    pricing={pricing}
                    optionRegions={optionRegions}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {problem && (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-lg bg-coral-tint px-3 py-2.5 text-[13px] font-medium text-coral-dark"
        >
          {problem}
        </p>
      )}

      {!locked && (
        <div className={`${PANEL_BODY} flex flex-col gap-3`}>
          <AddItemBox onPick={picked} />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPicking({ activityId: '' })}
              className={buttonClass('ghost', 'sm')}
            >
              <IconPlus width={14} height={14} /> Tour from the catalogue
            </button>
            <button
              type="button"
              onClick={() => setPickingRental({ slug: '' })}
              className={buttonClass('ghost', 'sm')}
            >
              <IconPlus width={14} height={14} /> Rental car
            </button>
            <button
              type="button"
              onClick={() => setLines([...lines, customLineDraft()])}
              className={buttonClass('ghost', 'sm')}
            >
              <IconPlus width={14} height={14} /> Custom line
            </button>
          </div>
        </div>
      )}

      {picking && (
        <TourPicker
          initialActivityId={picking.activityId}
          onAdd={(added) => setLines([...lines, ...added])}
          onClose={() => setPicking(null)}
        />
      )}

      {pickingRental && (
        <RentalPicker
          initialSlug={pickingRental.slug}
          onAdd={(added) => setLines([...lines, ...added])}
          onClose={() => setPickingRental(null)}
        />
      )}
    </Panel>
  );
}
