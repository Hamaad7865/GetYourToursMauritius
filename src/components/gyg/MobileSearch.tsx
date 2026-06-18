'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/site/PreferencesProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { useCategories } from '@/lib/categories/useCategories';
import { addRecentSearch, getRecentSearches } from '@/lib/search/recent';
import {
  WEEKDAYS,
  addDays,
  buildSearchUrl,
  monthCells,
  sameDay,
  startOfDay,
} from '@/lib/search/query';
import {
  IconCalendar,
  IconChevron,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconMinus,
  IconPin,
  IconPlus,
  IconSearch,
  IconUsers,
  IconX,
} from '@/components/ui/icons';

const MAX_PER_GROUP = 16;

/**
 * Mobile search: a tappable bar in the header (phones) that opens a full-screen "Where to?" sheet —
 * Belle Mare suggestions, a date, and travellers, then Search. Desktop keeps the inline SearchBar.
 */
export function MobileSearch() {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2.5 rounded-full border border-ink/10 bg-white px-4 py-2.5 text-left shadow-[0_8px_22px_-12px_rgba(10,46,54,0.5)] active:scale-[0.99] sm:hidden"
      >
        <IconSearch width={19} height={19} className="text-teal" />
        <span className="text-[14.5px] font-semibold text-ink-muted">{t('Search tours & activities')}</span>
      </button>
      {open && <SearchSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const categories = useCategories();
  const [query, setQuery] = useState('');
  const [date, setDate] = useState<Date | null>(null);
  const [adults, setAdults] = useState(1);
  const [kids, setKids] = useState(0);
  const [panel, setPanel] = useState<'date' | 'travellers' | null>(null);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  // Scroll-lock, Escape, focus the query on open + trap Tab + return focus to the trigger on close.
  const sheetRef = useDialog(true, onClose, () => inputRef.current);

  useEffect(() => {
    setRecents(getRecentSearches());
  }, []);

  function go(url: string, recordQuery?: string) {
    if (recordQuery && recordQuery.trim()) addRecentSearch(recordQuery.trim());
    onClose();
    router.push(url);
  }
  function search() {
    go(buildSearchUrl({ query, date, adults, kids }), query);
  }

  const total = adults + kids;
  const dateLabel = date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : t('Anytime');

  return (
    <div
      ref={sheetRef}
      className="fixed inset-0 z-[70] flex animate-slide-up flex-col bg-cream sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('Search')}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-ink/10 bg-white px-4 py-2.5">
        <h2 className="flex-1 font-display text-[20px] font-semibold tracking-tight text-ink">{t('Where to?')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close search')}
          className="grid h-11 w-11 place-items-center rounded-full bg-ink/[0.06] text-ink hover:bg-ink/10"
        >
          <IconX width={20} height={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-32 pt-4">
        {/* Query */}
        <div className="flex items-center gap-2.5 rounded-2xl border border-ink/15 bg-white px-4 py-3">
          <IconSearch width={20} height={20} className="shrink-0 text-teal" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder={t('Search tours, places or activities')}
            aria-label={t('Search tours, places or activities')}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
          />
        </div>

        {/* Suggestions */}
        <div className="mt-3 overflow-hidden rounded-2xl border border-ink/10 bg-white">
          {recents.length > 0 && (
            <>
              <p className="px-4 pb-1 pt-3 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                {t('Recent searches')}
              </p>
              {recents.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => go(buildSearchUrl({ query: r, date, adults, kids }), r)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-cream"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink/[0.06] text-ink-muted">
                    <IconClock width={16} height={16} />
                  </span>
                  <span className="truncate text-[14.5px] font-medium text-ink">{r}</span>
                </button>
              ))}
            </>
          )}
          <p className="px-4 pb-1 pt-3 text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
            {t('Browse Belle Mare')}
          </p>
          {categories.map((c) => (
            <button
              key={c.slug}
              type="button"
              onClick={() => go(`/activities?category=${encodeURIComponent(c.name)}`)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left active:bg-cream"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal">
                <IconPin width={17} height={17} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14.5px] font-bold text-ink">{c.name}</span>
                <span className="block text-[12px] text-ink-muted">Belle Mare, Mauritius</span>
              </span>
            </button>
          ))}
        </div>

        {/* Date */}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'date' ? null : 'date'))}
          aria-expanded={panel === 'date'}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 text-left"
        >
          <IconCalendar width={20} height={20} className="text-teal" />
          <span className="flex-1 text-[14.5px] font-semibold text-ink">{dateLabel}</span>
          <IconChevron width={16} height={16} className={`text-ink-muted transition-transform ${panel === 'date' ? 'rotate-180' : ''}`} />
        </button>
        {panel === 'date' && <DateInline selected={date} onPick={(d) => { setDate(d); setPanel(null); }} />}

        {/* Travellers */}
        <button
          type="button"
          onClick={() => setPanel((p) => (p === 'travellers' ? null : 'travellers'))}
          aria-expanded={panel === 'travellers'}
          className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-ink/10 bg-white px-4 py-3.5 text-left"
        >
          <IconUsers width={20} height={20} className="text-teal" />
          <span className="flex-1 text-[14.5px] font-semibold text-ink">
            {total === 1 ? t('{n} traveller', { n: total }) : t('{n} travellers', { n: total })}
          </span>
          <IconChevron width={16} height={16} className={`text-ink-muted transition-transform ${panel === 'travellers' ? 'rotate-180' : ''}`} />
        </button>
        {panel === 'travellers' && (
          <div className="mt-2 rounded-2xl border border-ink/10 bg-white p-4">
            <Stepper label={t('Adults')} hint={t('Ages 18+')} value={adults} min={1} onChange={setAdults} />
            <div className="h-px bg-ink/10" />
            <Stepper label={t('Children')} hint={t('Ages 0–17')} value={kids} min={0} onChange={setKids} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-ink/10 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={() => {
            setQuery('');
            setDate(null);
            setAdults(1);
            setKids(0);
            setPanel(null);
          }}
          className="text-[14px] font-bold text-ink underline underline-offset-2"
        >
          {t('Clear all')}
        </button>
        <button
          type="button"
          onClick={search}
          className="flex items-center gap-2 rounded-full bg-teal px-7 py-3 text-[15px] font-bold text-white hover:bg-teal-dark"
        >
          <IconSearch width={18} height={18} /> {t('Search')}
        </button>
      </div>
    </div>
  );
}

