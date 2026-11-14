import Link from 'next/link';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { IconCheck } from '@/components/ui/icons';

/* The back office's shared look: design-reference/backoffice-redesign/bo.css, in Tailwind.
 *
 * Every piece here is presentational and hook-free: no data loading, no state, no effects. Two server
 * pages (the tour editor's new/edit routes) import AdminHeading from this file, so it stays a plain
 * module, never 'use client' (a server page importing BTN_* from a client module would get a reference,
 * not the class string). A piece that ever needs a hook belongs in a 'use client' file beside it.
 *
 * The pieces that take a handler (Switch, Segmented, Tabs and SectionRail in button mode, ListRow with
 * onClick) can only be rendered from a client component: a server page cannot pass a function. Every
 * admin screen is a client component today, so this only bites a new server page.
 *
 * Contrast (WCAG 2.1 AA): text, links and filled buttons use teal-dark (#0B5C63), never the brand teal
 * (#0E8C92 is 4.05:1, short of 4.5 for small text and for white on it). Problems use coral-dark. Teal,
 * gold-light and coral appear only as fills: bars and dots, never words.
 *
 * Utility families matter here. Screens append overrides (`${INPUT_CLS} text-right`,
 * `${inputClass} py-1 text-[12px]`), so each base string sets size with padding and `min-h-*`, never a
 * fixed `h-*` that an appended class could not undo. `inputClass` also sits on textareas. */

/* ─── Controls ─────────────────────────────────────────────────────────────────────────────── */

/** A text input: 36px tall (13px text on a 20px line, 7px padding, 1px hairline), 8px radius. */
export const INPUT_CLS =
  'w-full min-w-0 rounded-lg border border-line bg-white px-2.5 py-[7px] text-[13px] font-medium leading-5 text-ink outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-ink-soft focus:border-teal-dark focus:ring-[3px] focus:ring-teal-dark/20 disabled:cursor-not-allowed disabled:bg-ground disabled:text-ink-muted motion-reduce:transition-none';
export const SELECT_CLS =
  'w-full min-w-0 cursor-pointer rounded-lg border border-line bg-white px-2.5 py-[7px] text-[13px] font-medium leading-5 text-ink outline-none transition-[border-color,box-shadow] focus:border-teal-dark focus:ring-[3px] focus:ring-teal-dark/20 disabled:cursor-not-allowed disabled:bg-ground disabled:text-ink-muted motion-reduce:transition-none';
export const TEXTAREA_CLS =
  'w-full min-w-0 resize-y rounded-lg border border-line bg-white px-2.5 py-[9px] text-[13px] font-medium leading-normal text-ink outline-none transition-[border-color,box-shadow] placeholder:font-normal placeholder:text-ink-soft focus:border-teal-dark focus:ring-[3px] focus:ring-teal-dark/20 disabled:cursor-not-allowed disabled:bg-ground disabled:text-ink-muted motion-reduce:transition-none';

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger' | 'dark' | 'ai';
export type ButtonSize = 'md' | 'sm';

const BTN_BASE =
  'inline-flex items-center justify-center gap-[7px] rounded-lg border font-semibold leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none';
/** md = 36px (`.btn`), sm = 30px (`.btn.sm`). min-h, not h: a long label may wrap on a phone. */
const BTN_SIZE: Record<ButtonSize, string> = {
  md: 'min-h-9 px-[13px] py-[7px] text-[13px]',
  sm: 'min-h-[30px] px-2.5 py-1 text-[12px]',
};
const BTN_VARIANT: Record<ButtonVariant, string> = {
  /** One per screen: the thing the screen is for. */
  primary: 'border-teal-dark bg-teal-dark text-white hover:border-ink hover:bg-ink',
  /** The default: white, hairline border. The top bar's "New" is this one. */
  ghost: 'border-line bg-white text-ink hover:border-[#C2CED1] hover:bg-[#FAFBFB]',
  /** No border, for low-weight actions inside a card header or a row. */
  quiet: 'border-transparent bg-transparent text-ink-muted hover:bg-line-soft hover:text-ink',
  /** A destructive action that is not the screen's main one. */
  danger: 'border-line bg-white text-coral-dark hover:border-coral-dark/40 hover:bg-coral-tint',
  dark: 'border-ink bg-ink text-white hover:border-ink-raised hover:bg-ink-raised',
  /** The assistant's own actions (violet = Gemini), never anything else. */
  ai: 'border-[#D9D0F5] bg-violet-tint text-violet-dark hover:border-violet-dark/40',
};

