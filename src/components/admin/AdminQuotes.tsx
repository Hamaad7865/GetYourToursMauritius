'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  AdminError,
  AdminHeading,
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  Field,
  INPUT_CLS,
  SELECT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';
import { IconArrowRight, IconPlus, IconSearch } from '@/components/ui/icons';
import { fmtDate, fmtDateShort } from '@/lib/admin/format';
import {
  cancelQuote,
  duplicateQuote,
  loadQuote,
  loadQuotes,
  reinstateQuote,
  saveQuote,
  sendBalanceLink,
  sendQuote,
  type QuoteRow,
  type QuoteStatus,
} from '@/lib/admin/quotes';
import { DraftFromEmail } from '@/components/admin/quotes/DraftFromEmail';
import { EmailPreview } from '@/components/admin/quotes/EmailPreview';
import { LinesPane } from '@/components/admin/quotes/LinesPane';
import { EMPTY_PICKUP, type QuotePickup } from '@/components/admin/quotes/pickup';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAssistant, useAssistantContext } from '@/components/admin/assistant/AssistantProvider';
import type { StatedAmount } from '@/lib/quotes/reconcile';
import {
  DEFAULT_DEPOSIT_BPS,
  PAY_IN_FULL_BPS,
  QUOTE_PANES,
  QUOTE_STATUS_LABEL,
  convertedBookingKind,
  depositBpsFromPercent,
  depositMinorOf,
  depositPercentFromBps,
  emptyQuoteForm,
  eurFromMinor,
  formFromQuote,
  formTotalMinor,
  quoteInputFromForm,
  quoteStatusClass,
  refusalMessage,
  sendRefusal,
  type QuoteFormValues,
  type QuoteLineDraft,
  type QuotePaneId,
} from '@/components/admin/quotes/state';

/**
 * /admin/quotes — draft a priced offer, email it to a guest, and watch what happens to it.
 *
 * The module underneath this screen was complete and unreachable: nothing in the app called
 * `saveQuote`, `cancelQuote` or `sendQuote`, so the schema, the token, the conversion RPC, the
 * public page and the guest's pay route existed with no way for a human to start any of it. This is
 * the front door.
 *
 * TWO SCREENS IN ONE COMPONENT — a list, and an editor laid out as a rail plus one pane at a time,
 * the same shape the tour editor settled on. A quote has four subjects (who it is for, what is on
 * it, what is written around it, and sending it) and only the second is long; stacking them would
 * put Send six screens below the lines it sends.
 *
 * WHAT THIS SCREEN REFUSES TO DO, because the money path would refuse it later:
 *
 *  - price money in anything but whole cents (`state.ts` parses the typed string; nothing here ever
 *    holds a euro float);
 *  - keep a tour line at a price the catalogue does not support (it becomes a custom line, which is
 *    the shape that is chargeable — see `state.ts`);
 *  - send a quote whose total and lines disagree, or that totals nothing (the preview is the real
 *    renderer, and it throws exactly as the send route would);
 *  - re-price a quote the guest has already paid for (`saveQuote`'s guard; its refusal is shown
 *    verbatim, naming the booking to reconcile).
 *
 * Every refusal from `src/lib/admin/quotes.ts` reaches the operator through `refusalMessage`, which
 * exists because those refusals are not all `Error`s: PostgREST hands back a plain object, and the
 * usual `err instanceof Error ? err.message : 'Action failed'` idiom would turn "new row violates
 * row-level security policy" into "Action failed".
 */

const STATUS_FILTERS: Array<{ value: 'all' | QuoteStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'cancelled', label: 'Withdrawn' },
];

