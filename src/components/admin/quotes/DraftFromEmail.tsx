'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { draftQuoteFromEmail } from '@/lib/admin/quotes';
import { draftFromExtraction } from '@/lib/services/quote-draft';
import { loadActivityDepartures, loadTransportPricing } from '@/lib/admin/quote-catalogue';
import { extractStatedAmounts, type StatedAmount } from '@/lib/quotes/reconcile';
import { eurFromMinor } from '@/components/admin/quotes/state';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';
import type { QuoteFormValues } from './state';

/**
 * "Draft from an enquiry" — the AI entry point (plan Task A4), given the high-end assistant treatment
 * the owner asked for: a composer to paste the thread into, a "reading" shimmer in the brand's own
 * lagoon-light (teal → gold, the sun on the water — not the generic AI purple), and a staged reveal of
 * what the model found. The DESIGN is new; the flow underneath is Phase 2 unchanged:
 *
 *  - extraction runs server-side (Gemini key), the draft is composed HERE in the browser
 *    (loadActivityDepartures is browser-only), transfers are priced from the route-resolved pickup
 *    region, and the thread's stated figures are read from the pasted text for the cross-check;
 *  - the guardrails stay VISIBLE — nothing auto-saves or auto-sends, every custom line lands UNPRICED,
 *    and the result panel spells out what still needs the operator;
 *  - `onDraft(form, statedAmounts)` hands the draft up; `form` is null when the model is unavailable or
 *    errored, but the stated amounts are still reported so the cross-check works without the AI.
 *
 * Rendered only on a new, unsaved quote.
 */