/** The class for a button or a link drawn as one. */
export function buttonClass(variant: ButtonVariant = 'ghost', size: ButtonSize = 'md'): string {
  return `${BTN_BASE} ${BTN_SIZE[size]} ${BTN_VARIANT[variant]}`;
}

/** Solid teal-dark primary action (white on #0B5C63 is 7.71:1). */
export const BTN_PRIMARY = buttonClass('primary');
/** White, bordered secondary action. */
export const BTN_GHOST = buttonClass('ghost');

/* ─── Page structure ───────────────────────────────────────────────────────────────────────── */

export function AdminHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2.5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-[1.2] tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-[3px] text-[13px] text-ink-soft">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/** A white card: 1px hairline, 12px radius, no shadow, padded. */
export function Card({
  title,
  children,
  className = '',
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-xl border border-line bg-white p-4 ${className}`}>
      {title && <h2 className="mb-3 text-[13.5px] font-bold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

/**
 * A card whose body sits flush (a table, a list of rows), under an optional header row: title, a quiet
 * count or note, and actions on the right (`.card` + `.ch`). Pad free text inside with PANEL_BODY.
 */
export function Panel({
  title,
  meta,
  actions,
  label,
  children,
  className = '',
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** The accessible name when there is no visible title. */
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={title ? undefined : label}
      className={`min-w-0 rounded-xl border border-line bg-white ${className}`}
    >
      {(title || meta || actions) && (
        <div className="flex min-h-[46px] flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line-soft px-4 py-2">
          {title && <h2 className="text-[13.5px] font-bold text-ink">{title}</h2>}
          {meta && <span className="text-[12px] text-ink-soft">{meta}</span>}
          {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
/** The padding of a card body (`.cb`), for free text inside a Panel. */
export const PANEL_BODY = 'px-4 py-3.5';

/**
 * A list beside its detail (`.gl`): the list takes the room, the detail a 400px column. Stacks below
 * xl, where 400px would leave the list too narrow (and the assistant column may be open too). With no
 * detail, the list is full width. The detail is an `aside` named by `detailLabel`.
 */
export function SplitView({
  list,
  detail,
  detailLabel,
  className = '',
}: {
  list: ReactNode;
  detail?: ReactNode;
  detailLabel: string;
  className?: string;
}) {
  return (
    <div
      className={`grid items-start gap-3.5 ${detail ? 'xl:grid-cols-[minmax(0,1fr)_400px]' : ''} ${className}`}
    >
      <div className="min-w-0">{list}</div>
      {detail && (
        <aside aria-label={detailLabel} className="min-w-0">
          {detail}
        </aside>
      )}
    </div>
  );
}

/**
 * One row of a list inside a card (`.li`): something on the left (an icon, an avatar), a title with a
 * line of detail under it, and something on the right. Rows divide themselves, so render them as direct
 * siblings. With `href` the row is a link, with `onClick` a button; then `trailing` must hold nothing
 * interactive (a control inside a link is invalid). A row with its own buttons takes neither.
 */
export function ListRow({
  leading,
  title,
  meta,
  trailing,
  href,
  onClick,
  selected = false,
  className = '',
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  href?: string;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
}) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold text-ink">{title}</span>
        {meta && <span className="block truncate text-[12px] text-ink-soft">{meta}</span>}
      </span>
      {trailing}
    </>
  );
  const interactive = Boolean(href || onClick);
  const cls = `flex w-full items-center gap-3 border-b border-line-soft px-4 py-[11px] text-left last:border-b-0 ${
    selected ? 'bg-[#EFF7F7]' : interactive ? 'hover:bg-[#FAFBFB]' : ''
  } ${interactive ? 'transition-colors motion-reduce:transition-none' : ''} ${className}`;
  const current = selected ? ('true' as const) : undefined;
  if (href) {
    return (
      <Link href={href} aria-current={current} className={cls}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-current={current} className={cls}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/* ─── Status and figures ───────────────────────────────────────────────────────────────────── */

export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'ai' | 'neutral';

const CHIP_TONE: Record<StatusTone, string> = {
  ok: 'bg-teal-tint text-teal-dark',
  warn: 'bg-gold-tint text-gold-dark',
  bad: 'bg-coral-tint text-coral-dark',
  info: 'bg-blue-tint text-blue-dark',
  ai: 'bg-violet-tint text-violet-dark',
  neutral: 'bg-line-soft text-ink-muted',
};

/**
 * A status as a small chip with a dot (`.st`). The words carry the meaning and the colour backs them
 * up, never the other way round: ok = done or paid, warn = waiting or part paid, bad = a problem,
 * info = informational (refunded), ai = the assistant, neutral = no state yet.
 */
export function StatusChip({
  tone = 'neutral',
  children,
  className = '',
}: {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12px] font-semibold ${CHIP_TONE[tone]} ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
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
        {value}
      </span>
      {detail && <span className="text-[12px] text-ink-soft">{detail}</span>}
    </>
  );
  const cls = `flex min-w-0 flex-col gap-[3px] rounded-xl border border-line bg-white px-4 py-3.5 ${className}`;
  return href ? (
    <Link
      href={href}
      className={`${cls} transition-colors hover:border-[#C2CED1] motion-reduce:transition-none`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export type BarTone = 'teal' | 'gold' | 'coral';
const BAR_TONE: Record<BarTone, string> = {
  teal: 'bg-teal',
  gold: 'bg-gold-light',
  coral: 'bg-coral',
};

/**
 * A thin bar (`.bar`): seats taken, a checklist's progress. Give `label` and it is a progressbar a
 * screen reader can read; leave it out when the figure is printed beside it and the bar is decoration.
 */
export function ProgressBar({
  value,
  max = 100,
  tone = 'teal',
  label,
  className = '',
}: {
  value: number;
  max?: number;
  tone?: BarTone;
  label?: string;
  className?: string;
}) {
  const pct =
    max > 0 && Number.isFinite(value) ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const a11y = label
    ? {
        role: 'progressbar' as const,
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': max,
        'aria-valuenow': value,
      }
    : { 'aria-hidden': true as const };
  return (
    <div
      {...a11y}
      className={`h-1.5 min-w-10 overflow-hidden rounded-[3px] bg-[#E3E9EB] ${className}`}
    >
      <div className={`h-full rounded-[3px] ${BAR_TONE[tone]}`} style={{ width: `${pct}%` }} />
    </div>
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
 * Underline tabs (`.tabs`). Two kinds, deliberately not the ARIA tablist pattern:
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
  const asLinks = items.length > 0 && items.every((item) => item.href);
  const tabCls = (on: boolean) =>
    `-mb-px inline-flex items-center whitespace-nowrap border-b-2 py-[9px] text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
      on ? 'border-teal-dark text-ink' : 'border-transparent text-ink-soft hover:text-ink'
    }`;
  const count = (item: TabItem) =>
    item.count === undefined ? null : (
      <span className="ml-1.5 rounded-lg bg-line-soft px-1.5 py-px text-[11px] font-bold text-ink-muted">
        {item.count}
      </span>
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
              {item.label}
              {count(item)}
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
            {item.label}
            {count(item)}
          </button>
        );
      })}
    </div>
  );
}

