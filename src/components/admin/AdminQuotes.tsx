'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import {
  AdminError,
  AdminHeading,
  BTN_GHOST,
  Card,
  Checklist,
  Field,
  INPUT_CLS,
  Panel,
  PANEL_BODY,
  SELECT_CLS,
  Segmented,
  StatusChip,
  TEXTAREA_CLS,
  buttonClass,
} from '@/components/admin/ui';
import { IconArrowRight, IconX } from '@/components/ui/icons';
import { fmtDate, fmtDateTime } from '@/lib/admin/format';
import { useDialog } from '@/lib/a11y/useDialog';
import { SITE } from '@/lib/seo/site';
import { lineSubtotalMinor, transportFareMinorOf } from '@/lib/quotes/totals';
import { totalsMismatch, type StatedAmount } from '@/lib/quotes/reconcile';
import {
  cancelQuote,
  duplicateQuote,
  loadGuestHistory,
  loadQuote,
  reinstateQuote,
  saveQuote,
  sendBalanceLink,
  sendQuote,
  type GuestHistory,
  type QuoteBookingSummary,
} from '@/lib/admin/quotes';
import { DraftFromEmail } from '@/components/admin/quotes/DraftFromEmail';
import { EmailPreview } from '@/components/admin/quotes/EmailPreview';
import { QuoteLines } from '@/components/admin/quotes/QuoteLines';
import { QuoteWorklist } from '@/components/admin/quotes/QuoteWorklist';
import { FreshLink } from '@/components/admin/quotes/FreshLink';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';
import { EMPTY_PICKUP, type QuotePickup } from '@/components/admin/quotes/pickup';
import { DatePicker } from '@/components/ui/DatePicker';
import { useAssistant, useAssistantContext } from '@/components/admin/assistant/AssistantProvider';
import {
  PAYMENT_PLAN_OPTIONS,
  PAY_IN_FULL_BPS,
  applyPlan,
  convertedBookingKind,
  depositBpsFromPercent,
  depositPercentFromBps,
  dueNowSummary,
  emptyQuoteForm,
  eurFromMinor,
  formFromQuote,
  formLineProblem,
  formTotalMinor,
  planOf,
  quoteBreakdown,
  quoteInputFromForm,
  refusalMessage,
  sendBlockReason,
  sendRefusal,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import { isPastValidity, quoteStage } from '@/components/admin/quotes/worklist';
import { looksLikeEmail, returningGuestNote } from '@/components/admin/quotes/guest';
import {
  balanceWhatsAppText,
  quoteWhatsAppText,
  whatsappNumber,
} from '@/components/admin/quotes/whatsapp';

/**
 * /admin/quotes — draft a priced offer, email it to a guest, and watch what happens to it.
 *
 * TWO SCREENS IN ONE COMPONENT: the worklist (`QuoteWorklist`, quotes grouped by what to do next)
 * and the editor below, which is ONE page — guest, lines, payment plan, notes and a live summary with
 * the one Send button — after the back-office redesign (phase 1) replaced the old rail of four panes.
 *
 * ── ONE SEND, AND IT SAVES FIRST ───────────────────────────────────────────────────────────────
 * The send route emails the STORED quote, not the form, so Send saves, re-reads the stored row,
 * checks `sendRefusal` against what was stored, and only then sends. A save that fails sends nothing.
 * "Save draft" remains for a quote that is not ready to go.
 *
 * ── WHAT THIS SCREEN REFUSES TO DO, because the money path would refuse it later ───────────────
 *  - price money in anything but whole cents (`state.ts` parses the typed string; nothing here ever
 *    holds a euro float);
 *  - keep a tour line at a price the catalogue does not support (it becomes a custom line);
 *  - send a quote whose lines are half-typed, that totals nothing, or that `sendRefusal` refuses
 *    (`sendBlockReason` is shown beside the disabled button);
 *  - re-price a quote the guest has already opened checkout for (`saveQuote`'s guard; the screen also
 *    locks the lines so nobody types into a quote that cannot be saved).
 *
 * Every refusal reaches the operator through `refusalMessage`, because PostgREST errors are plain
 * objects, not `Error`s.
 */

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
  // The worklist, or the quote being edited (null id = a new one; `ai` opens the enquiry drafter).
  const [editing, setEditing] = useState<{ id: string | null; ai?: boolean } | null>(null);

  // The assistant hands an enquiry over through its context. Keyed on the VALUE, not on mount:
  // applying while already on this screen changes no route and remounts nothing, so a mount-effect
  // silently did nothing — the bug the operator hit as "pressing open does nothing".
  const handoff = useAssistant()?.quoteHandoff ?? null;
  useEffect(() => {
    if (handoff) setEditing({ id: null, ai: true });
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
      startWithDrafter={Boolean(editing.ai)}
      onClose={() => setEditing(null)}
      // Duplicating leaves this quote and opens the COPY. The `key` below is the id, so switching it
      // remounts the editor rather than leaving the old quote's form state on the new row.
      onOpen={(id) => setEditing({ id })}
      key={editing.id ?? 'new-quote'}
    />
  ) : (
    <QuoteWorklist
      onOpen={(id) => setEditing({ id })}
      onNew={(ai) => setEditing({ id: null, ai })}
    />
  );
}

/* ------------------------------------------------------------------------------------------- */
/* The editor                                                                                    */
/* ------------------------------------------------------------------------------------------- */

/** What the editor shows about the stored row beyond the form: its history and its booking. */
interface StoredMeta {
  createdAt: string;
  sentAt: string | null;
  booking: QuoteBookingSummary | null | undefined;
}

function QuoteEditor({
  id,
  startWithDrafter,
  onClose,
  onOpen,
}: {
  id: string | null;
  startWithDrafter: boolean;
  onClose: () => void;
  /** Leave this quote and open another — the copy `duplicate()` just created. */
  onOpen: (id: string) => void;
}) {
  // Internal notes are owner-grantable (money.notes). The value stays in the form state, so saving
  // without the field leaves the note as it was.
  const showNotes = can(useAdminAccess(), 'money.notes');
  const [form, setForm] = useState<QuoteFormValues | null>(id ? null : emptyQuoteForm());
  const [meta, setMeta] = useState<StoredMeta | null>(null);
  const [loading, setLoading] = useState(Boolean(id));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The pickup chosen on the map, shared by every line so the next one pre-fills it. Session only.
  const [pickup, setPickup] = useState<QuotePickup>(EMPTY_PICKUP);
  // Figures the pasted enquiry thread itself stated (read from the text, never the AI), shown beside
  // the total so a discrepancy — the staff €536-vs-€616 case — is caught before sending.
  const [statedAmounts, setStatedAmounts] = useState<StatedAmount[]>([]);
  const [dirty, setDirty] = useState(false);
  // True while the drafter is composing: Save and Send wait, so neither can land mid-compose and
  // orphan the in-flight draft into a duplicate quote.
  const [drafting, setDrafting] = useState(false);
  /** The public link the last send returned — the raw token's only home on our side. */
  const [link, setLink] = useState<string | null>(null);
  /** The balance link the last "Send balance link" returned. */
  const [balanceLink, setBalanceLink] = useState<{ url: string; emailed?: boolean } | null>(null);
  const handoff = useAssistant()?.quoteHandoff ?? null;
  const [drafterOpen, setDrafterOpen] = useState(() => startWithDrafter || Boolean(handoff));
  // Once opened, the drafter stays mounted (only hidden), so closing it keeps the pasted text and
  // cannot strand the `drafting` flag that holds Save and Send.
  const [drafterMounted, setDrafterMounted] = useState(drafterOpen);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [history, setHistory] = useState<GuestHistory | null>(null);
  // The negotiated deposit, remembered so "Pay in full" then "Deposit" restores it.
  const rememberedDeposit = useRef(form?.depositBps ?? PAY_IN_FULL_BPS);

  // A hand-off that arrives while a new quote is already open: show the drafter, which consumes it.
  useEffect(() => {
    if (handoff) {
      setDrafterOpen(true);
      setDrafterMounted(true);
    }
  }, [handoff]);

  const reload = useCallback(async (quoteId: string): Promise<QuoteFormValues> => {
    const detail = await loadQuote(quoteId);
    if (!detail) throw new Error('This quote no longer exists.');
    const next = formFromQuote(detail);
    setForm(next);
    setMeta({ createdAt: detail.createdAt, sentAt: detail.sentAt, booking: detail.booking });
    setDirty(false);
    if (next.depositBps < PAY_IN_FULL_BPS) rememberedDeposit.current = next.depositBps;
    if (next.introNote) setIntroOpen(true);
    if (next.internalNotes) setInternalOpen(true);
    return next;
  }, []);

  useEffect(() => {
    if (!id) return;
    reload(id)
      .catch((err: unknown) => setError(refusalMessage(err, 'Could not load this quote.')))
      .finally(() => setLoading(false));
  }, [id, reload]);

  // The returning-guest hint: earlier quotes and paid bookings under this email. Read-only, debounced,
  // and only for something shaped like an email.
  const email = form?.customerEmail ?? '';
  useEffect(() => {
    if (!looksLikeEmail(email)) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadGuestHistory(email)
        .then((h) => {
          if (!cancelled) setHistory(h);
        })
        .catch(() => {
          if (!cancelled) setHistory(null);
        });
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [email]);

  // Tell the assistant what is on this screen. Computed before the early returns — it is a hook.
  useAssistantContext(form ? chatContextOf(form, formTotalMinor(form)) : null);

  const breakdown = useMemo(() => (form ? quoteBreakdown(form) : null), [form]);
  const due = useMemo(() => (form ? dueNowSummary(form) : null), [form]);

  if (loading) return <p className="text-[13px] text-ink-soft">Loading…</p>;
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
  const total = breakdown?.totalMinor ?? null;
  const locked = Boolean(values.convertedAt);
  const stale = isPastValidity(values.validUntil);
  const showDetails = detailsOpen || stale;
  const plan = planOf(values);
  const blockReason = sendBlockReason(values);
  const waNumber = whatsappNumber(values.customerPhone);
  const bookingKind = convertedBookingKind(values.bookingStatus);
  const bookingPaid = bookingKind === 'paid';
  const stage = quoteStage({
    status: values.status,
    validUntil: values.validUntil,
    convertedAt: values.convertedAt,
    booking: meta?.booking,
  });
  const guestNote = history ? returningGuestNote(history, values.id) : null;
  const statedTotals = statedAmounts.filter((a) => a.isTotal);
  const statedShown = statedTotals.length > 0 ? statedTotals : statedAmounts;
  const totalMismatch = total !== null && totalsMismatch(total, statedAmounts);
  const working = busy !== null || drafting;

  function set<K extends keyof QuoteFormValues>(key: K, value: QuoteFormValues[K]) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setNotice(null);
  }
  function setLines(lines: QuoteLineDraft[]) {
    set('lines', lines);
  }

  /** One shape for every mutation: clear the last message, run it, report it. */
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
      // Parsed BEFORE anything is written: every refusal the editor can raise itself lands here.
      const savedId = await saveQuote(quoteInputFromForm(values));
      await reload(savedId);
      return 'Saved.';
    });
  }

  /**
   * Save, then send the stored row. `share` = the operator wants to pass the new link on WhatsApp
   * too: the email still goes (the route's only path), and the same fresh link is offered below.
   */
  async function send(share: boolean) {
    if (blockReason || working) return;
    const resending = values.status === 'sent';
    if (
      resending &&
      !window.confirm(
        `Send quote ${values.ref ?? ''} again to ${values.customerEmail}? This makes a NEW link, and the link the guest already has stops working.`,
      )
    ) {
      return;
    }
    await act('send', async () => {
      const savedId = await saveQuote(quoteInputFromForm(values));
      // The route emails what is STORED, so the refusal is re-checked on the stored row.
      const stored = await reload(savedId);
      const refusal = sendRefusal(stored);
      if (refusal) throw new Error(refusal);
      const result = await sendQuote(savedId);
      setLink(result.url);
      await reload(savedId);
      return share
        ? `Emailed to ${stored.customerEmail}. Now open WhatsApp below — the message carries the same new link.`
        : `Emailed to ${stored.customerEmail}.`;
    });
  }

  async function withdraw() {
    if (!values.id) return;
    if (
      !window.confirm(
        `Withdraw quote ${values.ref ?? ''}? The guest's link stops working and the offer can no ` +
          `longer be paid. You do NOT need to withdraw to change it — edit it and send again ` +
          `instead. If you do withdraw, Reinstate puts it back to a draft.`,
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
      return 'Back to a draft. Change what you need, then send — the guest gets a fresh link.';
    });
  }

  /** Copy this quote into a new draft and open it — the only way to re-offer a paid quote. */
  async function duplicate() {
    if (!values.id) return;
    if (dirty && !window.confirm('Duplicate the SAVED quote? Unsaved changes are not copied.')) {
      return;
    }
    await act('duplicate', async () => {
      onOpen(await duplicateQuote(values.id!));
      return null;
    });
  }

  /**
   * Email the balance payment link for a converted, deposit-confirmed quote. The amount owed lives on
   * the BOOKING and is read server-side, so the route's own refusal ("nothing owed") is shown verbatim.
   */
  async function sendBalance() {
    if (!values.ref) return;
    if (
      !window.confirm(
        `Email a balance payment link to ${values.customerEmail}? A balance link sent earlier stops working; the guest’s quote link is not affected.`,
      )
    ) {
      return;
    }
    await act('balance', async () => {
      const result = await sendBalanceLink(values.ref!);
      setBalanceLink({ url: result.url, emailed: result.emailed });
      return result.emailed === false
        ? 'Balance link ready, but the email could not be sent — copy it to the guest.'
        : `Balance link emailed to ${values.customerEmail || 'the guest'}.`;
    });
  }

  const owed = meta?.booking ? meta.booking.balanceDueMinor : null;
  const tagCls = 'rounded-md bg-line-soft px-2 py-0.5 text-[12px] font-semibold text-ink-muted';

  return (
    <div>
      <AdminHeading
        title={values.ref ? `Quote ${values.ref}` : 'New quote'}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusChip tone={stage.tone}>{stage.label}</StatusChip>
            {dirty ? (
              <span className="font-semibold text-ink-muted">Unsaved changes</span>
            ) : (
              values.id && <span>Saved</span>
            )}
          </span>
        }
        action={
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onClose} className={BTN_GHOST}>
              Back
            </button>
            {!values.id && (
              <button
                type="button"
                onClick={() => {
                  setDrafterOpen((v) => !v);
                  setDrafterMounted(true);
                }}
                aria-expanded={drafterOpen}
                className={buttonClass('ai')}
              >
                <GeminiSpark size={15} /> Draft from an enquiry
              </button>
            )}
            {values.id && (
              // On EVERY saved quote, a paid one included — that is the case with no other way out.
              <button
                type="button"
                onClick={() => void duplicate()}
                disabled={working}
                className={BTN_GHOST}
                title="Copy the guest, the lines, the notes and the deposit into a new draft"
              >
                {busy === 'duplicate' ? 'Duplicating…' : 'Duplicate'}
              </button>
            )}
            {values.id &&
              (values.status === 'cancelled' ? (
                <button
                  type="button"
                  onClick={() => void reinstate()}
                  disabled={working}
                  className={BTN_GHOST}
                >
                  {busy === 'reinstate' ? 'Reinstating…' : 'Reinstate as a draft'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void withdraw()}
                  disabled={working}
                  className={buttonClass('danger')}
                >
                  {busy === 'withdraw' ? 'Withdrawing…' : 'Withdraw'}
                </button>
              ))}
          </span>
        }
      />

      {error && <AdminError>{error}</AdminError>}
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-teal-tint px-3 py-2.5 text-[13px] font-medium text-teal-dark"
        >
          {notice}
        </p>
      )}
      {values.convertedAt && (
        <p className="mb-4 rounded-lg bg-gold-tint px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          {bookingKind === 'paid'
            ? 'The guest has accepted and paid this quote, so its lines and total can no longer be changed. The booking is the live record now. To offer them a change, press Duplicate: it copies the guest, the lines and the deposit into a new draft and leaves this one alone.'
            : bookingKind === 'pending'
              ? 'The guest has opened checkout for this quote but hasn’t finished paying — nothing is locked in yet. Its lines can’t be changed while that checkout is open.'
              : bookingKind === 'abandoned'
                ? 'The guest opened checkout but didn’t complete payment, so the booking expired without being paid — nothing was charged. The guest can still pay from their existing link while the quote is valid.'
                : 'This quote was converted to a booking that is now closed. Check the bookings screen for its current state.'}
        </p>
      )}
      {values.status === 'cancelled' && !values.convertedAt && (
        <p className="mb-4 rounded-lg bg-line-soft px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          This quote is withdrawn and its old link no longer opens. Nothing is lost:{' '}
          <span className="font-bold">Reinstate as a draft</span> (top of the page) puts it back so
          you can change it and send a fresh link, or <span className="font-bold">Duplicate</span>{' '}
          copies it into a new offer.
        </p>
      )}

      <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-3.5">
          {!values.id && drafterMounted && (
            <div hidden={!drafterOpen}>
              {
                <DraftFromEmail
                  onBusyChange={setDrafting}
                  onDraft={(draft, amounts) => {
                    // The thread's stated figures are kept even when the AI produced no draft.
                    setStatedAmounts(amounts);
                    if (!draft) return;
                    if (
                      dirty &&
                      !window.confirm('Replace what you have entered with the drafted quote?')
                    ) {
                      return;
                    }
                    setForm(draft);
                    setDirty(true);
                    if (draft.introNote) setIntroOpen(true);
                    if (draft.internalNotes) setInternalOpen(true);
                    if (draft.depositBps < PAY_IN_FULL_BPS) {
                      rememberedDeposit.current = draft.depositBps;
                    }
                    setNotice(
                      'Draft loaded from the email — review and price the lines before sending.',
                    );
                  }}
                />
              }
            </div>
          )}

          <Panel title="Guest" meta={guestNote ?? undefined}>
            <div className={`${PANEL_BODY} flex flex-col gap-3`}>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Guest name">
                  <input
                    value={values.customerName}
                    onChange={(e) => set('customerName', e.target.value)}
                    disabled={locked}
                    className={INPUT_CLS}
                    placeholder="Marie Dupont"
                    autoComplete="off"
                  />
                </Field>
                <Field
                  label="Phone or WhatsApp"
                  hint={
                    values.customerPhone.trim() && 'reason' in waNumber
                      ? 'Add the country code (+44…) to send on WhatsApp.'
                      : undefined
                  }
                >
                  <input
                    type="tel"
                    value={values.customerPhone}
                    onChange={(e) => set('customerPhone', e.target.value)}
                    disabled={locked}
                    className={INPUT_CLS}
                    placeholder="+44 7700 900123"
                    autoComplete="off"
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    value={values.customerEmail}
                    onChange={(e) => set('customerEmail', e.target.value)}
                    disabled={locked}
                    className={INPUT_CLS}
                    placeholder="marie@example.com"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={tagCls}>{values.locale === 'fr' ? 'Français' : 'English'}</span>
                <span
                  className={
                    stale
                      ? 'rounded-md bg-coral-tint px-2 py-0.5 text-[12px] font-semibold text-coral-dark'
                      : tagCls
                  }
                >
                  {stale ? 'Expired ' : 'Valid until '}
                  {fmtDate(`${values.validUntil}T12:00:00+04:00`)}
                </span>
                <span className={tagCls}>Hotel room: {values.roomOrCabin.trim() || 'not set'}</span>
                {!stale && (
                  <button
                    type="button"
                    onClick={() => setDetailsOpen((v) => !v)}
                    aria-expanded={showDetails}
                    className={buttonClass('quiet', 'sm')}
                  >
                    {showDetails ? 'Hide details' : 'Change details'}
                  </button>
                )}
              </div>
              {showDetails && (
                <div className="grid gap-3 border-t border-line-soft pt-3 sm:grid-cols-2">
                  <Field
                    label="Valid until"
                    hint="After this date the link stops opening and the payment path refuses the quote."
                  >
                    {locked ? (
                      <input value={values.validUntil} disabled className={INPUT_CLS} />
                    ) : (
                      <DatePicker
                        value={values.validUntil}
                        onChange={(v) => set('validUntil', v)}
                        className={INPUT_CLS}
                      />
                    )}
                  </Field>
                  <Field
                    label="Language"
                    hint="Of this offer — and of the guest’s confirmation email and VAT invoice after they pay."
                  >
                    <select
                      value={values.locale}
                      onChange={(e) => set('locale', e.target.value === 'fr' ? 'fr' : 'en')}
                      disabled={locked}
                      className={SELECT_CLS}
                    >
                      <option value="en">English</option>
                      <option value="fr">Français</option>
                    </select>
                  </Field>
                  <Field
                    label="Hotel room number"
                    hint="For the driver’s gate pass. Shows on the calendar day sheet. Optional."
                  >
                    <input
                      value={values.roomOrCabin}
                      onChange={(e) => set('roomOrCabin', e.target.value)}
                      disabled={locked}
                      className={INPUT_CLS}
                      placeholder="e.g. Room 214"
                    />
                  </Field>
                  <Field
                    label="Currency"
                    hint="Quotes are EUR only — the payment ledger is EUR-only."
                  >
                    <input value="EUR" readOnly disabled className={INPUT_CLS} />
                  </Field>
                </div>
              )}
            </div>
          </Panel>

          <QuoteLines
            form={values}
            setLines={setLines}
            pickup={pickup}
            setPickup={setPickup}
            locked={locked}
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIntroOpen((v) => !v)}
              aria-expanded={introOpen}
              className={BTN_GHOST}
            >
              Note to the guest
            </button>
            {showNotes && (
              <button
                type="button"
                onClick={() => setInternalOpen((v) => !v)}
                aria-expanded={internalOpen}
                className={BTN_GHOST}
              >
                Internal note
              </button>
            )}
            <span className="text-[12px] text-ink-soft">
              Prices are in euros. Nothing is charged until the guest pays.
            </span>
          </div>
          {introOpen && (
            <Panel
              title="Note to the guest"
              meta="Printed above the prices, in the email and on their page"
            >
              <div className={PANEL_BODY}>
                <textarea
                  value={values.introNote}
                  onChange={(e) => set('introNote', e.target.value)}
                  rows={4}
                  aria-label="Note to the guest"
                  disabled={locked}
                  placeholder="As discussed on the phone — this includes the transfer from your hotel."
                  className={TEXTAREA_CLS}
                />
              </div>
            </Panel>
          )}
          {showNotes && internalOpen && (
            <Panel title="Internal note" meta="Staff only — never sent">
              <div className={PANEL_BODY}>
                <textarea
                  value={values.internalNotes}
                  onChange={(e) => set('internalNotes', e.target.value)}
                  rows={3}
                  aria-label="Internal note, never sent to the guest"
                  disabled={locked}
                  placeholder="Margin is thin at this price — don’t discount further."
                  className={TEXTAREA_CLS}
                />
                <p className="mt-2 text-[12px] leading-relaxed text-ink-soft">
                  Not loaded by the send route and not a field the email accepts, so it cannot reach
                  the guest.
                </p>
              </div>
            </Panel>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <Panel label="Summary and send">
            <div className={`${PANEL_BODY} flex flex-col gap-3`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-semibold text-ink-muted">Total</span>
                <span className="text-[24px] font-bold tracking-[-0.02em] text-ink">
                  {total === null ? '—' : eurFromMinor(total)}
                </span>
              </div>
              {breakdown && breakdown.transfersMinor > 0 && (
                <dl className="flex flex-col gap-1 text-[12.5px] text-ink-muted">
                  <div className="flex justify-between">
                    <dt>Items</dt>
                    <dd>{eurFromMinor(breakdown.itemsMinor)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Transfers</dt>
                    <dd>{eurFromMinor(breakdown.transfersMinor)}</dd>
                  </div>
                </dl>
              )}

              {statedAmounts.length > 0 && (
                <div
                  className={`rounded-lg px-3 py-2.5 text-[12.5px] leading-relaxed ${
                    totalMismatch ? 'bg-coral-tint text-coral-dark' : 'bg-gold-tint text-ink'
                  }`}
                >
                  <p className="font-bold">Cross-check against the email</p>
                  <p className="mt-1">
                    {statedTotals.length > 0
                      ? 'The thread stated these totals: '
                      : 'The thread mentioned these figures: '}
                    <span className="font-semibold">
                      {statedShown.map((a) => eurFromMinor(a.amountMinor)).join(' · ')}
                    </span>
                    . This quote totals {total === null ? '—' : eurFromMinor(total)}.
                  </p>
                  {totalMismatch && (
                    <p className="mt-1 font-bold">
                      The total matches none of them — reconcile the lines before sending.
                    </p>
                  )}
                </div>
              )}

              <Segmented
                options={PAYMENT_PLAN_OPTIONS}
                value={plan}
                onChange={(next) => {
                  setForm((prev) =>
                    prev ? applyPlan(prev, next, rememberedDeposit.current) : prev,
                  );
                  setDirty(true);
                  setNotice(null);
                }}
                label="Payment plan"
                wide
                disabled={locked}
              />
              {plan === 'deposit' && (
                <Field
                  label="Deposit to confirm"
                  hint="The rest is collected later with the balance link."
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={99}
                      step={1}
                      value={depositPercentFromBps(values.depositBps)}
                      disabled={locked}
                      onChange={(e) => {
                        const bps = depositBpsFromPercent(Number(e.target.value));
                        rememberedDeposit.current = bps;
                        set('depositBps', bps);
                      }}
                      className={`${INPUT_CLS} w-24 text-right`}
                    />
                    <span className="text-[13px] font-semibold text-ink-muted">%</span>
                  </span>
                </Field>
              )}
              <DueNowText due={due} />

              <Checklist
                label="Before sending"
                items={[
                  {
                    id: 'guest',
                    label: 'Guest name and email',
                    done: Boolean(values.customerName.trim() && values.customerEmail.trim()),
                  },
                  {
                    id: 'lines',
                    label: 'Every item priced',
                    done: values.lines.length > 0 && !formLineProblem(values) && (total ?? 0) > 0,
                  },
                  {
                    id: 'valid',
                    label: `Valid until ${fmtDate(`${values.validUntil}T12:00:00+04:00`)}`,
                    done: !stale,
                  },
                ]}
              />

              {!locked && (
                <div className="flex flex-col gap-2">
                  {blockReason && (
                    <p className="text-[12.5px] leading-relaxed text-ink-muted">{blockReason}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void send(false)}
                    disabled={working || blockReason !== null}
                    className={`${buttonClass('primary')} w-full`}
                  >
                    {busy === 'send'
                      ? 'Sending…'
                      : values.status === 'sent'
                        ? 'Send again by email'
                        : 'Send by email'}
                    <IconArrowRight width={15} height={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void send(true)}
                    disabled={working || blockReason !== null || 'reason' in waNumber}
                    className={`${BTN_GHOST} w-full`}
                  >
                    Send and share on WhatsApp
                  </button>
                  <p className="text-[12px] leading-relaxed text-ink-soft">
                    {'reason' in waNumber
                      ? waNumber.reason
                      : 'Emails the quote, then gives you the same new link to send on WhatsApp.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={working}
                    className={`${BTN_GHOST} w-full`}
                  >
                    {busy === 'save'
                      ? 'Saving…'
                      : values.status === 'draft' || !values.id
                        ? 'Save draft'
                        : 'Save without sending'}
                  </button>
                  {values.status === 'sent' && (
                    <p className="text-[12px] leading-relaxed text-ink-soft">
                      To change a sent quote, change it and send again — no need to withdraw.
                      Sending again makes a new link and the old one stops working.
                    </p>
                  )}
                </div>
              )}

              {link && (
                <FreshLink
                  url={link}
                  heading="The guest’s new link"
                  inputLabel="Public quote link"
                  phone={values.customerPhone}
                  message={quoteWhatsAppText({
                    customerName: values.customerName,
                    ref: values.ref ?? '',
                    url: link,
                    locale: values.locale,
                  })}
                />
              )}
            </div>
          </Panel>

          {bookingPaid && (
            <Panel title="Balance">
              <div className={`${PANEL_BODY} flex flex-col gap-3`}>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  {owed === null ? (
                    'The deposit confirmed the booking. Send the balance link and the guest can pay the rest whenever — it stays live until the balance clears.'
                  ) : owed > 0 && stage.group === 'balance' ? (
                    <>
                      The deposit confirmed the booking.{' '}
                      <span className="font-bold text-ink">{eurFromMinor(owed)}</span> is still to
                      collect.
                    </>
                  ) : (
                    'Nothing is owed on this booking. The link refuses if there is no balance.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => void sendBalance()}
                  disabled={working || !values.ref}
                  className={BTN_GHOST}
                >
                  {busy === 'balance' ? 'Sending…' : 'Send balance link'}
                </button>
                {balanceLink && (
                  <FreshLink
                    url={balanceLink.url}
                    heading="The balance link"
                    inputLabel="Balance payment link"
                    phone={values.customerPhone}
                    message={balanceWhatsAppText({
                      customerName: values.customerName,
                      url: balanceLink.url,
                      locale: values.locale,
                    })}
                    note="It opens a fresh checkout each time, for as long as the balance is owed."
                  />
                )}
              </div>
            </Panel>
          )}

          <GuestSees form={values} onOpenPreview={() => setPreviewOpen(true)} />

          <Panel title="History">
            <ul>
              <HistoryItem done label="Draft started" when={meta?.createdAt ?? null} />
              <HistoryItem
                done={Boolean(meta?.sentAt)}
                label={meta?.sentAt ? 'Last sent' : 'Not sent yet'}
                when={meta?.sentAt ?? null}
              />
              {values.convertedAt && (
                <HistoryItem done label="Guest opened checkout" when={values.convertedAt} />
              )}
              {values.convertedAt && (
                <HistoryItem done={bookingPaid} label={`Booking: ${stage.label}`} when={null} />
              )}
            </ul>
          </Panel>
        </div>
      </div>

      {previewOpen && <PreviewDialog form={values} onClose={() => setPreviewOpen(false)} />}
    </div>
  );
}

function DueNowText({ due }: { due: ReturnType<typeof dueNowSummary> }) {
  if (!due) {
    return (
      <p className="text-[12.5px] text-ink-soft">The amounts show once every price is a number.</p>
    );
  }
  if (due.plan === 'per_date') {
    if (due.schedule.length === 0) {
      return (
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          No item has a date yet. Each date becomes one payment; until then the guest would pay{' '}
          <span className="font-bold text-ink">{eurFromMinor(due.nowMinor)}</span> to confirm.
        </p>
      );
    }
    return (
      <div className="text-[12.5px] text-ink-muted">
        <p className="mb-1.5">One payment per activity date, each due before that day:</p>
        <ul className="flex flex-col gap-1">
          {due.schedule.map((s) => (
            <li key={s.seq} className="flex justify-between gap-3">
              <span>
                {fmtDate(`${s.dueOn}T12:00:00+04:00`)}
                {s.seq === 0 && ' — paid to confirm'}
              </span>
              <span className="font-semibold text-ink">{eurFromMinor(s.amountMinor)}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (due.laterMinor === 0) {
    return (
      <p className="text-[12.5px] text-ink-muted">
        The guest pays <span className="font-bold text-ink">{eurFromMinor(due.nowMinor)}</span> now.
      </p>
    );
  }
  return (
    <p className="text-[12.5px] leading-relaxed text-ink-muted">
      The guest pays <span className="font-bold text-ink">{eurFromMinor(due.nowMinor)}</span> now to
      confirm; <span className="font-bold text-ink">{eurFromMinor(due.laterMinor)}</span> is
      collected later with the balance link.
    </p>
  );
}

function HistoryItem({ done, label, when }: { done: boolean; label: string; when: string | null }) {
  return (
    <li className="flex items-center gap-2.5 border-b border-line-soft px-4 py-2.5 text-[13px] last:border-b-0">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${done ? 'bg-teal' : 'bg-[#B9C5C8]'}`}
      />
      <span className={`min-w-0 flex-1 ${done ? 'text-ink' : 'text-ink-muted'}`}>{label}</span>
      {when && <span className="text-[12px] text-ink-soft">{fmtDateTime(when)}</span>}
    </li>
  );
}

/** A small picture of the guest's quote page, from the same parse the save uses. */
function GuestSees({ form, onOpenPreview }: { form: QuoteFormValues; onOpenPreview: () => void }) {
  const items = useMemo(() => {
    try {
      return quoteInputFromForm(form).items;
    } catch {
      return null;
    }
  }, [form]);
  const total = items
    ? items.reduce((s, i) => s + lineSubtotalMinor(i) + transportFareMinorOf(i), 0)
    : null;
  const fr = form.locale === 'fr';
  return (
    <Panel
      title="What the guest sees"
      actions={
        <button type="button" onClick={onOpenPreview} className={buttonClass('quiet', 'sm')}>
          Open full preview
        </button>
      }
    >
      <div className={PANEL_BODY}>
        <div className="rounded-lg border border-line bg-white px-3.5 py-3 text-[12.5px] shadow-[0_1px_2px_rgba(10,46,54,0.08)]">
          <p className="mb-2 font-bold text-ink">
            {fr ? `Votre devis ${SITE.name}` : `Your quote from ${SITE.name}`}
          </p>
          {items === null ? (
            <p className="text-ink-soft">Finish the prices to see the guest’s page.</p>
          ) : items.length === 0 ? (
            <p className="text-ink-soft">No items yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {items.map((item, i) => (
                <li key={i}>
                  <span className="flex justify-between gap-3 text-ink">
                    <span className="min-w-0 truncate">
                      {item.description?.trim() || item.priceLabel || 'Item'}
                    </span>
                    <span>{eurFromMinor(lineSubtotalMinor(item))}</span>
                  </span>
                  {transportFareMinorOf(item) > 0 && (
                    <span className="flex justify-between gap-3 text-ink-soft">
                      <span>{fr ? 'Transfert aller-retour' : 'Round-trip transfer'}</span>
                      <span>{eurFromMinor(transportFareMinorOf(item))}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {total !== null && (
            <p className="mt-2 flex justify-between border-t border-line-soft pt-2 font-bold text-ink">
              <span>Total</span>
              <span>{eurFromMinor(total)}</span>
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function PreviewDialog({ form, onClose }: { form: QuoteFormValues; onClose: () => void }) {
  const dialogRef = useDialog(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close the preview"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="The email the guest receives"
        className="relative flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-y-auto rounded-t-2xl bg-white sm:rounded-2xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line-soft bg-white px-4 py-3">
          <span className="text-[14px] font-bold text-ink">The email the guest receives</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={buttonClass('quiet', 'sm')}
          >
            <IconX width={15} height={15} />
          </button>
        </header>
        <div className="p-4">
          <EmailPreview form={form} />
        </div>
      </div>
    </div>
  );
}
