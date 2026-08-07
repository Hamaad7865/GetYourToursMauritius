'use client';

import { useState } from 'react';
import { AdminError, BTN_PRIMARY, Card, TEXTAREA_CLS } from '@/components/admin/ui';
import { draftQuoteFromEmail } from '@/lib/admin/quotes';
import { draftFromExtraction } from '@/lib/services/quote-draft';
import { loadActivityDepartures } from '@/lib/admin/quote-catalogue';
import type { QuoteFormValues } from './state';

/**
 * "Draft from a customer email" — the AI entry point (plan Task A4). The operator pastes an enquiry;
 * the staff route reads it into a structured request + catalogue candidates (the Gemini key is
 * server-only, so extraction runs there), and the draft is composed HERE in the browser
 * (loadActivityDepartures is browser-only), then handed to the editor via `onDraft` for review.
 *
 * THE GUARDRAILS ARE VISIBLE. Nothing is auto-saved or auto-sent; every custom line lands UNPRICED for
 * the operator to price (the assistant never sets a price that becomes a charge). The summary spells out
 * what still needs attention — unpriced lines, low-confidence matches, requests with no catalogue match.
 * When the model is not configured (billing blocker) the panel says so and the quote is drafted by hand.
 * Rendered only on a new, unsaved quote.
 */
export function DraftFromEmail({
  onDraft,
  onBusyChange,
}: {
  onDraft: (form: QuoteFormValues) => void;
  /** Lets the editor disable Save while a draft is composing, so a save can't land mid-compose. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    totalLines: number;
    needsPricing: number;
    unmatched: string[];
    lowConfidence: string[];
  } | null>(null);

  async function run() {
    // Clear every prior status FIRST, so the empty-email error can never render beneath a stale
    // "Drafted N lines" summary or "AI unavailable" notice from an earlier run.
    setError(null);
    setNotice(null);
    setSummary(null);
    const text = email.trim();
    if (!text) {
      setError('Paste the enquiry email first.');
      return;
    }
    setBusy(true);
    onBusyChange?.(true);
    try {
      const result = await draftQuoteFromEmail(text);
      if (!result.available || !result.extraction || !result.candidates) {
        setNotice(
          'AI drafting is unavailable right now — add the lines by hand below. It switches on ' +
            'automatically once the AI billing is topped up.',
        );
        return;
      }
      const { extraction, candidates } = result;
      // The draft is composed in the browser: departures come from the operator's own authenticated
      // catalogue read, the candidates from the route (they carry the slug the extraction matched on).
      const form = await draftFromExtraction(extraction, {
        loadCandidates: async () => candidates,
        loadDepartures: loadActivityDepartures,
      });
      setSummary({
        totalLines: form.lines.length,
        needsPricing: form.lines.filter((l) => l.unitText.trim() === '').length,
        unmatched: extraction.activities.filter((a) => !a.matchedSlug).map((a) => a.rawText),
        lowConfidence: extraction.activities
          .filter((a) => a.matchedSlug && a.confidence === 'low')
          .map((a) => a.rawText),
      });
      onDraft(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not draft from that email.');
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }

  return (
    <Card title="Draft from a customer email">
      <p className="mb-3 text-[13px] leading-relaxed text-ink-muted">
        Paste a customer enquiry and the assistant fills in the guest, dates and lines below —
        matching each tour to the catalogue and pricing only what it can. Review and price every
        line before sending; nothing goes out automatically.
      </p>
      <textarea
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        rows={6}
        placeholder="Paste the customer's email here…"
        className={TEXTAREA_CLS}
        disabled={busy}
      />
      <div className="mt-3">
        <button type="button" onClick={() => void run()} disabled={busy} className={BTN_PRIMARY}>
          {busy ? 'Reading the email…' : 'Draft quote'}
        </button>
      </div>

      {error && (
        <div className="mt-3">
          <AdminError>{error}</AdminError>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-gold-light/20 px-4 py-3 text-[13px] leading-relaxed text-ink"
        >
          {notice}
        </p>
      )}
      {summary && (
        <div
          role="status"
          className="mt-3 rounded-xl bg-teal/10 px-4 py-3 text-[13px] leading-relaxed text-teal-dark"
        >
          <p className="font-semibold">
            Drafted {summary.totalLines} {summary.totalLines === 1 ? 'line' : 'lines'} — review
            below.
          </p>
          {(summary.needsPricing > 0 ||
            summary.lowConfidence.length > 0 ||
            summary.unmatched.length > 0) && (
            <ul className="mt-1 list-disc pl-4 text-ink">
              {summary.needsPricing > 0 && (
                <li>
                  {summary.needsPricing} {summary.needsPricing === 1 ? 'line needs' : 'lines need'}{' '}
                  a price — the assistant never sets one, so price them before sending.
                </li>
              )}
              {summary.lowConfidence.length > 0 && (
                <li>Low-confidence match, please check: {summary.lowConfidence.join('; ')}.</li>
              )}
              {summary.unmatched.length > 0 && (
                <li>
                  No catalogue match (kept as a line to price): {summary.unmatched.join('; ')}.
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
