'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { DIAL_CODES, type DialCode } from '@/lib/phone/dial-codes';

/*
 * The country calling-code picker for the phone field, shared by checkout and the account profile.
 *
 * It replaces a native <select> for two reasons the operator hit: a native option list cannot be
 * styled (so "🇲🇺 +230 Mauritius" overflowed and the flag fell back to bare "MU" letters), and it has
 * no search — scanning ~90 codes by eye is miserable. This is a button + a popover listbox with a
 * type-ahead filter; flags render through the bundled Twemoji font (.flag-emoji) on every platform.
 *
 * Controlled on the dial CODE alone (e.g. "+230"); the national digits live beside it. Keyboard:
 * ↑/↓ move, Enter selects, Esc closes and returns focus, and opening focuses the search box.
 */
export function DialCodeSelect({
  value,
  onChange,
  ariaLabel,
  buttonClassName,
}: {
  value: string;
  onChange: (code: string) => void;
  ariaLabel?: string;
  /** Overrides the trigger's classes so it can match a specific field's height/spacing. */
  buttonClassName?: string;
}) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = useMemo(
    () => DIAL_CODES.find((d) => d.code === value) ?? DIAL_CODES[0]!,
    [value],
  );

  // Filter on name OR code, tolerant of a typed "+" and of either half of a shared row
  // ("Réunion / Mayotte"). Order is preserved, so Mauritius and the source markets stay on top.
  const filtered = useMemo<readonly DialCode[]>(() => {
    const q = query.trim().toLowerCase().replace(/^\+/, '');
    if (!q) return DIAL_CODES;
    return DIAL_CODES.filter(
      (d) => d.name.toLowerCase().includes(q) || d.code.slice(1).includes(q),
    );
  }, [query]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    if (refocus) buttonRef.current?.focus();
  }, []);

  const choose = useCallback(
    (code: string) => {
      onChange(code);
      close(true);
    },
    [onChange, close],
  );

  // Opening: focus the search box and start the highlight on the current selection.
  useEffect(() => {
    if (!open) return;
    const idx = filtered.findIndex((d) => d.code === value);
    setActive(idx >= 0 ? idx : 0);
    const id = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(id);
    // Only when the panel opens — not on every keystroke (query change handles its own reset below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // A new filter result set: keep the highlight in range and pinned to the top.
  useEffect(() => {
    if (open) setActive(0);
  }, [query, open]);

  // Keep the highlighted row visible as the arrows move it.
  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Dismiss on an outside click / focus leaving the widget.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  function onListKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = filtered[active];
      if (hit) choose(hit.code);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActive(filtered.length - 1);
    }
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel ?? t('Country calling code')}
        className={
          buttonClassName ??
          'flex items-center gap-1.5 rounded-xl border border-ink/15 bg-white px-2.5 py-2.5 text-sm text-ink outline-none transition-colors hover:border-ink/30 focus:border-teal focus-visible:ring-2 focus-visible:ring-teal/30'
        }
      >
        <span className="flag-emoji text-[1.05rem]">{selected.flag}</span>
        <span className="tabular-nums">{selected.code}</span>
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          aria-hidden="true"
        >
          <path d="M5 7.5 10 12.5 15 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 top-[calc(100%+0.375rem)] z-50 w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-ink/12 bg-white shadow-[0_16px_48px_-12px_rgba(10,46,54,0.28)]"
          onKeyDown={onListKeyDown}
        >
          <div className="border-b border-ink/8 p-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Search country or code')}
              aria-label={t('Search country or code')}
              className="w-full rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm outline-none focus:border-teal"
            />
          </div>
          <ul
            id={listId}
            role="listbox"
            aria-label={ariaLabel ?? t('Country calling code')}
            className="max-h-64 overflow-y-auto overscroll-contain py-1"
          >
            {filtered.map((d, i) => {
              const isSelected = d.code === value;
              const isActive = i === active;
              return (
                <li key={d.code} role="option" aria-selected={isSelected}>
                  <button
                    ref={(el) => {
                      optionRefs.current[i] = el;
                    }}
                    type="button"
                    tabIndex={-1}
                    onClick={() => choose(d.code)}
                    onMouseMove={() => setActive(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? 'bg-teal/10' : ''
                    } ${isSelected ? 'font-semibold text-teal-dark' : 'text-ink'}`}
                  >
                    <span className="flag-emoji w-6 shrink-0 text-center text-[1.15rem]">
                      {d.flag}
                    </span>
                    <span className="w-14 shrink-0 tabular-nums text-ink-muted">{d.code}</span>
                    <span className="min-w-0 flex-1 truncate">{d.name}</span>
                    {isSelected && (
                      <svg
                        viewBox="0 0 20 20"
                        className="h-4 w-4 shrink-0 text-teal"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path
                          d="m5 10.5 3.5 3.5 6.5-8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-ink-muted">{t('No match')}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
