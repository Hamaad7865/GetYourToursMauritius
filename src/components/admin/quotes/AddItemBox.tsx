'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { INPUT_CLS } from '@/components/admin/ui';
import { loadCustomLineHistory } from '@/lib/admin/quotes';
import { loadQuotableActivities } from '@/lib/admin/quote-catalogue';
import { loadRentalFleet } from '@/lib/admin/rental';
import { eurToCents } from '@/lib/services/pricing';
import { eurFromMinor } from '@/components/admin/quotes/state';
import {
  itemSuggestions,
  pastLinesFrom,
  type ItemSuggestion,
  type SuggestionSources,
} from '@/components/admin/quotes/suggest';

/**
 * "Add an item": one box that suggests, in one list, a hand-typed line quoted before (at its last
 * price), a catalogue tour, or a fleet vehicle — then "add what I typed" as a new line.
 *
 * It decides nothing about money. A past line becomes a custom line at its last price (`pastLineDraft`)
 * which the operator can change; a tour opens the existing tour picker on that tour, and a vehicle the
 * rental picker on that vehicle, so a catalogue or rental line is still built by exactly the code that
 * builds it today (`tourLineDrafts`, `rentalLineDraft`) and priced from the catalogue or the fleet.
 *
 * The three lists are read on first focus, not on mount, and each failure leaves only that list
 * empty: a box that cannot suggest still adds a typed line.
 *
 * ARIA 1.2 combobox: the input owns the listbox, arrow keys move `aria-activedescendant`, Enter picks,
 * Escape closes. Focus never leaves the input.
 */

const KIND_TAG: Record<ItemSuggestion['kind'], string> = {
  past: 'Used before',
  tour: 'Catalogue',
  vehicle: 'Rental',
  new: 'New',
};

function suggestionText(s: ItemSuggestion): { title: string; meta: string } {
  switch (s.kind) {
    case 'past':
      return {
        title: s.line.description,
        meta: `last quoted ${eurFromMinor(s.line.unitAmountMinor)} each`,
      };
    case 'tour':
      return {
        title: s.tour.title,
        meta: s.tour.status === 'published' ? 'pick a date, holds a seat' : `${s.tour.status} tour`,
      };
    case 'vehicle':
      return { title: s.vehicle.name, meta: `${eurFromMinor(s.vehicle.dailyRateMinor)} a day` };
    case 'new':
      return { title: `Add “${s.text}” as a new item`, meta: 'you type the price' };
  }
}

export function AddItemBox({
  onPick,
  disabled = false,
}: {
  onPick: (suggestion: ItemSuggestion) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [sources, setSources] = useState<SuggestionSources | null>(null);
  const loading = useRef(false);

  function load() {
    if (sources || loading.current) return;
    loading.current = true;
    void Promise.all([
      loadCustomLineHistory()
        .then(pastLinesFrom)
        .catch(() => []),
      loadQuotableActivities()
        .then((rows) => rows.map((a) => ({ id: a.id, title: a.title, status: a.status })))
        .catch(() => []),
      loadRentalFleet()
        .then((rows) =>
          rows
            .filter((v) => v.active)
            .map((v) => ({
              slug: v.slug,
              name: v.name,
              dailyRateMinor: eurToCents(v.dailyRateEur),
            })),
        )
        .catch(() => []),
    ]).then(([past, tours, vehicles]) => setSources({ past, tours, vehicles }));
  }

  const suggestions = useMemo(
    () => itemSuggestions(text, sources ?? { past: [], tours: [], vehicles: [] }),
    [text, sources],
  );
  const shown = open && suggestions.length > 0;
  const current = shown ? Math.min(active, suggestions.length - 1) : -1;

  function pick(s: ItemSuggestion) {
    onPick(s);
    setText('');
    setOpen(false);
    setActive(0);
    inputRef.current?.focus();
  }

  return (
    <div className="relative">
      <label
        htmlFor={`${id}-input`}
        className="mb-[5px] block text-[12px] font-semibold text-ink-muted"
      >
        Add an item
      </label>
      <input
        ref={inputRef}
        id={`${id}-input`}
        type="text"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={current >= 0 ? `${id}-opt-${current}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder="Type a tour, a car, or anything else…"
        className={INPUT_CLS}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter') {
            const s = current >= 0 ? suggestions[current] : undefined;
            if (s) {
              e.preventDefault();
              pick(s);
            }
          } else if (e.key === 'Escape' && shown) {
            e.preventDefault();
            setOpen(false);
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!shown}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-[0_8px_24px_rgba(10,46,54,0.12)]"
      >
        {suggestions.map((s, i) => {
          const { title, meta } = suggestionText(s);
          return (
            <li
              key={s.key}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === current}
              // mousedown, not click: the input's blur would close the list before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5 px-3 py-2 text-[13px] ${
                i === current ? 'bg-teal-tint' : ''
              }`}
            >
              <span className="rounded-md bg-line-soft px-1.5 py-px text-[11px] font-semibold text-ink-muted">
                {KIND_TAG[s.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{title}</span>
              <span className="whitespace-nowrap text-[12px] text-ink-soft">{meta}</span>
            </li>
          );
        })}
      </ul>
      {open && sources === null && (
        <p className="mt-1 text-[12px] text-ink-soft" aria-live="polite">
          Loading suggestions…
        </p>
      )}
    </div>
  );
}