const ArrowUp = () => (
  <svg
    width={18}
    height={18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 19V5M5 12l7-7 7 7" />
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
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/** What the assistant is doing, cycled while it reads — the work really is these steps, in order. */
const THINKING_STEPS = [
  'Reading the enquiry…',
  'Matching tours to your catalogue…',
  'Working out transfers & pickups…',
  'Pricing from your rates…',
];

interface Summary {
  totalLines: number;
  needsPricing: number;
  unmatched: string[];
  lowConfidence: string[];
}

/** What a line of the result needs from the operator: action, context, or nothing. */
type InsightTone = 'attention' | 'muted' | 'good';

const DOT: Record<InsightTone, string> = {
  attention: 'bg-[#F9AB00]',
  muted: 'bg-ink/40',
  good: 'bg-[#4285F4]',
};

export function DraftFromEmail({
  onDraft,
  onBusyChange,
}: {
  /** The composed draft (null when the AI is unavailable or errored — nothing to load), plus the
   *  figures the pasted thread itself stated (read straight from the text, not the AI). The stated
   *  amounts are reported in EVERY case so the cross-check works even when the AI does not draft. */
  onDraft: (form: QuoteFormValues | null, statedAmounts: StatedAmount[]) => void;
  /** Lets the editor disable Save while a draft is composing, so a save can't land mid-compose. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [stated, setStated] = useState<StatedAmount[]>([]);
  const [step, setStep] = useState(0);

  // Advance the "thinking" line while the model reads, holding on the last step if it runs long.
  useEffect(() => {
    if (!busy) return;
    setStep(0);
    const id = setInterval(() => setStep((s) => Math.min(s + 1, THINKING_STEPS.length - 1)), 950);
    return () => clearInterval(id);
  }, [busy]);

  async function run() {
    // Clear every prior status FIRST, so the empty-email error can never render beneath a stale
    // summary or "AI unavailable" notice from an earlier run.
    setError(null);
    setNotice(null);
    setSummary(null);
    const text = email.trim();
    if (!text) {
      setError('Paste the enquiry email first.');
      return;
    }
    // The amounts the thread itself stated (staff/customer figures), read straight from the pasted text
    // — NOT the AI, which has no price field. Reported in every branch below so the cross-check banner
    // (the Christophe €536-vs-€616 case) works even when the AI cannot draft.
    const statedAmounts = extractStatedAmounts(text);
    setStated(statedAmounts);
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await draftQuoteFromEmail(text);
      if (!result.available || !result.extraction || !result.candidates) {
        onDraft(null, statedAmounts);
        setNotice(
          'AI drafting is unavailable right now — add the lines by hand below. Any totals mentioned ' +
            'in the email are still shown beside the quote total for you to cross-check.',
        );
        return;
      }
      const { extraction, candidates } = result;
      // The draft is composed in the browser: departures come from the operator's own authenticated
      // catalogue read, the candidates from the route (they carry the slug the extraction matched on),
      // and transfers are priced from the route-resolved pickup region against the live transport fares.
      const form = await draftFromExtraction(extraction, {
        loadCandidates: async () => candidates,
        loadDepartures: loadActivityDepartures,
        pickupRegion: result.pickupRegion ?? null,
        loadTransportPricing,
      });
      setSummary({
        totalLines: form.lines.length,
        needsPricing: form.lines.filter((l) => l.unitText.trim() === '').length,
        unmatched: extraction.activities.filter((a) => !a.matchedSlug).map((a) => a.rawText),
        lowConfidence: extraction.activities
          .filter((a) => a.matchedSlug && a.confidence === 'low')
          .map((a) => a.rawText),
      });
      onDraft(form, statedAmounts);
    } catch (err) {
      // The thread's figures are still worth showing even if the draft call failed.
      onDraft(null, statedAmounts);
      setError(err instanceof Error ? err.message : 'Could not draft from that email.');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  const statedTotals = stated.filter((a) => a.isTotal);
  const insights: Array<{ tone: InsightTone; text: ReactNode }> = [];
  if (summary) {
    if (summary.needsPricing > 0) {
      insights.push({
        tone: 'attention',
        text: `${summary.needsPricing} ${summary.needsPricing === 1 ? 'line needs' : 'lines need'} a price — the assistant never sets one, so price them before sending.`,
      });
    }
    if (summary.lowConfidence.length > 0) {
      insights.push({
        tone: 'attention',
        text: `Low-confidence match, please check: ${summary.lowConfidence.join('; ')}.`,
      });
    }
    if (summary.unmatched.length > 0) {
      insights.push({
        tone: 'muted',
        text: `No catalogue match (kept as a line to price): ${summary.unmatched.join('; ')}.`,
      });
    }
    if (statedTotals.length > 0) {
      insights.push({
        tone: 'good',
        text: (
          <>
            Spotted in the thread:{' '}
            <span className="font-bold">
              {statedTotals.map((t) => eurFromMinor(t.amountMinor)).join(' · ')}
            </span>{' '}
            — cross-check against the quote total in Lines &amp; prices.
          </>
        ),
      });
    }
    if (insights.length === 0) {
      insights.push({ tone: 'good', text: 'Everything matched and priced — review and send.' });
    }
  }

  return (
    <section className="animate-drawer-up overflow-hidden rounded-2xl border border-[#DFE5F6] bg-white shadow-[0_1px_0_rgba(10,46,54,0.04),0_16px_40px_-22px_rgba(155,114,203,0.45)]">
      {/* Header — the assistant's identity, in Gemini's own livery. */}
      <div className="flex items-start gap-3.5 border-b border-[#EDF1FB] bg-gradient-to-b from-[#F4F7FE] to-white px-5 py-4">
        <div className="relative mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#E3E9F8] bg-white shadow-sm">
          <span className="ai-glow absolute inset-[3px] rounded-full bg-[conic-gradient(from_0deg,#4285F4,#9B72CB,#D96570,#F9AB00,#4285F4)] blur-[5px]" />
          <GeminiSpark size={19} className="relative" />
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#5F6D8C]">
            Gemini
          </p>
          <h2 className="text-[17px] font-extrabold leading-tight">
            <span className="ai-gradient-text">Draft from an enquiry</span>
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
            Paste the customer’s email — even a long back-and-forth. It reads the thread, matches
            tours to your catalogue, prices what it can, and flags the rest for you.
          </p>
        </div>
      </div>

      <div className="p-5">
        {busy ? (
          /* Reading — the Gemini gradient sweeping across the text and the lines as they resolve. */
          <div aria-live="polite">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="relative grid h-6 w-6 place-items-center">
                <span className="ai-glow absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,#4285F4,#9B72CB,#D96570,#F9AB00,#4285F4)] blur-[4px]" />
                <GeminiSpark size={15} className="relative" />
              </span>
              <span className="ai-text-sheen text-[14px] font-bold">{THINKING_STEPS[step]}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {[92, 74, 84, 62].map((w, i) => (
                <div key={i} className="ai-skeleton h-4 rounded-lg" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
        ) : (
          /* Composer — paste the thread; the send button is the one bright thing at rest. */
          <div className="rounded-2xl border border-[#DFE5F6] bg-[#FBFCFE] p-2 transition-colors focus-within:border-[#4285F4] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(66,133,244,0.12)]">
            <textarea
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run();
              }}
              rows={5}
              placeholder="Paste the enquiry email — or the whole thread — here…"
              aria-label="Customer enquiry email"
              className="w-full resize-y bg-transparent px-3 py-2.5 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-muted/70"
            />
            <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-1.5">
              <span className="text-[11.5px] leading-snug text-ink-muted">
                Nothing is sent — you review and price every line first.
              </span>
              <button
                type="button"
                onClick={() => void run()}
                disabled={!email.trim()}
                aria-label="Draft the quote from this email"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#4285F4,#9B72CB)] text-white shadow-sm transition enabled:hover:scale-105 enabled:active:scale-95 disabled:bg-none disabled:bg-ink/10 disabled:text-ink-muted disabled:shadow-none"
              >
                <ArrowUp />
              </button>
            </div>
          </div>
        )}

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-coral/10 px-4 py-3 text-[13px] font-medium text-coral-dark"
          >
            {error}
          </p>
        )}

        {notice && (
          <p
            role="status"
            className="mt-4 rounded-xl bg-gold-light/15 px-4 py-3 text-[13px] leading-relaxed text-ink"
          >
            {notice}
          </p>
        )}

        {summary && (
          <div className="mt-4 overflow-hidden rounded-xl border border-[#E3E9F8] bg-[#F7F9FE]">
            <div className="flex items-center gap-2.5 border-b border-[#E9EDF9] px-4 py-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#4285F4,#9B72CB)] text-white">
                <Check />
              </span>
              <span className="text-[13.5px] font-bold text-ink">
                Drafted {summary.totalLines} {summary.totalLines === 1 ? 'line' : 'lines'} — review
                them below.
              </span>
            </div>
            <ul className="flex flex-col gap-2.5 p-4">
              {insights.map((insight, i) => (
                <li
                  key={i}
                  className="animate-fade-up flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink"
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <span
                    className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[insight.tone]}`}
                  />
                  <span>{insight.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
