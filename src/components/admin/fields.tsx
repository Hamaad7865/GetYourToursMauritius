'use client';

import { useId, useState } from 'react';
import { IconPlus, IconX } from '@/components/ui/icons';
import { INPUT_CLS } from '@/components/admin/ui';

/**
 * Shared back-office form primitives. Extracted verbatim from ActivityForm so the standard-content
 * editor (/admin/content) reuses the exact same controls instead of drifting into a lookalike — the
 * two screens edit the same five lists, and they must feel identical.
 */

/** The single source for every back-office text input — and, here, for the selects and textareas the
 *  tour editor's panes draw with it too. It IS `INPUT_CLS` (one look for every control), so a
 *  restyle reaches both families of screens at once. */
export const inputClass = INPUT_CLS;

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-white p-4 sm:p-5">
      <h2 className="text-[14px] font-bold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[12.5px] text-ink-soft">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** A labelled form row. Moved here from ActivityForm when that file was split into panes — every
 *  pane needs it, so it belongs with the other shared primitives rather than in one of them. */
export function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex flex-col gap-[5px] ${full ? 'sm:col-span-2' : ''}`}>
      <span className="text-[12px] font-semibold text-ink-muted">
        {label} {required && <span className="text-coral-dark">*</span>}
      </span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-soft">{hint}</span>}
    </label>
  );
}

/** A chip list with an add-box. Enter or the + button appends; each chip has a remove control. */
export function StringList({
  label,
  items,
  onChange,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  /** Optional note under the label — used to warn that a category's standard set overrides this field. */
  hint?: React.ReactNode;
}) {
  const [draft, setDraft] = useState('');
  function add() {
    const t = draft.trim();
    if (!t) return;
    onChange([...items, t]);
    setDraft('');
  }
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      {hint}
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={`${it}-${i}`}
            className="flex items-center gap-1 rounded-md border border-line bg-ground px-2.5 py-1 text-[12.5px] font-medium text-ink"
          >
            {it}
            <button
              type="button"
              aria-label={`Remove ${it}`}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-ink-muted hover:text-coral-dark"
            >
              <IconX width={13} height={13} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inputClass}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={`Add ${label.toLowerCase()}…`}
        />
        <button
          type="button"
          onClick={add}
          aria-label={`Add ${label.toLowerCase()}`}
          className="shrink-0 rounded-lg border border-line bg-white px-3 text-ink transition-colors hover:border-[#C2CED1] hover:bg-[#FAFBFB] motion-reduce:transition-none"
        >
          <IconPlus width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
