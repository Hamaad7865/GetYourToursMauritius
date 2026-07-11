import type { ReactNode } from 'react';

/* Shared back-office form/card primitives, matching the handoff mockup's field styling
 * (#EAEEF0 cards, #E2E7EA inputs on #F7F8FA with a teal focus, Fraunces page headings).
 * Used across the admin screens so they stay visually consistent. */

export const INPUT_CLS =
  'w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted/70 focus:border-teal focus:bg-white';
export const SELECT_CLS =
  'w-full cursor-pointer rounded-xl border border-[#E2E7EA] bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-teal';
export const TEXTAREA_CLS =
  'w-full resize-y rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3 py-2.5 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-muted/70 focus:border-teal focus:bg-white';

/** Solid teal primary action. */
export const BTN_PRIMARY =
  'inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark disabled:opacity-50';
/** White, bordered secondary action. */
export const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-[#E2E7EA] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-50';

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
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-ink-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

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
    <section className={`rounded-2xl border border-[#EAEEF0] bg-white p-5 ${className}`}>
      {title && <h2 className="mb-3.5 text-[14px] font-extrabold text-ink">{title}</h2>}
      {children}
    </section>
  );
}

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
      <span className="mb-1.5 block text-[12.5px] font-bold text-ink/60">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-muted">{hint}</span>}
    </label>
  );
}

export function AdminError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mb-4 rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral"
    >
      {children}
    </p>
  );
}
