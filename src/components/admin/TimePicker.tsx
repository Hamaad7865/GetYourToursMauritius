'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Ref,
} from 'react';
import { IconClock } from '@/components/ui/icons';

/*
 * The back office's time picker — the companion to `DatePicker`, replacing the native
 * <input type="time"> whose popup is the unstyleable OS widget (and whose box Chrome draws taller than
 * every other field). Same visual language as the DatePicker: a field with a teal icon that opens an
 * anchored, non-modal popover, one teal fill for the selection, and the gliding highlight the DatePicker
 * takes from EasyUI (easyui.site, MIT) — plain CSS transforms, no animation library.
 *
 * Drop-in for a native time input: the value is the same 24-hour 'HH:MM' string ('' when unset).
 *
 * Two columns, hours then minutes. Picking an hour updates the field at once (minutes default to :00)
 * and moves focus to the minutes; picking a minute finishes and closes. Minutes step by 5, and a stored
 * off-step time (09:36) is listed in place so it is never silently rounded away.
 *
 * Keyboard: ArrowDown on the field opens it; Up/Down/Home/End move within a column, Enter or Space
 * picks, Tab moves between columns, Esc closes and returns focus to the field.
 */

/** One option row's height in px: the gliding highlight moves in these steps. */
const ROW = 32;

const pad = (n: number) => String(n).padStart(2, '0');

/** 'HH:MM' → parts, or null for '' / malformed (a bad stored value never throws). */
export function parseTime(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

/** The minute options: every `step`, plus the current minute if it falls between steps. */
export function minuteOptions(step: number, current: number | null): number[] {
  const list = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
  if (current !== null && !list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);

export function TimePicker({
  value,
  onChange,
  ariaLabel,
  className = '',
  minuteStep = 5,
  placeholder = '--:--',
}: {
  /** 'HH:MM' (24-hour) or '' — identical to a native time input's value. */
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  /** Trigger classes, ADDED to the field layout — pass the form's input class. */
  className?: string;
  minuteStep?: number;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseTime(value);
  // A minute picked before any hour waits here until the hour arrives.
  const [pendingMinute, setPendingMinute] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const minutesRef = useRef<HTMLDivElement>(null);

  // Close on an outside pointer or Escape — anchored, not modal, so it never traps the page.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setPendingMinute(null);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function pickHour(h: number) {
    onChange(`${pad(h)}:${pad(parsed?.m ?? pendingMinute ?? 0)}`);
    // Hand the keyboard on to the minutes, as a person reads the time: hour, then minute.
    requestAnimationFrame(() =>
      minutesRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(),
    );
  }

  function pickMinute(m: number) {
    if (!parsed) {
      setPendingMinute(m);
      return;
    }
    onChange(`${pad(parsed.h)}:${pad(m)}`);
    close();
  }

  const shownMinute = parsed?.m ?? pendingMinute;

  return (
    <div ref={wrapRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center gap-2 text-left ${className}`}
      >
        <span
          className={`min-w-0 flex-1 truncate tabular-nums ${parsed ? 'text-ink' : 'text-ink-soft'}`}
        >
          {parsed ? `${pad(parsed.h)}:${pad(parsed.m)}` : placeholder}
        </span>
        <IconClock width={16} height={16} aria-hidden="true" className="shrink-0 text-teal" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={ariaLabel ?? 'Choose a time'}
          className="absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[12.5rem] rounded-2xl border border-ink/10 bg-white p-2 shadow-[0_20px_56px_-16px_rgba(10,46,54,0.35)] motion-safe:animate-pop"
        >
          <div className="grid grid-cols-2 gap-1.5">
            <Column
              label="Hour"
              items={HOURS}
              selected={parsed?.h ?? null}
              onPick={pickHour}
              autoFocus
            />
            <Column
              ref={minutesRef}
              label="Min"
              items={minuteOptions(minuteStep, shownMinute)}
              selected={shownMinute}
              onPick={pickMinute}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between border-t border-ink/10 px-0.5 pt-1.5">
            {value ? (
              <button
                type="button"
                onClick={() => {
                  onChange('');
                  close();
                }}
                className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-coral-dark transition hover:bg-coral-tint"
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={close}
              className="rounded-lg px-2.5 py-1.5 text-[12.5px] font-bold text-teal-dark transition hover:bg-teal-tint"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One scrolling column of two-digit options, with the gliding highlight and roving focus. */
function Column({
  label,
  items,
  selected,
  onPick,
  autoFocus = false,
  ref,
}: {
  label: string;
  items: number[];
  selected: number | null;
  onPick: (n: number) => void;
  autoFocus?: boolean;
  ref?: Ref<HTMLDivElement>;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndex = selected === null ? -1 : items.indexOf(selected);
  // The keyboard cursor (roving tabindex) and the pointer: the highlight sits on the pointer, else
  // the cursor, and hides on the selected row, which has its own fill.
  const [active, setActive] = useState(Math.max(selectedIndex, 0));
  const [hover, setHover] = useState<number | null>(null);

  // Open with the selection in view (a third of the way down), and focus it if this column leads.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, Math.max(selectedIndex, 0) * ROW - ROW * 2);
    if (autoFocus)
      list.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true });
    // Mount only: re-centring on every pick would yank the list from under the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function moveTo(i: number) {
    const next = Math.min(Math.max(i, 0), items.length - 1);
    setActive(next);
    setHover(null);
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: items.length - 1,
      PageDown: active + 6,
      PageUp: active - 6,
    };
    if (e.key in moves) {
      e.preventDefault();
      moveTo(moves[e.key]!);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(items[active]!);
    }
  }

  // The cursor only shows in the column being worked: a parked cursor in the other column is noise.
  const [focused, setFocused] = useState(false);
  const glide = hover ?? (focused ? active : -1);
  const showGlide = glide >= 0 && glide !== selectedIndex;

  return (
    <div ref={ref}>
      <div
        aria-hidden="true"
        className="pb-1 text-center text-[10.5px] font-bold uppercase tracking-[0.04em] text-ink-muted"
      >
        {label}
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHover(null)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
        // No scrollbar (the OS one is a grey slab on Windows); a soft fade at both ends says "more".
        className="relative h-56 overflow-y-auto overscroll-contain rounded-xl [mask-image:linear-gradient(to_bottom,transparent,black_14px,black_calc(100%-14px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 h-8 rounded-lg bg-teal/10 transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none ${
            showGlide ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transform: `translateY(${Math.max(glide, 0) * ROW}px)` }}
        />
        {items.map((n, i) => {
          const isSelected = i === selectedIndex;
          return (
            <div
              key={n}
              role="option"
              aria-selected={isSelected}
              data-index={i}
              tabIndex={i === active ? 0 : -1}
              onClick={() => {
                setActive(i);
                onPick(n);
              }}
              onMouseEnter={() => setHover(i)}
              className={`relative grid h-8 cursor-pointer place-items-center rounded-lg text-[13px] tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal/40 ${
                isSelected
                  ? 'bg-teal font-extrabold text-white shadow-[0_4px_12px_rgba(14,140,146,.34)]'
                  : 'font-medium text-ink'
              }`}
            >
              {pad(n)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
