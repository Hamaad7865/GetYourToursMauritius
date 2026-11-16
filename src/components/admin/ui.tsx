import Link from 'next/link';
import type {
  CSSProperties,
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

/* The pieces that move (tabs, segmented, the section rail, the switch, status chips, KPIs, the
 * checklist, the error and loading states) live in ui-motion.tsx, a client module built on EasyUI's
 * components (easyui.site, MIT). They are re-exported here, so every screen imports from this file. */
export {
  AdminError,
  AdminLoading,
  Checklist,
  Kpi,
  SectionRail,
  Segmented,
  Skeleton,
  StatusChip,
  Switch,
  Tabs,
} from '@/components/admin/ui-motion';
export type { ChecklistItem, RailItem, StatusTone, TabItem } from '@/components/admin/ui-motion';
/** The dropdown (EasyUI spring-select + combobox search): a drop-in for a native select in every screen. */
export { AdminSelect } from '@/components/admin/AdminSelect';

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

/** EasyUI press-button: a pressed button gives a little (scale 0.97) and settles back. */
const BTN_BASE =
  'inline-flex items-center justify-center gap-[7px] rounded-lg border font-semibold leading-5 transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100';
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
  style,
}: {
  title?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  /** The accessible name when there is no visible title. */
  label?: string;
  children: ReactNode;
  className?: string;
  /** Inline custom properties (Today passes `--i`, its place in the staggered entrance). */
  style?: CSSProperties;
}) {
  return (
    <section
      aria-label={title ? undefined : label}
      style={style}
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
      <div
        className={`h-full rounded-[3px] transition-[width] duration-700 ease-out motion-reduce:transition-none ${BAR_TONE[tone]}`}
        style={{ width: `${pct}%` }}
      />
    </div>
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
        className={`w-full border-collapse text-[13px] [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[#FAFBFB] [&_th]:px-3 [&_th]:py-[9px] [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-ink-soft [&_tr:last-child>td]:border-b-0 [&_td]:transition-colors [&_td]:duration-150 [&_tbody>tr:hover>td]:bg-[#F7F9F9] motion-reduce:[&_td]:transition-none ${
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
    ? '[&>td]:border-t [&>td]:border-t-line [&>td]:!bg-[#FAFBFB] [&>td]:font-bold'
    : selected
      ? '[&>td]:!bg-[#EFF7F7]'
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
