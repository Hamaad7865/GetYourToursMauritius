import type { ReactNode } from 'react';

/**
 * The photography studio's design kit — the customer site's visual language applied to the
 * back office: white cards on `rounded-card` with a soft offset shadow, teal pill actions,
 * caps section labels, coral reserved for warnings/danger, gold for highlights. Local to the
 * photography screens on purpose; the shared admin/ui.tsx primitives stay as they are for the
 * other admin screens.
 */

export const P_CARD =
  'rounded-card border border-ink/10 bg-white shadow-[0_10px_30px_-18px_rgba(10,46,54,0.25)]';

export const P_INPUT =
  'w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition placeholder:text-ink-muted/60 focus:border-teal focus:ring-2 focus:ring-teal/15';

export const P_SELECT =
  'w-full cursor-pointer rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition focus:border-teal focus:ring-2 focus:ring-teal/15';

export const P_TEXTAREA =
  'w-full resize-y rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink outline-none transition placeholder:text-ink-muted/60 focus:border-teal focus:ring-2 focus:ring-teal/15';

/** Solid teal pill — the primary action. */
export const P_BTN =
  'inline-flex items-center justify-center gap-1.5 rounded-full bg-teal px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_8px_18px_-10px_rgba(14,140,146,0.7)] transition hover:bg-teal-dark disabled:opacity-50';

/** Bordered pill — secondary action. */
export const P_BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-full border-[1.5px] border-ink/10 bg-white px-5 py-2.5 text-[13px] font-bold text-ink transition hover:border-teal hover:text-teal-dark disabled:opacity-50';

/** Small pill used inside cards/tables. */
export const P_BTN_SMALL =
  'inline-flex items-center justify-center gap-1 rounded-full bg-teal px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-teal-dark disabled:opacity-50';

export const P_BTN_SMALL_GHOST =
  'inline-flex items-center justify-center gap-1 rounded-full border-[1.5px] border-ink/10 bg-white px-3.5 py-1.5 text-xs font-bold text-ink transition hover:border-teal hover:text-teal-dark disabled:opacity-50';

/** Caps label for section headers and card eyebrows. */
export const P_LABEL = 'text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-teal-dark';

/**
 * A studio section: card + header row (title, optional description, right-aligned actions).
 * Keeps the rhythm identical across the dashboard and the editor.
 */
export function PSection({
  title,
  description,
  action,
  children,
  className = '',
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${P_CARD} p-6 ${className}`}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[17px] font-extrabold tracking-tight text-ink">{title}</h2>
          {description && (
            <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-ink-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A labelled field with the frontend's label style. */
export function PField({
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
      <span className="mb-1.5 block text-xs font-bold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs leading-relaxed text-ink-muted">{hint}</span>}
    </label>
  );
}

/** Inline notice variants, frontend-toned. */
export function PNotice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error' | 'ok';
  children: ReactNode;
}) {
  const cls = {
    info: 'border-teal/20 bg-teal-tint text-teal-dark',
    warn: 'border-gold/30 bg-gold-light/10 text-ink',
    error: 'border-coral/30 bg-coral/10 text-coral-dark',
    ok: 'border-teal/20 bg-teal-tint text-teal-dark',
  }[tone];
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-xl border px-4 py-3 text-[13px] font-medium ${cls}`}
    >
      {children}
    </p>
  );
}

/** Status pill (Published / Draft, Best seller, …). */
export function PPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'coral' | 'teal';
  children: ReactNode;
}) {
  const cls = {
    neutral: 'bg-ink/[0.06] text-ink-muted',
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-700',
    coral: 'bg-coral text-white',
    teal: 'bg-teal-tint text-teal-dark',
  }[tone];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold uppercase tracking-widest ${cls}`}
    >
      {children}
    </span>
  );
}
