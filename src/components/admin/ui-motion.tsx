'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'framer-motion';
import { INSTANT, spring } from '@/components/admin/motion-tokens';

/* The back office's pieces that MOVE, ported from EasyUI (easyui.site, MIT) and re-skinned in the
 * brand tokens. ui.tsx re-exports every one of these, so screens keep importing from
 * '@/components/admin/ui' and never notice the split. It exists because ui.tsx must stay a plain
 * module (server pages import its class strings), and anything with a hook needs 'use client'.
 *
 * What each piece took from EasyUI:
 * - Tabs, Segmented, SectionRail: one indicator that glides between items (animated-tabs / sidebar),
 *   instead of each item switching its own border or fill.
 * - Switch: the thumb stretches while pressed and springs across (stretch-switch).
 * - StatusChip and tab counts: a changed word or number rolls in (badge).
 * - Kpi: the figure counts up to its value (stat-card).
 * - Checklist: the tick draws itself (draw-checkbox).
 * - AdminError: the message settles in with an icon (alert).
 * - Skeleton / AdminLoading: a light sweep and calm dots for "still loading" (skeleton / loader).
 *
 * What stayed ours, and must: the semantics the a11y tests pin (aria-pressed buttons, link tabs with
 * aria-current, role="alert"), and the AA colours (teal-dark text and fills, coral-dark problems).
 * EasyUI's own greys are not used anywhere. With reduced motion every indicator still moves to the
 * right place, instantly. */

/* ─── Rolling text ─────────────────────────────────────────────────────────────────────────── */