/** A segmented control (`.seg`): a few mutually exclusive choices, the chosen one `aria-pressed`. */
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
            className={`h-7 whitespace-nowrap rounded-[7px] px-[11px] text-[12px] font-semibold transition-colors disabled:cursor-not-allowed motion-reduce:transition-none ${
              wide ? 'flex-1' : ''
            } ${on ? 'bg-white text-ink shadow-[0_1px_2px_rgba(10,46,54,0.14)]' : `text-ink-muted ${disabled ? '' : 'hover:text-ink'}`}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
 * A vertical list of an editor's sections (`.rl`), the current one marked `aria-current` and tinted.
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
  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const on = item.id === active;
          const cls = `flex min-h-[34px] w-full items-center gap-[9px] rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors motion-reduce:transition-none ${
            on ? 'bg-teal-tint text-teal-dark' : 'text-ink-muted hover:bg-line-soft hover:text-ink'
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

/**
 * An on/off switch (`.sw`): a real button, `aria-pressed` carrying the state and `label` its name.
 * The off track is darker than bo.css's #B9C5C8 (1.77:1 on white) so the control clears the 3:1
 * non-text contrast AA asks of it.
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
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-[34px] shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none ${
        checked ? 'bg-teal-dark' : 'bg-[#7D8F94]'
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${
          checked ? 'translate-x-3.5' : 'translate-x-0'
        }`}
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
            className={`mt-0.5 inline-grid h-4 w-4 shrink-0 place-items-center rounded border-[1.5px] ${
              item.done ? 'border-teal-dark bg-teal-dark text-white' : 'border-[#7D8F94] bg-white'
            }`}
          >
            {item.done && <IconCheck width={11} height={11} strokeWidth={3} />}
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

/* ─── Tables ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A data table (`.tbl`) in its own horizontal scroll box, so a wide table scrolls on a phone instead
 * of pushing the page sideways. Header and cell styling comes from here, so a plain `<th>`/`<td>`
 * inside picks it up; use Th/Td for right-aligned figures and Tr for a selected or totals row.
 */
export function DataTable({
  children,
  dense = false,
  label,
  className = '',
}: {
  children: ReactNode;
  /** Tighter rows (`.tbl.c`). */
  dense?: boolean;
  /** The accessible name, when no visible heading names the table. */
  label?: string;
  className?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        aria-label={label}
        className={`w-full border-collapse text-[13px] [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[#FAFBFB] [&_th]:px-3 [&_th]:py-[9px] [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-ink-soft [&_tr:last-child>td]:border-b-0 ${
          dense ? '[&_td]:py-[7px]' : '[&_td]:py-2.5'
        } ${className}`}
      >
        {children}
      </table>
    </div>
  );
}

/** A column header: `scope="col"` by default, `num` right-aligns it over a column of figures. */
export function Th({
  num = false,
  className = '',
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return (
    <th scope="col" {...rest} className={`${num ? 'text-right' : 'text-left'} ${className}`} />
  );
}

/** A cell; `num` right-aligns a figure and keeps it on one line. */
export function Td({
  num = false,
  className = '',
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  return <td {...rest} className={`${num ? 'whitespace-nowrap text-right' : ''} ${className}`} />;
}

/** A row: `selected` tints it (the row whose detail is open), `total` is the bold footer row. */
export function Tr({
  selected = false,
  total = false,
  className = '',
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; total?: boolean }) {
  const tone = total
    ? '[&>td]:border-t [&>td]:border-t-line [&>td]:bg-[#FAFBFB] [&>td]:font-bold'
    : selected
      ? '[&>td]:bg-[#EFF7F7]'
      : '';
  return (
    <tr aria-current={selected ? 'true' : undefined} {...rest} className={`${tone} ${className}`} />
  );
}

/* ─── Forms and messages ───────────────────────────────────────────────────────────────────── */

/** A labelled form field. Wrap an input/select/textarea (the label is associated via wrapping). */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-[5px] block text-[12px] font-semibold text-ink-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-ink-soft">{hint}</span>}
    </label>
  );
}

/** A problem, announced (`role="alert"`): coral-dark on its tint, 5.2:1. */
export function AdminError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-4 rounded-lg bg-coral-tint px-3 py-2.5 text-[13px] font-medium text-coral-dark"
    >
      {children}
    </p>
  );
}