function DateInline({ selected, onPick }: { selected: Date | null; onPick: (d: Date | null) => void }) {
  const t = useT();
  const today = startOfDay(new Date());
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const canBack = view > new Date(today.getFullYear(), today.getMonth(), 1);
  const chips: Array<{ label: string; date: Date | null }> = [
    { label: 'Anytime', date: null },
    { label: 'Today', date: today },
    { label: 'Tomorrow', date: addDays(today, 1) },
  ];

  return (
    <div className="mt-2 rounded-2xl border border-ink/10 bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = c.date === null ? selected === null : sameDay(selected, c.date);
          return (
            <button
              key={c.label}
              type="button"
              onClick={() => onPick(c.date)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${
                active ? 'bg-teal text-white' : 'bg-cream text-ink'
              }`}
            >
              {t(c.label)}
            </button>
          );
        })}
      </div>
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label={t('Previous month')}
          disabled={!canBack}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
          className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-cream disabled:opacity-30"
        >
          <IconChevronLeft width={16} height={16} />
        </button>
        <span className="text-[14px] font-bold text-ink">
          {view.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </span>
        <button
          type="button"
          aria-label={t('Next month')}
          onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
          className="grid h-10 w-10 place-items-center rounded-full text-ink hover:bg-cream"
        >
          <IconChevronRight width={16} height={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-[11px] font-semibold text-ink-muted">
            {w}
          </span>
        ))}
        {monthCells(view.getFullYear(), view.getMonth()).map((cell, idx) => {
          if (!cell) return <span key={`e${idx}`} />;
          const past = cell < today;
          const isSel = sameDay(selected, cell);
          return (
            <button
              key={cell.toISOString()}
              type="button"
              disabled={past}
              onClick={() => onPick(cell)}
              className={`mx-auto grid h-10 w-10 place-items-center rounded-full text-[13px] font-medium ${
                isSel ? 'bg-teal text-white' : past ? 'cursor-default text-ink/25' : 'text-ink hover:bg-teal/10'
              }`}
            >
              {cell.getDate()}
            </button>
          );
        })}
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
  const t = useT();
  return (
    <div className="flex items-center justify-between py-2" role="group" aria-label={label}>
      <div>
        <p className="text-[14.5px] font-bold text-ink">{label}</p>
        <p className="text-[12px] text-ink-muted">{hint}</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t('Remove {label}', { label: label.toLowerCase() })}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="grid h-10 w-10 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
        >
          <IconMinus width={15} height={15} />
        </button>
        <span aria-live="polite" className="w-6 text-center text-[15px] font-bold text-ink">
          {value}
        </span>
        <button
          type="button"
          aria-label={t('Add {label}', { label: label.toLowerCase() })}
          disabled={value >= MAX_PER_GROUP}
          onClick={() => onChange(Math.min(MAX_PER_GROUP, value + 1))}
          className="grid h-10 w-10 place-items-center rounded-full border border-ink/20 text-ink hover:border-teal hover:text-teal disabled:opacity-30"
        >
          <IconPlus width={15} height={15} />
        </button>
      </div>
    </div>
  );
}
