'use client';

import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { INSTANT, spring } from '@/components/admin/motion-tokens';

/* THE BACK OFFICE'S DROPDOWN: EasyUI's spring-select, with combobox's search for long lists
 * (easyui.site, MIT), in the brand tokens.
 *
 * A drop-in for a native <select>: same `value`, same `<option>` children, and `onChange` gets an
 * event whose `target.value` is the chosen value, so a screen swaps `<select>` for `<AdminSelect>` and
 * changes nothing else. Why not the native one: its open list is drawn by the OS (grey, unbranded, a
 * different look in every browser) and nothing can style it.
 *
 * How it behaves:
 * - The list springs open from the field and one highlight glides between options. More than
 *   SEARCH_FROM options and typing filters the list (accents and case ignored); fewer, and typing
 *   jumps to the first option that starts with what was typed, as a native select does.
 * - Focus never leaves the field: the list is announced through aria-activedescendant. That is what
 *   keeps it working inside the side panel and the pickers, whose Tab traps and Escape handlers
 *   listen on window. Escape here closes only the list and stops there.
 * - The list is portalled to <body> with fixed coordinates, so a scrolling dialog or a card with
 *   overflow hidden cannot clip it; it opens upward when there is no room below, and follows the field
 *   when the page scrolls. */

const SEARCH_FROM = 9;
const MAX_LIST_H = 320;

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
}

function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

