'use client';

import { useState } from 'react';
import { IconPlus, IconX } from '@/components/ui/icons';

/**
 * Shared back-office form primitives. Extracted verbatim from ActivityForm so the standard-content
 * editor (/admin/content) reuses the exact same controls instead of drifting into a lookalike — the
 * two screens edit the same five lists, and they must feel identical.
 */

/** Moved verbatim from ActivityForm — the single source for every back-office text input, so the two
 *  screens stay pixel-identical. */
export const inputClass =
  'w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-ink-muted/70 focus:border-teal focus:bg-white';

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
    <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5 sm:p-6">
      <h2 className="text-[15px] font-extrabold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-ink-muted">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
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
      <span className="text-[13px] font-bold text-ink">{label}</span>
      {hint}
      <div className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span
            key={`${it}-${i}`}
            className="flex items-center gap-1 rounded-full bg-cream px-3 py-1 text-[13px] text-ink"
          >
            {it}
            <button
              type="button"
              aria-label={`Remove ${it}`}
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="text-ink-muted hover:text-coral"
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
          className="shrink-0 rounded-xl border border-ink/15 px-3 text-ink hover:border-teal hover:text-teal"
        >
          <IconPlus width={16} height={16} />
        </button>
      </div>
    </div>
  );
}
