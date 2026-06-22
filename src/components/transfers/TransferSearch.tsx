'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { transfers, type Transfer } from '@/lib/content/transfers';
import { IconArrowRight, IconPin, IconSearch } from '@/components/ui/icons';

/**
 * Airport-transfer search bar: the origin is FIXED to SSR International Airport (every transfer starts or
 * ends there); the traveller searches their hotel and is taken to that hotel's bookable page. A typeahead
 * over our covered resorts — selecting one navigates to /airport-transfers/[slug].
 */
export function TransferSearch() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo<Transfer[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return transfers
      .filter((t) => t.hotelName.toLowerCase().includes(s) || t.area.toLowerCase().includes(s))
      .slice(0, 8);
  }, [q]);

  function go(t: Transfer | undefined) {
    if (t) router.push(t.path);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(matches[active] ?? matches[0]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)] sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.4fr)] sm:items-end">
        {/* From — fixed to the airport */}
        <div>
          <div className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">From</div>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/10 bg-cream/40 px-3.5 py-2.5 text-sm font-semibold text-ink">
            <IconPin width={16} height={16} className="shrink-0 text-coral" />
            SSR International Airport
          </div>
        </div>

        <div className="hidden place-items-center pb-2.5 text-ink/40 sm:grid">
          <IconArrowRight width={18} height={18} />
        </div>

        {/* To — search the hotel */}
        <div className="relative">
          <label className="text-[12px] font-bold uppercase tracking-wide text-ink-muted" htmlFor="transfer-hotel-search">
            To — your hotel
          </label>
          <div className="mt-1 flex items-center gap-2 rounded-xl border border-ink/15 bg-cream/40 px-3.5 py-2.5 focus-within:border-teal">
            <IconSearch width={16} height={16} className="shrink-0 text-ink-muted" />
            <input
              id="transfer-hotel-search"
              role="combobox"
              aria-expanded={open && matches.length > 0}
              aria-controls="transfer-hotel-list"
              aria-autocomplete="list"
              autoComplete="off"
              value={q}
              placeholder="Search your hotel or resort…"
              onChange={(e) => {
                setQ(e.target.value);
                setOpen(true);
                setActive(0);
              }}
              onFocus={() => setOpen(true)}
              onBlur={() => {
                blurTimer.current = setTimeout(() => setOpen(false), 120);
              }}
              onKeyDown={onKeyDown}
              className="w-full bg-transparent text-sm font-medium text-ink outline-none placeholder:font-normal placeholder:text-ink-muted"
            />
          </div>

          {open && q.trim() !== '' && (
            <ul
              id="transfer-hotel-list"
              role="listbox"
              className="absolute z-20 mt-2 max-h-80 w-full overflow-auto rounded-xl border border-ink/10 bg-white py-1 shadow-xl"
            >
              {matches.length === 0 ? (
                <li className="px-4 py-3 text-[13px] text-ink-muted">
                  No match in our list.{' '}
                  <Link
                    href="/contact"
                    className="font-bold text-teal hover:text-teal-dark"
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    Message us for a quote
                  </Link>
                  .
                </li>
              ) : (
                matches.map((t, i) => (
                  <li key={t.slug} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      // onMouseDown (not onClick) so the navigation fires before the input's onBlur closes the list.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (blurTimer.current) clearTimeout(blurTimer.current);
                        go(t);
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                        i === active ? 'bg-teal/10' : 'hover:bg-ink/[0.03]'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-ink">{t.hotelName}</span>
                        <span className="block text-[12px] text-ink-muted">
                          {t.area} · {t.region} coast
                        </span>
                      </span>
                      <span className="shrink-0 text-[12.5px] font-extrabold text-ink">from €{t.fromPriceEur}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
