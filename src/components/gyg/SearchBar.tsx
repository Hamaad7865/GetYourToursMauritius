'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  IconChevron,
  IconChevronLeft,
  IconChevronRight,
  IconMinus,
  IconPlus,
  IconSearch,
} from '@/components/ui/icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PER_GROUP = 16;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a: Date | null, b: Date | null): boolean {
  return !!a && !!b && a.toDateString() === b.toDateString();
}
/**
 * The user's chosen calendar date as a local YYYY-MM-DD string. We deliberately use the
 * LOCAL date components (not toISOString) so "20 June" stays 20 June regardless of the
 * browser timezone — a tour date is a calendar day, not an instant.
 */
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function monthCells(year: number, month: number): Array<Date | null> {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Sun(0) → 6
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  return cells;
}

type Variant = 'hero' | 'compact';

/**
 * GetYourGuide-style search: place/activity query + date picker + travellers (adults +
 * children). Used in the hero (`variant="hero"`) and docked into the navbar on scroll
 * (`variant="compact"`). On mobile the controls wrap below the query so date/travellers
 * stay reachable.
 *
 * Note (deferred): the calendar grid and steppers are Tab- and click-operable but do not
 * yet implement full APG arrow-key roving navigation — a follow-up a11y enhancement.
 */
export function SearchBar({ variant = 'hero' }: { variant?: Variant }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [panel, setPanel] = useState<'date' | 'travellers' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  function close() {
    setPanel(null);
  }
  function closeAndRestore() {
    setPanel(null);
    lastTrigger.current?.focus();
  }
  function toggle(which: 'date' | 'travellers', e: React.MouseEvent<HTMLButtonElement>) {
    lastTrigger.current = e.currentTarget;
    setPanel((p) => (p === which ? null : which));
  }

  useEffect(() => {
    if (!panel) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAndRestore();
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [panel]);

  function submit() {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (date) params.set('date', toIso(date));
    if (adults !== 1) params.set('adults', String(adults));
    if (kids > 0) params.set('children', String(kids));
    const qs = params.toString();
    setPanel(null);
    router.push(`/activities${qs ? `?${qs}` : ''}`);
  }

  const total = adults + kids;
  const dateLabel = date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Anytime';
  const travellersLabel = `${total} ${total === 1 ? 'traveller' : 'travellers'}`;

  const compact = variant === 'compact';
  const segClass = `flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium hover:bg-cream ${
    compact ? 'px-2.5 py-1 text-[12.5px]' : 'px-3 py-2 text-[14px]'
  }`;

  return (
    <div
      ref={rootRef}
      className={`relative z-30 text-left ${compact ? 'w-full' : 'mx-auto mt-8 max-w-3xl'}`}
    >
      <div
        className={`flex flex-col bg-white sm:flex-row sm:items-center ${
          compact
            ? 'gap-1 rounded-2xl border border-ink/15 p-1.5 shadow-sm sm:rounded-full'
            : 'gap-2 rounded-2xl p-3 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)] sm:gap-1 sm:rounded-full sm:p-2'
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={`grid shrink-0 place-items-center text-teal ${compact ? 'h-8 w-8' : 'h-10 w-10'}`}
          >
            <IconSearch width={compact ? 18 : 22} height={compact ? 18 : 22} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="Search places or activities"
            aria-label="Search places or activities"
            className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-muted ${
              compact ? 'text-[13px]' : 'text-[15px]'
            }`}
          />
        </div>

        <div className="flex items-center justify-end gap-1">
          <div className="hidden h-7 w-px shrink-0 bg-ink/10 sm:block" />
          <button
            type="button"
            onClick={(e) => toggle('date', e)}
            aria-expanded={panel === 'date'}
            className={`${segClass} ${date ? 'text-ink' : 'text-ink-muted'}`}
          >
            {dateLabel}
            <IconChevron width={14} height={14} className="text-ink-muted" />
          </button>

          <div className="hidden h-7 w-px shrink-0 bg-ink/10 sm:block" />
          <button
            type="button"
            onClick={(e) => toggle('travellers', e)}
            aria-expanded={panel === 'travellers'}
            className={`${segClass} text-ink`}
          >
            {travellersLabel}
            <IconChevron width={14} height={14} className="text-ink-muted" />
          </button>

          <button
            type="button"
            onClick={submit}
            className={`shrink-0 rounded-full bg-teal font-bold text-white transition hover:bg-teal-dark ${
              compact ? 'px-4 py-1.5 text-[13px]' : 'px-6 py-3 text-[15px]'
            }`}
          >
            Search
          </button>
        </div>
      </div>

      {panel === 'date' && (
        <DatePanel
          selected={date}
          onPick={(d) => {
            setDate(d);
            closeAndRestore();
          }}
        />
      )}
      {panel === 'travellers' && (
        <TravellersPanel
          adults={adults}
          kids={kids}
          onAdults={setAdults}
          onKids={setKids}
          onDone={closeAndRestore}
        />
      )}
    </div>
  );
}

/** Focuses the first enabled control in a freshly-opened panel. */
function useAutoFocus() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus();
  }, []);
  return ref;
}

