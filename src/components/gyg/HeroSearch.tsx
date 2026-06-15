'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
const MAX_TRAVELLERS = 16;

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
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Cells for a month grid, Monday-first, with leading nulls for alignment. */
function monthCells(year: number, month: number): Array<Date | null> {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Sun(0) → 6
  const days = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = Array.from({ length: firstWeekday }, () => null);
  for (let d = 1; d <= days; d += 1) cells.push(new Date(year, month, d));
  return cells;
}

/** GetYourGuide-style hero search: place/activity query + date picker + traveller count. */
export function HeroSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [travellers, setTravellers] = useState(1);
  const [panel, setPanel] = useState<'date' | 'travellers' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panel) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPanel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanel(null);
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
    if (travellers > 1) params.set('travellers', String(travellers));
    const qs = params.toString();
    router.push(`/activities${qs ? `?${qs}` : ''}`);
  }

  const dateLabel = date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'Anytime';
  const travellersLabel = `${travellers} ${travellers === 1 ? 'traveller' : 'travellers'}`;

  return (
    <div ref={rootRef} className="relative z-30 mx-auto mt-8 max-w-3xl text-left">
      <div className="flex items-center gap-1 rounded-full bg-white p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
        <span className="grid h-10 w-10 shrink-0 place-items-center text-teal">
          <IconSearch width={22} height={22} />
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
          className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
        />

        <div className="hidden h-8 w-px shrink-0 bg-ink/10 sm:block" />
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'date' ? null : 'date'))}
          aria-expanded={panel === 'date'}
          className={`hidden shrink-0 items-center gap-1.5 rounded-full px-4 py-2.5 text-[14px] font-medium hover:bg-cream sm:flex ${
            date ? 'text-ink' : 'text-ink-muted'
          }`}
        >
          {dateLabel}
          <IconChevron width={15} height={15} className="text-ink-muted" />
        </button>

        <div className="hidden h-8 w-px shrink-0 bg-ink/10 sm:block" />
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'travellers' ? null : 'travellers'))}
          aria-expanded={panel === 'travellers'}
          className="hidden shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-cream sm:flex"
        >
          {travellersLabel}
          <IconChevron width={15} height={15} className="text-ink-muted" />
        </button>

        <button
          type="button"
          onClick={submit}
          className="shrink-0 rounded-full bg-teal px-6 py-3 text-[15px] font-bold text-white transition hover:bg-teal-dark"
        >
          Search
        </button>
      </div>

      {panel === 'date' && (
        <DatePanel
          selected={date}
          onPick={(d) => {
            setDate(d);
            setPanel(null);
          }}
        />
      )}
      {panel === 'travellers' && (
        <TravellersPanel value={travellers} onChange={setTravellers} onDone={() => setPanel(null)} />
      )}
    </div>
  );
}

function DatePanel({ selected, onPick }: { selected: Date | null; onPick: (d: Date | null) => void }) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));

  const canGoBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const months = [view, new Date(view.getFullYear(), view.getMonth() + 1, 1)];

  const chips: Array<{ label: string; date: Date }> = [
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
    { label: 'Next weekend', date: addDays(today, ((6 - today.getDay() + 7) % 7) || 7) },
  ];

  return (
    <div className="absolute left-0 right-0 top-full z-30 mt-3 rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
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
                return (
                  <button
                    key={cell.toISOString()}
                    type="button"
                    disabled={past}
                    onClick={() => onPick(cell)}
                    className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-[13px] font-medium transition ${
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

function TravellersPanel({
  value,
  onChange,
  onDone,
}: {
  value: number;
  onChange: (n: number) => void;
  onDone: () => void;
}) {
  return (
    <div className="absolute right-0 top-full z-30 mt-3 w-72 rounded-3xl border border-ink/10 bg-white p-5 shadow-[0_30px_60px_-25px_rgba(10,46,54,0.45)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-ink">Travellers</p>
          <p className="text-[12px] text-ink-muted">How many of you?</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Remove traveller"
            disabled={value <= 1}
            onClick={() => onChange(Math.max(1, value - 1))}
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
          >
            <IconMinus width={16} height={16} />
          </button>
          <span className="w-6 text-center text-[15px] font-bold text-ink">{value}</span>
          <button
            type="button"
            aria-label="Add traveller"
            disabled={value >= MAX_TRAVELLERS}
            onClick={() => onChange(Math.min(MAX_TRAVELLERS, value + 1))}
            className="grid h-9 w-9 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
          >
            <IconPlus width={16} height={16} />
          </button>
        </div>
      </div>
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