/** The quote on screen, summarised for the assistant — context, never instructions. */
function chatContextOf(values: QuoteFormValues, totalMinor: number | null): string {
  const lines = values.lines
    .slice(0, 8)
    .map(
      (line) =>
        `- ${line.description || '(untitled line)'} × ${line.quantityText || '1'}${
          line.unitText ? ` @ €${line.unitText}` : ' (unpriced)'
        }`,
    );
  return [
    `Quote ${values.ref ?? '(new, unsaved)'} · status ${values.status}`,
    `Guest: ${values.customerName || '—'} <${values.customerEmail || '—'}>`,
    `Total: ${totalMinor === null ? 'not computable yet' : eurFromMinor(totalMinor)} · valid until ${values.validUntil} · deposit ${depositPercentFromBps(values.depositBps)}%`,
    ...(lines.length ? ['Lines:', ...lines] : ['No lines yet.']),
    values.lines.length > 8 ? `(+${values.lines.length - 8} more lines)` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function AdminQuotes() {
  const { profile } = useAuth();
  const isStaff = profile?.role === 'admin' || profile?.role === 'staff';
  // 'list', or the quote being edited (null id = a new one).
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);

  // The assistant hands an enquiry over through its context. Keyed on the VALUE, not on mount:
  // applying while already on this screen changes no route and remounts nothing, so a mount-effect
  // (what this was) silently did nothing — the bug the operator hit as "pressing open does nothing".
  const handoff = useAssistant()?.quoteHandoff ?? null;
  useEffect(() => {
    if (handoff) setEditing({ id: null });
  }, [handoff]);

  if (profile && !isStaff) {
    return (
      <Card title="Staff only">
        <p className="text-[13.5px] leading-relaxed text-ink-muted">
          Quotes carry a guest’s name, their email address, the price we offered them and the
          operator’s own notes, and sending one emails a stranger on the company’s behalf. The
          content role has no access — the send route refuses it too.
        </p>
      </Card>
    );
  }

  return editing ? (
    <QuoteEditor
      id={editing.id}
      onClose={() => setEditing(null)}
      // Duplicating leaves this quote and opens the COPY. The `key` below is the id, so switching it
      // remounts the editor rather than leaving the old quote's form state on the new row.
      onOpen={(id) => setEditing({ id })}
      key={editing.id ?? 'new-quote'}
    />
  ) : (
    <QuoteList onOpen={(id) => setEditing({ id })} />
  );
}

/* ------------------------------------------------------------------------------------------- */
/* The list                                                                                      */
/* ------------------------------------------------------------------------------------------- */

function QuoteList({ onOpen }: { onOpen: (id: string | null) => void }) {
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | QuoteStatus>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    loadQuotes()
      .then(setRows)
      .catch((err: unknown) => {
        setRows([]);
        setError(refusalMessage(err, 'Could not load the quotes.'));
      });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // `loadQuotes` already orders by created_at desc — newest first is the order an operator works
    // in, and nothing here re-sorts it.
    return (rows ?? []).filter((quote) => {
      if (status !== 'all' && quote.status !== status) return false;
      if (!q) return true;
      return (
        quote.ref.toLowerCase().includes(q) ||
        quote.customerName.toLowerCase().includes(q) ||
        quote.customerEmail.toLowerCase().includes(q)
      );
    });
  }, [rows, status, query]);

  return (
    <div>
      <AdminHeading
        title="Quotes"
        subtitle={rows ? `${filtered.length} of ${rows.length} quotes · newest first` : 'Loading…'}
        action={
          <button type="button" onClick={() => onOpen(null)} className={BTN_PRIMARY}>
            <IconPlus width={16} height={16} /> New quote
          </button>
        }
      />

      <div className="mb-4 rounded-2xl border border-[#EAEEF0] bg-white p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex flex-wrap gap-1 rounded-xl bg-[#F4F6F7] p-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatus(f.value)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${
                  status === f.value
                    ? 'bg-ink text-white shadow-sm'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-[180px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted">
              <IconSearch width={16} height={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search quotes"
              placeholder="Search ref, name or email…"
              className="w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 pl-9 pr-3 text-[13.5px] text-ink outline-none focus:border-teal focus:bg-white"
            />
          </div>
        </div>
      </div>

      {error && <AdminError>{error}</AdminError>}

      <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr className="bg-[#FAFBFC]">
                {['Ref', 'Guest', 'Total', 'Status', 'Valid until', 'Drafted'].map((label) => (
                  <th
                    key={label}
                    className={`whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted ${
                      label === 'Total' ? 'text-right' : ''
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((quote) => (
                <tr
                  key={quote.id}
                  onClick={() => onOpen(quote.id)}
                  className="cursor-pointer border-t border-[#F2F4F6] hover:bg-[#FAFBFC]"
                >
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-[12.5px] font-bold text-teal">
                    {quote.ref}
                  </td>
                  <td className="px-3 py-3">
                    <span className="block text-[13.5px] font-bold text-ink">
                      {quote.customerName}
                    </span>
                    <span className="block text-[12.5px] text-ink-muted">
                      {quote.customerEmail}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right text-[13.5px] font-extrabold text-ink">
                    {eurFromMinor(quote.totalMinor)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${quoteStatusClass(quote.status)}`}
                    >
                      {QUOTE_STATUS_LABEL[quote.status] ?? quote.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                    {fmtDate(`${quote.validUntil}T00:00:00+04:00`)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                    {fmtDateShort(quote.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows !== null && filtered.length === 0 && (
          <div className="px-6 py-14 text-center">
            <div className="text-[15px] font-bold text-ink">
              {rows.length === 0 ? 'No quotes yet' : 'No quotes match these filters'}
            </div>
            <div className="mt-1 text-[13.5px] text-ink-muted">
              {rows.length === 0
                ? 'Draft one for a guest who asked for a price, and email it to them from here.'
                : 'Try another status, or clear the search.'}
            </div>
          </div>
        )}
        {rows === null && <p className="p-6 text-sm text-ink-muted">Loading…</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------- */
/* The editor                                                                                    */
/* ------------------------------------------------------------------------------------------- */

function QuoteEditor({
  id,
  onClose,
  onOpen,
}: {
  id: string | null;
  onClose: () => void;
  /** Leave this quote and open another — the copy `duplicate()` just created. */
  onOpen: (id: string) => void;
}) {
  const [form, setForm] = useState<QuoteFormValues | null>(id ? null : emptyQuoteForm());
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pane, setPane] = useState<QuotePaneId>('guest');
  // The pickup chosen on the map, lifted here so it survives switching panes (LinesPane unmounts when
  // the operator visits another pane). Session-level only — not persisted on the quote in Phase 1.
  const [pickup, setPickup] = useState<QuotePickup>(EMPTY_PICKUP);
  // Figures the pasted enquiry thread itself stated (read from the text when drafting, never the AI),
  // shown in the lines pane beside the computed total so a discrepancy — the staff €536-vs-€616 case —
  // is caught before sending. Session-level, like the pickup.
  const [statedAmounts, setStatedAmounts] = useState<StatedAmount[]>([]);
  // Unsaved edits are tracked because SEND EMAILS THE STORED ROW, not the form: the route reads the
  // quote back out of the database. Sending with a re-priced form on screen would email the guest
  // the old figure and leave the operator looking at the new one.
  const [dirty, setDirty] = useState(false);
  // True while the "Draft from email" panel is composing — Save is blocked so a save can't land
  // mid-compose and orphan the in-flight draft into a duplicate quote.
  const [drafting, setDrafting] = useState(false);
  /** The public link the last send returned — the raw token's only home on our side. */
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The durable balance link the last "Send balance link" returned, for a converted quote. */
  const [balanceLink, setBalanceLink] = useState<string | null>(null);
  const [balanceCopied, setBalanceCopied] = useState(false);

  const reload = useCallback(async (quoteId: string) => {
    const detail = await loadQuote(quoteId);
    if (!detail) throw new Error('This quote no longer exists.');
    setForm(formFromQuote(detail));
    setDirty(false);
  }, []);

  useEffect(() => {
    if (!id) return;
    reload(id)
      .catch((err: unknown) => setError(refusalMessage(err, 'Could not load this quote.')))
      .finally(() => setLoading(false));
  }, [id, reload]);

  // Tell the assistant what is on this screen, so "what's this total?" or "add a transfer for that
  // hotel" are about THIS quote. Computed before the early returns — it is a hook.
  useAssistantContext(form ? chatContextOf(form, formTotalMinor(form)) : null);

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!form) {
    return (
      <div>
        <AdminError>{error ?? 'Quote not found.'}</AdminError>
        <button type="button" onClick={onClose} className={BTN_GHOST}>
          Back to quotes
        </button>
      </div>
    );
  }

  const values = form;
  const total = formTotalMinor(values);
  const sendBlocked = sendRefusal(values);
  // Deposit shown as a %; the euro amounts are DISPLAY ONLY (computed the way the conversion RPC
  // sizes the charge), and null while a line is still half-typed so nothing shows a bogus figure.
  const converted = Boolean(values.convertedAt);
  // `converted` only means a booking was minted (the guest opened checkout). `bookingKind` reads the
  // booking's LIVE status, so the banner + the balance UI can tell paid from pending from
  // abandoned-unpaid instead of blindly claiming the guest paid.
  const bookingKind = convertedBookingKind(values.bookingStatus);
  const bookingPaid = bookingKind === 'paid';
  const payInFull = values.depositBps >= PAY_IN_FULL_BPS;
  const depositPercent = depositPercentFromBps(values.depositBps);
  const depositAmount = total === null ? null : depositMinorOf(total, values.depositBps);
  const balanceAmount =
    total === null || depositAmount === null ? null : Math.max(0, total - depositAmount);

  function set<K extends keyof QuoteFormValues>(key: K, value: QuoteFormValues[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setNotice(null);
  }
  function setLines(lines: QuoteLineDraft[]) {
    set('lines', lines);
  }

  /** One shape for every mutation: clear the last message, run it, re-read the stored quote. */
  async function act(label: string, run: () => Promise<string | null>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const message = await run();
      if (message) setNotice(message);
    } catch (err) {
      setError(refusalMessage(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    await act('save', async () => {
      // Parsed BEFORE anything is written: every refusal the editor can raise itself (a price that
      // is not an amount, a line with no description) lands here, with nothing saved.
      const savedId = await saveQuote(quoteInputFromForm(values));
      await reload(savedId);
      return 'Saved.';
    });
  }

  async function send() {
    if (!values.id) return;
    await act('send', async () => {
      const result = await sendQuote(values.id!);
      setLink(result.url);
      await reload(values.id!);
      return `Emailed to ${values.customerEmail}.`;
    });
  }

  async function withdraw() {
    if (!values.id) return;
    if (
      !window.confirm(
        `Withdraw quote ${values.ref ?? ''}? The guest's link stops working and the offer can no ` +
          `longer be paid. You do NOT need to withdraw to change it — edit the lines and press ` +
          `Re-send instead. If you do withdraw, Reinstate puts it back to a draft.`,
      )
    ) {
      return;
    }
    await act('withdraw', async () => {
      await cancelQuote(values.id!);
      setLink(null);
      await reload(values.id!);
      return 'Withdrawn. The guest’s link no longer opens — press Reinstate to work on it again.';
    });
  }

  /** Un-withdraw: back to a draft, with the withdrawn link left dead. See `reinstateQuote`. */
  async function reinstate() {
    if (!values.id) return;
    await act('reinstate', async () => {
      await reinstateQuote(values.id!);
      setLink(null);
      await reload(values.id!);
      return 'Back to a draft. Change what you need, then press Send — the guest gets a fresh link.';
    });
  }

  /**
   * Copy this quote into a new draft and open it. The only way to re-offer a quote the guest has
   * already paid for, and the fastest way to reuse one for a different date or a different guest.
   */
  async function duplicate() {
    if (!values.id) return;
    if (dirty && !window.confirm('Duplicate the SAVED quote? Unsaved changes are not copied.')) {
      return;
    }
    await act('duplicate', async () => {
      const copyId = await duplicateQuote(values.id!);
      onOpen(copyId);
      return null;
    });
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions, insecure context). The link is in a selectable input
      // beside the button, so there is always a way to get it out.
      setCopied(false);
    }
  }

  /**
   * Mint the DURABLE balance link for a converted, deposit-confirmed quote, and show it to copy. The
   * amount still owed lives on the BOOKING (`balance_due_minor`), not the quote, and is read
   * server-side by the route — so the button is enabled for any converted quote and the route's own
   * 409 ("nothing owed") is surfaced verbatim for a pay-in-full quote that is already fully paid.
   */
  async function sendBalance() {
    if (!values.ref) return;
    await act('balance', async () => {
      const result = await sendBalanceLink(values.ref!);
      setBalanceLink(result.url);
      // The link is emailed to the guest now, like the quote itself. The copy button stays as the
      // fallback — and is the ONLY route when the mail provider was down, which `emailed: false`
      // reports rather than swallowing (the token is minted and the URL is live either way).
      return result.emailed === false
        ? 'Balance link ready, but the email could not be sent — copy it to the guest.'
        : `Balance link emailed to ${values.customerEmail || 'the guest'}.`;
    });
  }

  async function copyBalance() {
    if (!balanceLink) return;
    try {
      await navigator.clipboard.writeText(balanceLink);
      setBalanceCopied(true);
      window.setTimeout(() => setBalanceCopied(false), 2000);
    } catch {
      setBalanceCopied(false);
    }
  }

  return (
    <div>
      <AdminHeading
        title={values.ref ? `Quote ${values.ref}` : 'New quote'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${quoteStatusClass(values.status)}`}
            >
              {QUOTE_STATUS_LABEL[values.status] ?? values.status}
            </span>
            <span>
              {total === null ? 'Total —' : `Total ${eurFromMinor(total)}`} · valid until{' '}
              {values.validUntil}
            </span>
            {dirty && <span className="font-bold text-coral">Unsaved changes</span>}
          </span>
        }
        action={
          <span className="flex items-center gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Back
            </button>
            {values.id && (
              // Available on EVERY saved quote, including a paid one — that is the case with no other
              // way out, since a converted quote's lines are the itemisation behind a real charge and
              // the service refuses to edit them.
              <button
                type="button"
                onClick={() => void duplicate()}
                disabled={busy !== null || drafting}
                className={BTN_GHOST}
                title="Copy the guest, the lines, the notes and the deposit into a new draft"
              >
                {busy === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy !== null || drafting}
              className={BTN_PRIMARY}
            >
              {busy === 'save' ? 'Saving…' : 'Save quote'}
            </button>
          </span>
        }
      />

      {error && <AdminError>{error}</AdminError>}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-xl bg-teal/10 px-4 py-3 text-[13px] font-medium text-teal-dark"
        >
          {notice}
        </p>
      )}
      {values.convertedAt && (
        <p className="mb-4 rounded-xl bg-gold-light/20 px-4 py-3 text-[13px] leading-relaxed text-ink">
          {bookingKind === 'paid'
            ? 'The guest has accepted and paid this quote, so its lines and total can no longer be changed. The booking is the live record now — find it on the bookings screen. To offer them a change, press Duplicate: it copies the guest, the lines and the deposit into a new draft and leaves this one alone.'
            : bookingKind === 'pending'
              ? 'The guest has opened checkout for this quote but hasn’t finished paying — nothing is locked in yet, and it confirms once the deposit settles. Its lines can’t be changed while that checkout is open.'
              : bookingKind === 'abandoned'
                ? 'The guest opened checkout but didn’t complete payment, so this quote’s booking expired without being paid — nothing was charged. The quote is still open: the guest can pay from their existing link, which mints a fresh booking.'
                : 'This quote was converted to a booking that is now closed. Check the bookings screen for its current state.'}
        </p>
      )}
      {values.status === 'cancelled' && !values.convertedAt && (
        // The way back, stated where the operator lands rather than only on the Send pane — a
        // withdrawn quote is exactly the one they would otherwise start retyping.
        <p className="mb-4 rounded-xl bg-[#F7F8FA] px-4 py-3 text-[13px] leading-relaxed text-ink">
          This quote is withdrawn and its old link no longer opens. Nothing is lost:{' '}
          <span className="font-bold">Reinstate as a draft</span> on the Send pane puts it back so
          you can change it and send a fresh link, or <span className="font-bold">Duplicate</span>{' '}
          copies it into a new offer.
        </p>
      )}

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav
          aria-label="Quote sections"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:sticky lg:top-6 lg:mx-0 lg:w-56 lg:shrink-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {QUOTE_PANES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPane(p.id)}
              aria-current={p.id === pane ? 'page' : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors lg:w-full ${
                p.id === pane
                  ? 'bg-teal/10 text-teal-dark'
                  : 'text-ink-muted hover:bg-ink/[0.04] hover:text-ink'
              }`}
            >
              <span className="whitespace-nowrap lg:truncate">{p.label}</span>
              {p.id === 'lines' && values.lines.length > 0 && (
                <span className="ml-auto shrink-0 text-[11.5px] font-bold text-ink-muted/70">
                  {values.lines.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {pane === 'guest' && (
            <div className="flex flex-col gap-5">
              {!values.id && (
                <DraftFromEmail
                  onBusyChange={setDrafting}
                  onDraft={(draft, amounts) => {
                    // Always surface the thread's stated figures for the cross-check banner, even when
                    // the AI produced no draft (unavailable / by-hand) — that is the whole point of it.
                    setStatedAmounts(amounts);
                    if (!draft) return;
                    // A draft replaces the WHOLE form, so guard any work the operator already typed
                    // (the same confirm the withdraw action uses before a destructive change).
                    if (
                      dirty &&
                      !window.confirm('Replace what you have entered with the drafted quote?')
                    ) {
                      return;
                    }
                    setForm(draft);
                    setDirty(true);
                    setNotice(
                      'Draft loaded from the email — review and price the lines before sending.',
                    );
                  }}
                />
              )}
              <Card title="Who this offer is for">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Guest name">
                    <input
                      value={values.customerName}
                      onChange={(e) => set('customerName', e.target.value)}
                      className={INPUT_CLS}
                      placeholder="Marie Dupont"
                    />
                  </Field>
                  <Field
                    label="Email"
                    hint="Where the offer is sent — and, if it matches a confirmed account, who the paid booking belongs to."
                  >
                    <input
                      type="email"
                      value={values.customerEmail}
                      onChange={(e) => set('customerEmail', e.target.value)}
                      className={INPUT_CLS}
                      placeholder="marie@example.com"
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      value={values.customerPhone}
                      onChange={(e) => set('customerPhone', e.target.value)}
                      className={INPUT_CLS}
                      placeholder="+230 5 123 4567"
                    />
                  </Field>
                  <Field
                    label="Hotel room number"
                    hint="For the driver’s gate pass at the guest’s hotel. Shows on the calendar day sheet. Optional."
                  >
                    <input
                      value={values.roomOrCabin}
                      onChange={(e) => set('roomOrCabin', e.target.value)}
                      className={INPUT_CLS}
                      placeholder="e.g. Room 214"
                    />
                  </Field>
                  <Field
                    label="Valid until"
                    hint="After this date the link stops opening and the payment path refuses the quote."
                  >
                    <DatePicker
                      value={values.validUntil}
                      onChange={(v) => set('validUntil', v)}
                      className={INPUT_CLS}
                    />
                  </Field>
                  <Field
                    label="Language"
                    hint="The language of this offer — and of the guest’s confirmation email and VAT invoice after they pay."
                  >
                    <select
                      value={values.locale}
                      onChange={(e) => set('locale', e.target.value === 'fr' ? 'fr' : 'en')}
                      className={SELECT_CLS}
                    >
                      <option value="en">English</option>
                      <option value="fr">Français</option>
                    </select>
                  </Field>
                  <Field
                    label="Currency"
                    hint="Quotes are EUR only — the payment ledger is EUR-only."
                  >
                    <input value="EUR" readOnly disabled className={INPUT_CLS} />
                  </Field>
                </div>

                <div className="mt-4 border-t border-[#EEF1F3] pt-4">
                  <div className="mb-3">
                    <span className="mb-1.5 block text-[13px] font-bold text-ink">
                      Payment plan
                    </span>
                    <div className="inline-flex rounded-lg border border-[#CBD3D8] p-0.5 text-[13px] font-semibold">
                      {(['deposit', 'per_date'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          disabled={converted}
                          onClick={() => set('paymentMode', mode)}
                          className={`rounded-md px-3 py-1.5 disabled:opacity-50 ${
                            values.paymentMode === mode ? 'bg-teal text-white' : 'text-ink-muted'
                          }`}
                        >
                          {mode === 'deposit' ? 'Deposit + balance' : 'Pay per date'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {values.paymentMode === 'per_date' ? (
                    <div className="rounded-lg border border-teal/20 bg-teal/[0.04] p-3 text-[12.5px] leading-relaxed text-ink-muted">
                      The balance is split into <strong>one payment per activity date</strong> — the
                      guest pays each before that day and is reminded automatically a few days
                      ahead. The earliest date&rsquo;s amount is the deposit that secures the trip;
                      the exact schedule is built from the line dates when the guest accepts.
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                        <Field
                          label="Deposit to confirm"
                          hint="What the guest pays now to lock in the booking. The balance is chased later."
                        >
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={100}
                              step={1}
                              value={depositPercent}
                              disabled={payInFull || converted}
                              aria-label="Deposit percent"
                              onChange={(e) =>
                                set('depositBps', depositBpsFromPercent(Number(e.target.value)))
                              }
                              className={`${INPUT_CLS} w-24 disabled:opacity-50`}
                            />
                            <span className="text-sm font-bold text-ink-muted">%</span>
                          </div>
                        </Field>
                        <label className="mb-1.5 flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-ink">
                          <input
                            type="checkbox"
                            checked={payInFull}
                            disabled={converted}
                            onChange={(e) =>
                              set(
                                'depositBps',
                                e.target.checked ? PAY_IN_FULL_BPS : DEFAULT_DEPOSIT_BPS,
                              )
                            }
                            className="h-4 w-4 rounded border-[#CBD3D8] text-teal accent-teal focus:ring-teal disabled:opacity-50"
                          />
                          Pay in full (100%)
                        </label>
                      </div>
                      <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                        {payInFull ? (
                          depositAmount === null ? (
                            <>
                              The guest pays the whole total to confirm — no balance to collect
                              later.
                            </>
                          ) : (
                            <>
                              The guest pays the whole{' '}
                              <span className="font-bold text-ink">
                                {eurFromMinor(depositAmount)}
                              </span>{' '}
                              to confirm — no balance to collect later.
                            </>
                          )
                        ) : depositAmount === null || balanceAmount === null ? (
                          <>
                            The guest pays {depositPercent}% now to confirm the booking; the rest is
                            collected later with the balance link.
                          </>
                        ) : (
                          <>
                            The guest pays{' '}
                            <span className="font-bold text-ink">
                              {eurFromMinor(depositAmount)}
                            </span>{' '}
                            ({depositPercent}%) now to confirm; a{' '}
                            <span className="font-bold text-ink">
                              {eurFromMinor(balanceAmount)}
                            </span>{' '}
                            balance is collected later with the balance link.
                          </>
                        )}
                      </p>
                    </>
                  )}
                  {converted && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-ink-muted">
                      This quote has been converted, so its deposit can no longer be changed. Send
                      the balance link from Preview &amp; send.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {pane === 'lines' && (
            <LinesPane
              form={values}
              setLines={setLines}
              pickup={pickup}
              setPickup={setPickup}
              statedAmounts={statedAmounts}
            />
          )}

          {pane === 'notes' && (
            <div className="flex flex-col gap-4">
              <Card title="Covering note — the guest reads this">
                <textarea
                  value={values.introNote}
                  onChange={(e) => set('introNote', e.target.value)}
                  rows={5}
                  aria-label="Covering note to the guest"
                  placeholder="As discussed on the phone — this includes the transfer from your hotel."
                  className={TEXTAREA_CLS}
                />
                <p className="mt-2 text-[12px] text-ink-muted">
                  Printed above the prices in the email and on the guest’s quote page.
                </p>
              </Card>
              <Card title="Internal note — never sent">
                <textarea
                  value={values.internalNotes}
                  onChange={(e) => set('internalNotes', e.target.value)}
                  rows={4}
                  aria-label="Internal note, never sent to the guest"
                  placeholder="Margin is thin at this price — don’t discount further."
                  className={TEXTAREA_CLS}
                />
                <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                  Staff only. It is not loaded by the send route and is not a field the email
                  renderer accepts, so it cannot reach the guest — not in the email, not on their
                  quote page.
                </p>
              </Card>
            </div>
          )}

          {pane === 'send' && (
            <div className="flex flex-col gap-4">
              <EmailPreview form={values} />

              <Card title="Send">
                {dirty && (
                  <p className="mb-3 rounded-xl bg-gold-light/20 px-4 py-3 text-[13px] leading-relaxed text-ink">
                    There are unsaved changes. Sending emails the stored quote, so save first or the
                    guest gets the previous version.
                  </p>
                )}
                {sendBlocked && (
                  <p className="mb-3 rounded-xl bg-[#F7F8FA] px-4 py-3 text-[13px] leading-relaxed text-ink-muted">
                    {sendBlocked}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={busy !== null || dirty || sendBlocked !== null}
                    className={BTN_PRIMARY}
                  >
                    {busy === 'send'
                      ? 'Sending…'
                      : values.status === 'sent'
                        ? 'Re-send to the guest'
                        : 'Send to the guest'}
                    <IconArrowRight width={15} height={15} />
                  </button>
                  {values.status === 'cancelled' ? (
                    // The way back out of a withdrawal. Without it this screen's only advice was to
                    // retype the whole offer into a new quote.
                    <button
                      type="button"
                      onClick={() => void reinstate()}
                      disabled={busy !== null || !values.id}
                      className={BTN_GHOST}
                    >
                      {busy === 'reinstate' ? 'Reinstating…' : 'Reinstate as a draft'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void withdraw()}
                      disabled={busy !== null || !values.id}
                      className={`${BTN_GHOST} !border-coral/40 !text-coral hover:!border-coral`}
                    >
                      {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
                    </button>
                  )}
                  {bookingPaid && (
                    <button
                      type="button"
                      onClick={() => void sendBalance()}
                      disabled={busy !== null || !values.ref}
                      className={BTN_GHOST}
                    >
                      {busy === 'balance' ? 'Creating link…' : 'Send balance link'}
                    </button>
                  )}
                </div>
                {values.status === 'sent' && (
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
                    <span className="font-bold text-ink">
                      To change a sent quote, just change it.
                    </span>{' '}
                    Edit the lines, save, and press Re-send — there is no need to withdraw first,
                    and nothing is charged until the guest pays. Re-sending mints a NEW link and the
                    previous one stops working, which is what you want after a re-price and what to
                    avoid if the guest is mid-payment.
                  </p>
                )}

                {link && (
                  <div className="mt-4 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] p-3.5">
                    <p className="mb-2 text-[12.5px] font-bold text-ink">
                      The guest’s link — copy it if they ask for it on WhatsApp
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        readOnly
                        value={link}
                        aria-label="Public quote link"
                        onFocus={(e) => e.currentTarget.select()}
                        className={`${INPUT_CLS} min-w-[220px] flex-1 font-mono text-[12px]`}
                      />
                      <button type="button" onClick={() => void copyLink()} className={BTN_GHOST}>
                        {copied ? 'Copied' : 'Copy link'}
                      </button>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                      Shown once, here. It is not stored on our side — only the hash of it is — so
                      if you lose it, press Send again and the guest gets a fresh link.
                    </p>
                  </div>
                )}

                {bookingPaid && (
                  <div className="mt-4 border-t border-[#EEF1F3] pt-4">
                    <p className="mb-1.5 text-[12.5px] font-bold text-ink">Balance</p>
                    <p className="mb-3 text-[12.5px] leading-relaxed text-ink-muted">
                      {payInFull || balanceAmount === 0 ? (
                        <>
                          This was a pay-in-full quote, so the guest already paid the whole amount —
                          there should be no balance to collect. The link refuses if nothing is
                          owed.
                        </>
                      ) : balanceAmount === null ? (
                        <>
                          The deposit confirmed the booking and reserved the seat. Send the durable
                          balance link and the guest can pay the remainder whenever — it stays live
                          until the balance clears.
                        </>
                      ) : (
                        <>
                          The deposit confirmed the booking. A{' '}
                          <span className="font-bold text-ink">{eurFromMinor(balanceAmount)}</span>{' '}
                          balance is still to collect — send the durable balance link and the guest
                          can pay it whenever.
                        </>
                      )}
                    </p>
                    {balanceLink && (
                      <div className="rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] p-3.5">
                        <p className="mb-2 text-[12.5px] font-bold text-ink">
                          The guest’s balance link — copy it to them
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <input
                            readOnly
                            value={balanceLink}
                            aria-label="Balance payment link"
                            onFocus={(e) => e.currentTarget.select()}
                            className={`${INPUT_CLS} min-w-[220px] flex-1 font-mono text-[12px]`}
                          />
                          <button
                            type="button"
                            onClick={() => void copyBalance()}
                            className={BTN_GHOST}
                          >
                            {balanceCopied ? 'Copied' : 'Copy link'}
                          </button>
                        </div>
                        <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                          Durable: it mints a fresh checkout each time the guest opens it, so it
                          works for as long as the balance is owed.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
