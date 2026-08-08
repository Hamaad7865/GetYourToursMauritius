'use client';

import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { applyAssistantAction } from '@/lib/admin/assistant';
import { useAssistant } from '@/components/admin/assistant/AssistantProvider';
import { refusalMessage } from '@/components/admin/quotes/state';
import type { AssistantAction, TourContentPatch } from '@/lib/validation/admin-assistant';

/**
 * A proposal, and the only place one becomes real.
 *
 * The card exists because the assistant does not act — it offers. What it will change is spelled
 * out field by field BEFORE the operator commits (progressive disclosure: the long fields collapse
 * behind "Show what changes"), the caveat states what is deliberately not covered, and Apply is a
 * single, clearly-primary action. Applying runs in the browser under the operator's own session;
 * a refusal (RLS, validation) is shown verbatim rather than swallowed.
 *
 * Once applied the card becomes a receipt with a link onward to finish the job — an
 * assistant-created tour still needs its prices, and saying so at the moment of success is the
 * difference between a helper and a liability.
 */

const FIELD_LABEL: Record<keyof TourContentPatch, string> = {
  title: 'Title',
  summary: 'Summary',
  description: 'Description',
  location: 'Location',
  meetingPoint: 'Meeting point',
  cancellationPolicy: 'Cancellation policy',
  seoTitle: 'SEO title',
  seoDescription: 'SEO description',
  highlights: 'Highlights',
  inclusions: 'What’s included',
  exclusions: 'What’s not included',
  whatToBring: 'What to bring',
  importantInfo: 'Know before you go',
};

const Sparkle = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
    <path
      fill="currentColor"
      d="M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12C17.373 12 12 6.627 12 0z"
    />
  </svg>
);

const Check = () => (
  <svg
    width={13}
    height={13}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="shrink-0"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/** The changed fields, as short readable rows. Lists show their bullets; prose is clamped. */
function PatchPreview({ patch }: { patch: TourContentPatch }) {
  const entries = Object.entries(patch) as Array<[keyof TourContentPatch, unknown]>;
  return (
    <dl className="mt-2.5 flex flex-col gap-2 border-t border-ink/[0.07] pt-2.5">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="text-[10.5px] font-bold uppercase tracking-wide text-ink-muted/80">
            {FIELD_LABEL[key] ?? key}
          </dt>
          <dd className="mt-0.5 text-[12.5px] leading-relaxed text-ink/85">
            {Array.isArray(value) ? (
              <ul className="flex flex-col gap-0.5">
                {value.map((item, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-ink-muted/60">
                      •
                    </span>
                    <span>{String(item)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="whitespace-pre-wrap">{String(value)}</p>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ActionCard({ action }: { action: AssistantAction }) {
  const router = useRouter();
  const pathname = usePathname();
  const assistant = useAssistant();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ message: string; href: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = action.kind === 'draft_quote_from_email' ? null : action.patch;
  const changeCount = patch ? Object.keys(patch).length : 0;

  /**
   * Go where the work continues. `router.push` to the page you are ALREADY on is a no-op that does
   * not remount anything, so the hand-off itself must never depend on the navigation happening —
   * it rides the assistant context, and this only moves the operator if they are elsewhere.
   */
  function goTo(href: string) {
    if (pathname !== href.split('?')[0]) router.push(href);
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await applyAssistantAction(action, {
        handOffQuoteEmail: assistant?.handOffQuoteEmail,
      });
      setDone(result);
      // A drafted quote is worth landing on immediately; a tour edit is not (the operator is
      // usually mid-conversation), so that one waits behind the receipt's "Open it".
      if (action.kind === 'draft_quote_from_email' && result.href) goTo(result.href);
    } catch (err) {
      setError(refusalMessage(err, 'That could not be applied.'));
    } finally {
      setBusy(false);
    }
  }

  /** The receipt's button: re-hand the enquiry over, in case the first landing was dismissed. */
  function reopen() {
    if (!done?.href) return;
    if (action.kind === 'draft_quote_from_email') assistant?.handOffQuoteEmail(action.email);
    goTo(done.href);
  }

  if (done) {
    return (
      <div className="ai-card-in rounded-xl border border-teal/30 bg-teal/[0.06] p-3">
        <p className="flex items-start gap-2 text-[12.5px] font-semibold leading-relaxed text-teal-dark">
          <span className="mt-0.5">
            <Check />
          </span>
          {done.message}
        </p>
        {done.href && (
          <button
            type="button"
            onClick={reopen}
            className="mt-2 rounded-lg bg-teal px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-teal-dark"
          >
            Open it
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="ai-card-in overflow-hidden rounded-xl border border-ink/15 bg-white shadow-sm">
      <div className="flex items-start gap-2 px-3 pt-3">
        <span className="mt-0.5 text-[#9B72CB]">
          <Sparkle />
        </span>
        <p className="flex-1 text-[13px] font-bold leading-snug text-ink">{action.label}</p>
      </div>

      <div className="px-3 pb-3">
        {action.kind === 'update_tour' && (
          <p className="mt-1 text-[12px] text-ink-muted">
            on <span className="font-semibold text-ink/80">{action.activityTitle}</span>
          </p>
        )}
        {action.kind === 'draft_quote_from_email' && (
          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-muted">
            {action.email.slice(0, 240)}
            {action.email.length > 240 ? '…' : ''}
          </p>
        )}

        {patch && changeCount > 0 && (
          <>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
              className="mt-1.5 text-[12px] font-semibold text-[#4285F4] transition-opacity hover:opacity-75"
            >
              {expanded ? 'Hide details' : `Show what changes (${changeCount})`}
            </button>
            {expanded && <PatchPreview patch={patch} />}
          </>
        )}

        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">{action.caveat}</p>

        {error && (
          <p role="alert" className="mt-2 text-[12px] font-semibold text-coral">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={() => void apply()}
          disabled={busy}
          className="ai-apply-btn mt-2.5 w-full rounded-lg px-3 py-2 text-[12.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