function DatePanel({ selected, onPick }: { selected: Date | null; onPick: (d: Date | null) => void }) {
  const today = startOfDay(new Date());
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const ref = useAutoFocus();

  const canGoBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const months = [view, new Date(view.getFullYear(), view.getMonth() + 1, 1)];

  const chips: Array<{ label: string; date: Date }> = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    // Upcoming Saturday (today if today is Saturday).
    { label: 'Next weekend', date: addDays(today, (6 - today.getDay() + 7) % 7) },
  ];

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-30 mt-3 w-[min(680px,calc(100vw-2rem))] rounded-3xl border border-ink/10 bg-white p-4 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)] sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={selected === null}
          onClick={() => onPick(null)}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
            selected === null ? 'bg-teal text-white' : 'bg-cream text-ink hover:bg-ink/10'
          }`}
        >
          Anytime
        </button>
        {chips.map((c) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={sameDay(selected, c.date)}
            onClick={() => onPick(c.date)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
              sameDay(selected, c.date) ? 'bg-teal text-white' : 'bg-cream text-ink hover:bg-ink/10'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {months.map((m, i) => (
          <div key={`${m.getFullYear()}-${m.getMonth()}`}>
            <div className="mb-2 flex items-center justify-between">
              {i === 0 ? (
                <button
                  type="button"
                  aria-label="Previous month"
                  disabled={!canGoBack}
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
                >
                  <IconChevronLeft width={16} height={16} />
                </button>
              ) : (
                <span className="h-7 w-7" />
              )}
              <span className="text-[14px] font-bold text-ink">
                {m.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
              </span>
              {i === months.length - 1 ? (
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
                  className="grid h-7 w-7 place-items-center rounded-full text-ink hover:bg-cream"
                >
                  <IconChevronRight width={16} height={16} />
                </button>
              ) : (
                <span className="h-7 w-7" />
              )}
            </div>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1 text-[11px] font-semibold text-ink-muted">
                  {w}
                </span>
              ))}
              {monthCells(m.getFullYear(), m.getMonth()).map((cell, idx) => {
                if (!cell) return <span key={`e${idx}`} />;
                const past = cell < today;
                const isSel = sameDay(selected, cell);
                const full = cell.toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                });
                return (
                  <button
                    key={cell.toISOString()}
                    type="button"
                    disabled={past}
                    aria-label={past ? `${full}, unavailable` : full}
                    onClick={() => onPick(cell)}
                    className={`mx-auto grid h-8 w-8 place-items-center rounded-full text-[13px] font-medium transition sm:h-9 sm:w-9 ${
                      isSel
                        ? 'bg-teal text-white'
                        : past
                          ? 'cursor-default text-ink/25'
                          : 'text-ink hover:bg-teal/10'
                    }`}
                  >
                    {cell.getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stepper({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2" role="group" aria-label={label}>
      <div>
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="text-[12px] text-ink-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Remove ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
        >
          <IconMinus width={15} height={15} />
        </button>
        <span aria-live="polite" className="w-6 text-center text-[15px] font-bold text-ink">
          {value}
        </span>
        <button
          type="button"
          aria-label={`Add ${label.toLowerCase()}`}
          disabled={value >= MAX_PER_GROUP}
          onClick={() => onChange(Math.min(MAX_PER_GROUP, value + 1))}
          className="grid h-8 w-8 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
        >
          <IconPlus width={15} height={15} />
        </button>
      </div>
    </div>
  );
}

function TravellersPanel({
  adults,
  kids,
  onAdults,
  onKids,
  onDone,
}: {
  adults: number;
  kids: number;
  onAdults: (n: number) => void;
  onKids: (n: number) => void;
  onDone: () => void;
}) {
  const ref = useAutoFocus();
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-30 mt-3 w-[min(320px,calc(100vw-2rem))] rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)]"
    >
      <Stepper label="Adults" hint="Ages 18 and above" value={adults} min={1} onChange={onAdults} />
      <div className="h-px bg-ink/10" />
      <Stepper label="Children" hint="Ages 0–17" value={kids} min={0} onChange={onKids} />
      <button
        type="button"
        onClick={onDone}
        className="mt-4 w-full rounded-full bg-teal px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
      >
        Done
      </button>
    </div>
  );
}