/** A string or number that rolls up when it changes (EasyUI badge). Anything else renders as is. */
function Roll({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  if (typeof children !== 'string' && typeof children !== 'number') return <>{children}</>;
  return (
    <span className="relative inline-flex overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={String(children)}
          initial={reduce ? false : { y: '70%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={reduce ? { opacity: 0, transition: INSTANT } : { y: '-70%', opacity: 0 }}
          transition={reduce ? INSTANT : spring.roll}
          className="inline-block tabular-nums"
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ─── Switching views ──────────────────────────────────────────────────────────────────────── */

export interface TabItem {
  id: string;
  label: string;
  /** A count beside the label ("Awaiting payment 3"). */
  count?: number;
  /** A route or a query-string view. Tabs with an href are links. */
  href?: string;
}

/**
 * Underline tabs (`.tabs`), the underline one teal-dark bar that glides to the chosen tab. Two kinds,
 * deliberately not the ARIA tablist pattern:
 * - items with `href` are links in a `nav`, the current one `aria-current="page"` (a route per tab,
 *   which is how two screens become one while each keeps its own route and permission);
 * - items without are buttons that call `onSelect`, the current one `aria-pressed` (a filter over the
 *   same list, such as a saved view).
 */
export function Tabs({
  items,
  active,
  onSelect,
  label,
  className = '',
}: {
  items: readonly TabItem[];
  active: string;
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const layoutId = `bo-tab-${useId()}`;
  const asLinks = items.length > 0 && items.every((item) => item.href);
  const tabCls = (on: boolean) =>
    `relative -mb-px inline-flex items-center whitespace-nowrap py-[9px] text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
      on ? 'text-ink' : 'text-ink-soft hover:text-ink'
    }`;
  const inner = (item: TabItem, on: boolean) => (
    <>
      {item.label}
      {item.count !== undefined && (
        <span
          className={`ml-1.5 inline-flex rounded-lg px-1.5 py-px text-[11px] font-bold transition-colors motion-reduce:transition-none ${
            on ? 'bg-teal-tint text-teal-dark' : 'bg-line-soft text-ink-muted'
          }`}
        >
          <Roll>{item.count}</Roll>
        </span>
      )}
      {on && (
        <motion.span
          aria-hidden="true"
          layoutId={layoutId}
          transition={reduce ? INSTANT : spring.morph}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-dark"
        />
      )}
    </>
  );
  const wrap = `flex flex-wrap gap-x-5 border-b border-line ${className}`;

  if (asLinks) {
    return (
      <nav aria-label={label} className={wrap}>
        {items.map((item) => {
          const on = item.id === active;
          return (
            <Link
              key={item.id}
              href={item.href as string}
              aria-current={on ? 'page' : undefined}
              className={tabCls(on)}
            >
              {inner(item, on)}
            </Link>
          );
        })}
      </nav>
    );
  }
  return (
    <div role="group" aria-label={label} className={wrap}>
      {items.map((item) => {
        const on = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            aria-pressed={on}
            onClick={() => onSelect?.(item.id)}
            className={tabCls(on)}
          >
            {inner(item, on)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A segmented control (`.seg`): a few mutually exclusive choices, the chosen one `aria-pressed`, with
 * one white pill that glides under the choice. The label comes first inside each button and the pill
 * after it, drawn behind (`isolate` + `-z-10`), so the button's text node stays its first child.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  wide = false,
  disabled = false,
  className = '',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Stretch to the container, each choice an equal share (`.seg.wide`). */
  wide?: boolean;
  /** Shows the choice but locks it (a setting that can no longer change). */
  disabled?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const layoutId = `bo-seg-${useId()}`;
  return (
    <div
      role="group"
      aria-label={label}
      className={`${wide ? 'flex' : 'inline-flex'} gap-0.5 rounded-[9px] bg-[#E6EBED] p-[3px] ${className}`}
    >
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`relative isolate h-7 whitespace-nowrap rounded-[7px] px-[11px] text-[12px] font-semibold transition-colors disabled:cursor-not-allowed motion-reduce:transition-none ${
              wide ? 'flex-1' : ''
            } ${on ? 'text-ink' : `text-ink-muted ${disabled ? '' : 'hover:text-ink'}`}`}
          >
            {option.label}
            {on && (
              <motion.span
                aria-hidden="true"
                layoutId={layoutId}
                transition={reduce ? INSTANT : spring.morph}
                className="absolute inset-0 -z-10 rounded-[7px] bg-white shadow-[0_1px_2px_rgba(10,46,54,0.14)]"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'ai' | 'neutral';

export interface RailItem {
  id: string;
  label: string;
  /** A route per section. Without one the item is a button that calls `onSelect`. */
  href?: string;
  /** A completeness dot (`.dotk`); its meaning is also read out, so the dot is never colour alone. */
  status?: StatusTone;
  /** Overrides the words read out for the status. */
  statusLabel?: string;
  /** A quiet note on the right, such as a count. */
  meta?: ReactNode;
}

const RAIL_DOT: Record<StatusTone, string> = {
  ok: 'bg-teal',
  warn: 'bg-gold-light',
  bad: 'bg-coral',
  info: 'bg-blue-dark',
  ai: 'bg-violet-dark',
  neutral: 'bg-[#B9C5C8]',
};
const RAIL_STATUS_TEXT: Record<StatusTone, string> = {
  ok: 'complete',
  warn: 'needs attention',
  bad: 'has a problem',
  info: 'note',
  ai: 'assistant',
  neutral: 'not started',
};

/**
 * A vertical list of an editor's sections (`.rl`), the current one marked `aria-current`, with a
 * teal tint that glides to it (EasyUI sidebar).
 */
export function SectionRail({
  items,
  active,
  onSelect,
  label,
  className = '',
}: {
  items: readonly RailItem[];
  active: string;
  onSelect?: (id: string) => void;
  label: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const layoutId = `bo-rail-${useId()}`;
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const on = item.id === active;
          const cls = `relative isolate flex min-h-[34px] w-full items-center gap-[9px] rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
            on ? 'text-teal-dark' : 'text-ink-muted hover:bg-line-soft hover:text-ink'
          }`;
          const inner = (
            <>
              {item.status && (
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${RAIL_DOT[item.status]}`}
                />
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.status && (
                <span className="sr-only">
                  , {item.statusLabel ?? RAIL_STATUS_TEXT[item.status]}
                </span>
              )}
              {item.meta !== undefined && (
                <span className="ml-auto text-[11px] font-semibold text-ink-soft">{item.meta}</span>
              )}
              {on && (
                <motion.span
                  aria-hidden="true"
                  layoutId={layoutId}
                  transition={reduce ? INSTANT : spring.morph}
                  className="absolute inset-0 -z-10 rounded-lg bg-teal-tint"
                />
              )}
            </>
          );
          return (
            <li key={item.id}>
              {item.href ? (
                <Link href={item.href} aria-current={on ? 'page' : undefined} className={cls}>
                  {inner}
                </Link>
              ) : (
                <button
                  type="button"
                  aria-current={on ? 'true' : undefined}
                  onClick={() => onSelect?.(item.id)}
                  className={cls}
                >
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ─── Inputs with state ────────────────────────────────────────────────────────────────────── */

/** Track 34px, thumb 16px, 2px inset each side: the thumb travels 14px. */
const SWITCH_TRAVEL = 14;

/**
 * An on/off switch (`.sw`, EasyUI stretch-switch): a real button, `aria-pressed` carrying the state
 * and `label` its name. While pressed the thumb stretches; on release it springs to its side. The off
 * track is darker than bo.css's #B9C5C8 (1.77:1 on white) so the control clears the 3:1 non-text
 * contrast AA asks of it.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  className = '',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const stretched = pressed && !disabled && !reduce;
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerCancel={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
        checked ? 'bg-teal-dark' : 'bg-[#7D8F94]'
      } ${className}`}
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{
          x: checked ? SWITCH_TRAVEL : 0,
          scaleX: stretched ? 1.18 : 1,
          scaleY: stretched ? 0.86 : 1,
        }}
        transition={reduce ? INSTANT : spring.snappy}
        className="absolute left-0.5 top-0.5 h-4 w-4 origin-center rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

export interface ChecklistItem {
  id?: string;
  label: ReactNode;
  done: boolean;
  hint?: ReactNode;
}

/** A tick that draws itself (EasyUI draw-checkbox). */
function DrawnTick() {
  const reduce = useReducedMotion();
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <motion.path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={reduce ? INSTANT : { duration: 0.32, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
      />
    </svg>
  );
}

/**
 * A read-only checklist ("before it goes live"): a box ticked or not, the words beside it, and the
 * state read out ("Done" / "To do") so it never rests on the tick alone.
 */
export function Checklist({
  items,
  label,
  className = '',
}: {
  items: readonly ChecklistItem[];
  label: string;
  className?: string;
}) {
  return (
    <ul aria-label={label} className={`flex flex-col gap-2 ${className}`}>
      {items.map((item, i) => (
        <li key={item.id ?? i} className="flex items-start gap-2.5 text-[13px]">
          <span
            aria-hidden="true"
            className={`mt-0.5 inline-grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] transition-colors duration-200 motion-reduce:transition-none ${
              item.done ? 'border-teal-dark bg-teal-dark text-white' : 'border-[#7D8F94] bg-white'
            }`}
          >
            {item.done && <DrawnTick />}
          </span>
          <span className="min-w-0">
            <span className="sr-only">{item.done ? 'Done: ' : 'To do: '}</span>
            <span className={item.done ? 'text-ink' : 'font-semibold text-ink'}>{item.label}</span>
            {item.hint && <span className="block text-[11.5px] text-ink-soft">{item.hint}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/* ─── Status and figures ───────────────────────────────────────────────────────────────────── */

const CHIP_TONE: Record<StatusTone, string> = {
  ok: 'bg-teal-tint text-teal-dark',
  warn: 'bg-gold-tint text-gold-dark',
  bad: 'bg-coral-tint text-coral-dark',
  info: 'bg-blue-tint text-blue-dark',
  ai: 'bg-violet-tint text-violet-dark',
  neutral: 'bg-line-soft text-ink-muted',
};

/**
 * A status as a small chip with a dot (`.st`, EasyUI badge): when the words change ("Pending" →
 * "Paid") they roll in. The words carry the meaning and the colour backs them up, never the other way
 * round: ok = done or paid, warn = waiting or part paid, bad = a problem, info = informational
 * (refunded), ai = the assistant, neutral = no state yet. `pulse` pings the dot, for a live state only.
 */
export function StatusChip({
  tone = 'neutral',
  pulse = false,
  children,
  className = '',
}: {
  tone?: StatusTone;
  pulse?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-semibold transition-colors duration-200 motion-reduce:transition-none ${CHIP_TONE[tone]} ${className}`}
    >
      <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
        {pulse && (
          <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-60 motion-reduce:animate-none" />
        )}
        <span className="relative h-1.5 w-1.5 rounded-full bg-current" />
      </span>
      <Roll>{children}</Roll>
    </span>
  );
}

/** "€1,234.50" → its prefix, number and suffix, so the number part can count; null if not a figure. */
export function splitFigure(
  text: string,
): { prefix: string; value: number; decimals: number; grouped: boolean; suffix: string } | null {
  const m = /^([^\d-]*)(-?\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(text);
  if (!m) return null;
  const digits = m[2]!;
  const value = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return {
    prefix: m[1]!,
    value,
    decimals: digits.includes('.') ? digits.split('.')[1]!.length : 0,
    grouped: digits.includes(','),
    suffix: m[3]!,
  };
}

/**
 * A figure that counts up to its value when it first shows and when it changes (EasyUI stat-card /
 * animated-number). The server renders the final text, so the number is right before any script
 * runs; only a plain string or number counts, anything else renders as given.
 */
function CountUp({ value }: { value: ReactNode }) {
  const reduce = useReducedMotion();
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : null;
  const fig = text === null ? null : splitFigure(text);
  const mv = useMotionValue(fig?.value ?? 0);
  const last = useRef<number | null>(null);
  const shown = useTransform(mv, (n) => {
    if (!fig) return '';
    if (n === fig.value) return text as string;
    const body = n.toLocaleString('en-GB', {
      minimumFractionDigits: fig.decimals,
      maximumFractionDigits: fig.decimals,
      useGrouping: fig.grouped,
    });
    return `${fig.prefix}${body}${fig.suffix}`;
  });
  const target = fig?.value;

  useEffect(() => {
    if (target === undefined) return;
    const from = last.current ?? 0;
    last.current = target;
    if (reduce || from === target) {
      mv.set(target);
      return;
    }
    mv.set(from);
    const controls = animate(mv, target, { duration: 0.9, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [target, reduce, mv]);

  if (!fig) return <>{value}</>;
  return <motion.span className="tabular-nums">{shown}</motion.span>;
}

/** A headline figure (`.kpi`): label, value, a line of context. With `href` the whole card links. */
export function Kpi({
  label,
  value,
  detail,
  href,
  className = '',
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <span className="text-[12px] font-semibold text-ink-soft">{label}</span>
      <span className="text-[26px] font-bold leading-[1.15] tracking-[-0.02em] text-ink">
        <CountUp value={value} />
      </span>
      {detail && <span className="text-[12px] text-ink-soft">{detail}</span>}
    </>
  );
  const cls = `flex min-w-0 flex-col gap-[3px] rounded-xl border border-line bg-white px-4 py-3.5 ${className}`;
  return href ? (
    <Link
      href={href}
      className={`${cls} transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-[#C2CED1] hover:shadow-[0_8px_20px_-14px_rgba(10,46,54,0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/* ─── Messages and loading ─────────────────────────────────────────────────────────────────── */

/** A problem, announced (`role="alert"`, EasyUI alert): coral-dark on its tint, 5.2:1. */
export function AdminError({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      role="alert"
      initial={reduce ? false : { opacity: 0, y: -4, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={reduce ? INSTANT : spring.gentle}
      className="mb-4 flex items-start gap-2 rounded-lg bg-coral-tint px-3 py-2.5 text-[13px] font-medium text-coral-dark"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-px shrink-0"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5" />
        <path d="M12 16.2h.01" />
      </svg>
      <div className="min-w-0">{children}</div>
    </motion.div>
  );
}

/**
 * A placeholder block with a soft light sweep (EasyUI skeleton). Decoration: the screen says what is
 * loading in words (AdminLoading), so every skeleton is hidden from screen readers.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block overflow-hidden rounded-md bg-line-soft before:absolute before:inset-0 before:-translate-x-full before:animate-bo-sweep before:bg-gradient-to-r before:from-transparent before:via-white/70 before:to-transparent motion-reduce:before:hidden ${className}`}
    />
  );
}

/**
 * "Loading…" for a screen or a card (EasyUI loader, the calm three-dot mode, plus skeleton rows): the
 * words are read out (`role="status"`), the dots and rows are decoration. `rows` draws that many
 * skeleton lines under the label, for a list that is about to appear.
 */
export function AdminLoading({
  label = 'Loading…',
  rows = 0,
  className = '',
}: {
  label?: string;
  rows?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <div role="status" className={`py-1 ${className}`}>
      <span className="inline-flex items-center gap-2 text-[13px] text-ink-soft">
        <span aria-hidden="true" className="inline-flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-teal-dark"
              initial={false}
              animate={reduce ? { opacity: 0.6 } : { opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
              transition={
                reduce
                  ? INSTANT
                  : { duration: 1.1, repeat: Infinity, delay: i * 0.16, ease: 'easeInOut' }
              }
            />
          ))}
        </span>
        {label}
      </span>
      {rows > 0 && (
        <span aria-hidden="true" className="mt-3 flex flex-col gap-2.5">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton
              key={i}
              className={`h-3.5 ${i % 3 === 2 ? 'w-3/5' : i % 2 ? 'w-4/5' : 'w-full'}`}
            />
          ))}
        </span>
      )}
    </div>
  );
}