function collect(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ children?: ReactNode; value?: unknown; disabled?: boolean }>;
    if (el.type === Fragment) {
      out.push(...collect(el.props.children));
      return;
    }
    if (el.type === 'option') {
      const label = textOf(el.props.children);
      out.push({
        value: el.props.value === undefined ? label : String(el.props.value),
        label,
        disabled: Boolean(el.props.disabled),
      });
    }
  });
  return out;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface AdminSelectProps {
  value: string | number;
  onChange: (e: ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  title?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

interface Place {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  above: boolean;
}

export function AdminSelect({
  value,
  onChange,
  children,
  className = '',
  disabled = false,
  id,
  title,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedby,
  'aria-invalid': ariaInvalid,
}: AdminSelectProps) {
  const reduce = useReducedMotion();
  const options = useMemo(() => collect(children), [children]);
  const current = String(value);
  const selected = options.find((o) => o.value === current) ?? null;
  const searchable = options.length >= SEARCH_FROM;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<Place | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ buf: '', at: 0 });
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-o${i}`;

  useEffect(() => setMounted(true), []);

  const shown = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = fold(query.trim());
    return options.filter((o) => fold(o.label).includes(q));
  }, [options, query, searchable]);

  const firstEnabled = (list: Opt[], from = 0, step = 1) => {
    for (let i = from; i >= 0 && i < list.length; i += step) if (!list[i]!.disabled) return i;
    return -1;
  };

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const aboveRoom = r.top - 12;
    const above = below < 220 && aboveRoom > below;
    const room = Math.max(140, above ? aboveRoom : below);
    const width = Math.max(r.width, 200);
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    setPlace({
      left,
      width,
      maxHeight: Math.min(MAX_LIST_H, room - 6),
      above,
      ...(above ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
    });
  }, []);

  const openList = useCallback(
    (initialQuery = '') => {
      if (disabled) return;
      measure();
      setQuery(initialQuery);
      const at = options.findIndex((o) => o.value === current);
      setActive(at >= 0 && !initialQuery ? at : Math.max(0, firstEnabled(options)));
      setOpen(true);
    },
    [disabled, measure, options, current],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const choose = useCallback(
    (opt: Opt | undefined) => {
      if (!opt || opt.disabled) return;
      close();
      triggerRef.current?.focus();
      if (opt.value === current) return;
      const target = { value: opt.value };
      onChange({ target, currentTarget: target } as unknown as ChangeEvent<HTMLSelectElement>);
    },
    [close, current, onChange],
  );

  // Follow the field while open; close on a pointer outside both the field and the list.
  useLayoutEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || listRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, measure, close]);

  // A new filter puts the highlight on its first match.
  useEffect(() => {
    if (open && query) setActive(Math.max(0, firstEnabled(shown)));
  }, [query, open, shown]);

  // Keep the highlighted option in view.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-i="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const move = (to: number, step: 1 | -1) => {
    if (shown.length === 0) return;
    const clamped = Math.min(Math.max(to, 0), shown.length - 1);
    const next = firstEnabled(shown, clamped, step);
    if (next >= 0) setActive(next);
  };

  const jumpTo = (ch: string) => {
    const now = Date.now();
    const t = typeahead.current;
    t.buf = now - t.at < 700 ? t.buf + ch : ch;
    t.at = now;
    const q = fold(t.buf);
    const i = shown.findIndex((o) => !o.disabled && fold(o.label).startsWith(q));
    if (i >= 0) setActive(i);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const printable = e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      } else if (printable) {
        e.preventDefault();
        if (searchable) openList(e.key);
        else {
          openList();
          jumpTo(e.key);
        }
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        // Closes the list only: not the panel or dialog it sits in (they listen on window).
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      case 'Tab':
        close();
        return;
      case 'ArrowDown':
        e.preventDefault();
        move(active + 1, 1);
        return;
      case 'ArrowUp':
        e.preventDefault();
        move(active - 1, -1);
        return;
      case 'PageDown':
        e.preventDefault();
        move(active + 8, 1);
        return;
      case 'PageUp':
        e.preventDefault();
        move(active - 8, -1);
        return;
      case 'Home':
        e.preventDefault();
        move(0, 1);
        return;
      case 'End':
        e.preventDefault();
        move(shown.length - 1, -1);
        return;
      case 'Enter':
        e.preventDefault();
        choose(shown[active]);
        return;
      case 'Backspace':
        if (searchable) {
          e.preventDefault();
          setQuery((q) => q.slice(0, -1));
        }
        return;
      case ' ':
        e.preventDefault();
        if (searchable && query) setQuery((q) => q + ' ');
        else choose(shown[active]);
        return;
    }
    if (printable) {
      e.preventDefault();
      if (searchable) setQuery((q) => q + e.key);
      else jumpTo(e.key);
    }
  };

  const shownLabel = selected?.label ?? options[0]?.label ?? '';
  const placeholder = selected ? selected.value === '' : true;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        title={title}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && shown[active] ? optId(active) : undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedby}
        aria-invalid={ariaInvalid || undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className={`${className} flex items-center gap-2 text-left`}
      >
        <span className={`min-w-0 flex-1 truncate ${placeholder ? 'text-ink-soft' : ''}`}>
          {shownLabel}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-ink-soft transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && place && (
              <motion.div
                ref={listRef}
                initial={reduce ? false : { opacity: 0, y: place.above ? 6 : -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={
                  reduce
                    ? { opacity: 0, transition: INSTANT }
                    : { opacity: 0, y: place.above ? 4 : -4, scale: 0.98 }
                }
                transition={reduce ? INSTANT : spring.responsive}
                // The field keeps focus: a press inside the list must not take it away. React events
                // bubble through a portal to the field's ancestors (a clickable row, a label), so a
                // click on an option stops here.
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed',
                  left: place.left,
                  width: place.width,
                  top: place.top,
                  bottom: place.bottom,
                }}
                className={`z-[90] flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-[0_16px_40px_-12px_rgba(10,46,54,0.35)] ${
                  place.above ? 'origin-bottom' : 'origin-top'
                }`}
              >
                {searchable && (
                  <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2 text-[13px]">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      aria-hidden="true"
                      className="shrink-0 text-ink-soft"
                    >
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3.5-3.5" />
                    </svg>
                    <span aria-hidden="true" className="min-w-0 flex-1 truncate">
                      {query ? (
                        <span className="font-medium text-ink">
                          {query}
                          <span className="ml-px inline-block h-3.5 w-px translate-y-0.5 animate-pulse bg-teal-dark" />
                        </span>
                      ) : (
                        <span className="text-ink-soft">Type to search</span>
                      )}
                    </span>
                    <span role="status" className="shrink-0 text-[11.5px] text-ink-soft">
                      {query ? `${shown.length} found` : ''}
                    </span>
                  </div>
                )}
                <div
                  id={listId}
                  role="listbox"
                  aria-label={ariaLabel}
                  className="overflow-y-auto overscroll-contain p-1.5"
                  style={{ maxHeight: place.maxHeight - (searchable ? 40 : 0) }}
                >
                  {shown.length === 0 && (
                    <div className="px-2.5 py-2 text-[13px] text-ink-soft">No matches</div>
                  )}
                  {shown.map((o, i) => {
                    const isSel = o.value === current;
                    const isActive = i === active;
                    return (
                      <div
                        key={`${o.value}-${i}`}
                        id={optId(i)}
                        data-i={i}
                        role="option"
                        aria-selected={isSel}
                        aria-disabled={o.disabled || undefined}
                        onMouseEnter={() => !o.disabled && setActive(i)}
                        onClick={() => choose(o)}
                        className={`relative isolate flex min-h-[34px] cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] ${
                          o.disabled
                            ? 'cursor-not-allowed text-ink-soft opacity-60'
                            : isSel
                              ? 'font-semibold text-teal-dark'
                              : 'font-medium text-ink'
                        }`}
                      >
                        <span className="min-w-0 flex-1">{o.label}</span>
                        {isSel && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                            className="shrink-0"
                          >
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        )}
                        {isActive && !o.disabled && (
                          <motion.span
                            aria-hidden="true"
                            layoutId={`${baseId}-hi`}
                            transition={reduce ? INSTANT : spring.snappy}
                            className={`absolute inset-0 -z-10 rounded-lg ${isSel ? 'bg-teal-tint' : 'bg-line-soft'}`}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
