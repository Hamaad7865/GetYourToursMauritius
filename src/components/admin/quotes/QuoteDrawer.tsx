'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import {
  cancelQuote,
  duplicateQuote,
  loadQuote,
  reinstateQuote,
  sendBalanceLink,
  sendQuote,
  type QuoteDetail,
  type QuoteItem,
  type QuoteRow,
} from '@/lib/admin/quotes';
import { mailtoHref } from '@/lib/admin/contact-links';
import { fmtDate, mauDay } from '@/lib/admin/format';
import { GuestAvatar } from '@/components/admin/GuestAvatar';
import {
  CopyIcon,
  MoreMenu,
  PANEL_FOCUS_RING,
  PanelCard,
  SidePanel,
  type MenuAction,
} from '@/components/admin/SidePanel';
import { AdminError, StatusChip, buttonClass } from '@/components/admin/ui';
import { IconCalendar, IconChat, IconMail } from '@/components/ui/icons';
import { FreshLink } from '@/components/admin/quotes/FreshLink';
import { eurFromMinor, refusalMessage } from '@/components/admin/quotes/state';
import {
  balanceWhatsAppText,
  quoteWhatsAppText,
  whatsappNumber,
} from '@/components/admin/quotes/whatsapp';
import {
  balanceLinkQuestion,
  dayMonth,
  quotePanelMoney,
  quotePrimary,
  quoteProgress,
  quoteStage,
  rowActions,
  validityCountdown,
  type PaidLaterFlag,
  type StepState,
} from '@/components/admin/quotes/worklist';

/* THE QUOTE PANEL: what opens when a quote is chosen on the Quotes worklist.
 *
 * The owner's mock-up (16 Nov 2026) in the back office's own colours and type, in the same frame as
 * the booking panel (`SidePanel`): the stage and the guest on top, then the one figure that matters at
 * this stage, how far the quote got (Created → Sent → Checkout → Paid), what is in it, and its details.
 * The footer holds WhatsApp and Email, "More", Edit, and the one main action the stage needs.
 *
 * Every action is one the worklist or the editor already had, with its confirmation word for word, and
 * goes through the same function. There is no "copy link" of its own: the guest's link exists only in
 * the answer to a send (sending makes a new one), so the new link is offered right after a send. */

const TITLE_ID = 'quote-panel-title';

/** What the main button and the "More" button say while an action runs. */
const BUSY_WORDS: Record<string, string> = {
  send: 'Sending…',
  balance: 'Sending…',
  duplicate: 'Copying…',
  withdraw: 'Withdrawing…',
  reinstate: 'Reinstating…',
};

export interface QuoteDrawerProps {
  /** The quote as the worklist read it: its stage comes from the same rules as its row. */
  row: QuoteRow;
  paidLater: PaidLaterFlag | undefined;
  prevId: string | null;
  nextId: string | null;
  position: { index: number; count: number } | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** Leave for the full editor (Edit, Finish, a new copy). */
  onEdit: (id: string) => void;
  /** Something on the quote changed: the worklist reloads. */
  onChanged: () => Promise<void>;
  /** The UTC day (validity) and the Mauritius day (trips), YYYY-MM-DD. */
  today: string;
  todayMu: string;
}

export function QuoteDrawer(props: QuoteDrawerProps) {
  const { row, prevId, nextId, position, onNavigate, onClose } = props;
  // A send in flight holds the panel open: closing mid-send would hide the new link.
  const busyRef = useRef(false);
  const onBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
  }, []);
  const mayLeave = useCallback(() => !busyRef.current, []);
  return (
    <SidePanel
      itemKey={row.id}
      titleId={TITLE_ID}
      noun="quote"
      prevId={prevId}
      nextId={nextId}
      position={position}
      onNavigate={onNavigate}
      onClose={onClose}
      mayLeave={mayLeave}
    >
      <QuoteBody key={row.id} {...props} onBusy={onBusy} />
    </SidePanel>
  );
}

type Sent = { kind: 'quote' | 'balance'; url: string; emailed?: boolean };

function QuoteBody({
  row,
  paidLater,
  onNavigate,
  onEdit,
  onChanged,
  today,
  onBusy,
}: QuoteDrawerProps & { onBusy: (busy: boolean) => void }) {
  const showNotes = can(useAdminAccess(), 'money.notes');
  const [detail, setDetail] = useState<QuoteDetail | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    loadQuote(row.id)
      .then((d) => live && setDetail(d))
      .catch((err: unknown) => {
        if (!live) return;
        setDetail(null);
        setLoadError(refusalMessage(err, 'Could not load what is in this quote.'));
      });
    return () => {
      live = false;
    };
  }, [row.id]);

  const stage = quoteStage(row, today);
  const actions = rowActions(row, today);
  const primary = quotePrimary(row, today);
  const money = quotePanelMoney(row, stage, today);
  const steps = quoteProgress(row, stage);
  const wa = whatsappNumber(row.customerPhone);
  const waReady = 'digits' in wa;
  const mail = mailtoHref(row.customerEmail);
  const withdrawable =
    row.status !== 'cancelled' && stage.label !== 'Paid' && stage.group !== 'balance';

  async function act(key: string, task: () => Promise<string | null>) {
    setBusy(key);
    onBusy(true);
    setError(null);
    setMessage(null);
    try {
      const done = await task();
      if (done) setMessage(done);
    } catch (err) {
      setError(refusalMessage(err, 'That did not go through.'));
    } finally {
      setBusy(null);
      onBusy(false);
    }
  }

  function resend(viaWhatsApp: boolean) {
    // The worklist's own questions, word for word.
    const question = viaWhatsApp
      ? `Send quote ${row.ref} on WhatsApp? It is emailed to ${row.customerEmail} again with a NEW link — the link the guest already has stops working — and then you get that same new link to send on WhatsApp.`
      : `Send quote ${row.ref} again to ${row.customerEmail}? This makes a NEW link, and the link the guest already has stops working.`;
    if (!window.confirm(question)) return;
    void act('send', async () => {
      const result = await sendQuote(row.id);
      setSent({ kind: 'quote', url: result.url });
      await onChanged();
      return null;
    });
  }

  function whatsapp() {
    if ('reason' in wa) {
      setError(null);
      setMessage(`${wa.reason} Edit the quote to change it.`);
      return;
    }
    resend(true);
  }

  function sendBalance() {
    if (!window.confirm(balanceLinkQuestion(row.ref, row.customerEmail))) {
      return;
    }
    void act('balance', async () => {
      const result = await sendBalanceLink(row.ref);
      setSent({ kind: 'balance', url: result.url, emailed: result.emailed });
      return null;
    });
  }

  function duplicate() {
    void act('duplicate', async () => {
      const copy = await duplicateQuote(row.id);
      onBusy(false);
      onEdit(copy);
      return null;
    });
  }

  function withdraw() {
    // The editor's own question, word for word.
    if (
      !window.confirm(
        `Withdraw quote ${row.ref}? The guest's link stops working and the offer can no ` +
          `longer be paid. You do NOT need to withdraw to change it — edit it and send again ` +
          `instead. If you do withdraw, Reinstate puts it back to a draft.`,
      )
    ) {
      return;
    }
    void act('withdraw', async () => {
      await cancelQuote(row.id);
      setSent(null);
      await onChanged();
      return 'Withdrawn. The guest’s link no longer opens — choose Reinstate under More to work on it again.';
    });
  }

  function reinstate() {
    void act('reinstate', async () => {
      await reinstateQuote(row.id);
      await onChanged();
      return 'Back to a draft. Change what you need, then send — the guest gets a fresh link.';
    });
  }

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(row.ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* Clipboard refused (an insecure page): the reference is on screen to select. */
    }
  }

  const menu: MenuAction[][] = [
    [
      ...(primary !== 'duplicate'
        ? [{ id: 'duplicate', label: 'Duplicate into a new draft', onSelect: duplicate }]
        : []),
      ...(actions.balance && primary !== 'balance'
        ? [{ id: 'balance', label: 'Send balance link', onSelect: sendBalance }]
        : []),
      ...(row.status === 'cancelled'
        ? [{ id: 'reinstate', label: 'Reinstate as a draft', onSelect: reinstate }]
        : []),
    ],
    withdrawable
      ? [{ id: 'withdraw', label: 'Withdraw quote', onSelect: withdraw, danger: true }]
      : [],
  ];

  const primaryButton = (() => {
    const cls = buttonClass('primary');
    switch (primary) {
      case 'resend':
        return (
          <button
            type="button"
            onClick={() => resend(false)}
            disabled={busy !== null}
            className={cls}
          >
            {busy === 'send' ? 'Sending…' : 'Send again'}
          </button>
        );
      case 'balance':
        return (
          <button type="button" onClick={sendBalance} disabled={busy !== null} className={cls}>
            {busy === 'balance' ? 'Sending…' : 'Send balance link'}
          </button>
        );
      case 'finish':
        return (
          <button
            type="button"
            onClick={() => onEdit(row.id)}
            disabled={busy !== null}
            className={cls}
          >
            Finish quote
          </button>
        );
      case 'duplicate':
        return (
          <button type="button" onClick={duplicate} disabled={busy !== null} className={cls}>
            {busy === 'duplicate' ? 'Copying…' : 'Duplicate'}
          </button>
        );
      case 'booking':
        return (
          <Link href={`/admin/bookings?open=${encodeURIComponent(row.bookingId!)}`} className={cls}>
            Open booking
          </Link>
        );
      default:
        return null;
    }
  })();

  const items = detail?.items ?? [];
  const firstDate = items
    .map((i) => i.startsAt)
    .filter((d): d is string => Boolean(d))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const lastDate = items
    .map((i) => i.endsAt ?? i.startsAt)
    .filter((d): d is string => Boolean(d))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

  return (
    <>
      <header className="shrink-0 border-b border-line-soft px-4 pb-3.5 pt-3.5 sm:px-6 sm:pt-4">
        <div className="flex min-h-9 flex-wrap items-center gap-1.5 pr-[132px] sm:pr-[200px]">
          <StatusChip tone={stage.tone}>{stage.label}</StatusChip>
          <span className="truncate rounded-md bg-ground px-2 py-1 font-mono text-[12px] font-semibold text-ink-muted">
            {row.ref}
          </span>
          <button
            type="button"
            onClick={() => void copyRef()}
            aria-label={`Copy reference ${row.ref}`}
            className={`grid h-7 w-7 place-items-center rounded-md text-ink-soft transition-colors hover:bg-line-soft hover:text-ink motion-reduce:transition-none ${PANEL_FOCUS_RING}`}
          >
            <CopyIcon />
          </button>
          <span role="status" className="sr-only">
            {copied ? 'Reference copied' : ''}
          </span>
        </div>
        <div className="mt-3 flex items-center gap-3.5">
          <GuestAvatar name={row.customerName} size="lg" />
          <div className="min-w-0 flex-1">
            <h2
              id={TITLE_ID}
              className="truncate text-[21px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]"
            >
              {row.customerName}
            </h2>
            <p className="mt-0.5 truncate text-[13px] text-ink-soft">
              {[row.customerEmail, row.customerPhone].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ground px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3">
          {error && <AdminError>{error}</AdminError>}
          {message && (
            <p
              role="status"
              className="rounded-lg bg-teal-tint px-3 py-2.5 text-[13px] font-medium text-teal-dark"
            >
              {message}
            </p>
          )}

          {sent && (
            <PanelCard
              title={sent.kind === 'quote' ? 'Sent' : 'Balance link ready'}
              aside={
                <button
                  type="button"
                  onClick={() => setSent(null)}
                  className={buttonClass('quiet', 'sm')}
                >
                  Done
                </button>
              }
            >
              <p role="status" className="mb-2.5 text-[13px] text-ink">
                {sent.kind === 'balance' && sent.emailed === false
                  ? `The link is ready but the email to ${row.customerEmail} could not be sent — copy it to the guest.`
                  : `Emailed to ${row.customerEmail}.`}
              </p>
              <FreshLink
                url={sent.url}
                heading={sent.kind === 'quote' ? 'The guest’s new link' : 'The balance link'}
                inputLabel={sent.kind === 'quote' ? 'New quote link' : 'Balance payment link'}
                phone={row.customerPhone}
                message={
                  sent.kind === 'quote'
                    ? quoteWhatsAppText({
                        customerName: row.customerName,
                        ref: row.ref,
                        url: sent.url,
                        locale: row.locale,
                      })
                    : balanceWhatsAppText({
                        customerName: row.customerName,
                        url: sent.url,
                        locale: row.locale,
                      })
                }
                note={
                  sent.kind === 'balance'
                    ? 'It opens a fresh checkout each time, for as long as the balance is owed.'
                    : undefined
                }
              />
            </PanelCard>
          )}

          {paidLater && stage.group !== 'done' && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold-tint px-4 py-3">
              <div className="min-w-0 flex-1 basis-56 text-[13px] text-ink-muted">
                <p className="text-[14px] font-semibold text-ink">
                  Guest already paid <span className="font-mono text-[13px]">{paidLater.ref}</span>
                </p>
                If it’s the same trip, withdraw this quote: while it is valid its link can still
                take a second payment.
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate(paidLater.id)}
                  className={buttonClass('ghost', 'sm')}
                >
                  Open {paidLater.ref}
                </button>
                {withdrawable && (
                  <button
                    type="button"
                    onClick={withdraw}
                    disabled={busy !== null}
                    className={buttonClass('dark', 'sm')}
                  >
                    Withdraw
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="rounded-xl bg-ink px-4 py-4 text-white sm:px-5">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-white/75">{money.label}</p>
                <p className="text-[30px] font-bold leading-tight tabular-nums tracking-[-0.02em]">
                  {eurFromMinor(money.minor)}
                </p>
              </div>
              <p className="text-[13px] text-white/75 sm:text-right">{money.sub}</p>
            </div>
            {money.bar && (
              <div
                role="progressbar"
                aria-label="Share of the booking paid"
                aria-valuemin={0}
                aria-valuemax={money.bar.totalMinor}
                aria-valuenow={money.bar.paidMinor}
                className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"
              >
                <div
                  className="h-full rounded-full bg-gold-light"
                  style={{
                    width: `${Math.max(3, Math.min(100, (money.bar.paidMinor / Math.max(1, money.bar.totalMinor)) * 100))}%`,
                  }}
                />
              </div>
            )}
          </div>

          <PanelCard title="Progress">
            <ol className="grid grid-cols-4 gap-2">
              {steps.map((s, i) => (
                <li key={i} className="min-w-0">
                  <span
                    aria-hidden="true"
                    className={`block h-1.5 rounded-full ${STEP_BAR[s.state]}`}
                  />
                  <span
                    className={`mt-2 block truncate text-[13px] font-semibold ${s.state === 'todo' ? 'text-ink-soft' : s.state === 'stopped' ? 'text-coral-dark' : 'text-ink'}`}
                  >
                    {s.label}
                    <span className="sr-only">: {STEP_WORDS[s.state]}</span>
                  </span>
                  <span className="block text-[12px] leading-snug text-ink-soft [overflow-wrap:anywhere]">
                    {s.when}
                  </span>
                </li>
              ))}
            </ol>
          </PanelCard>

          <PanelCard
            title="What’s in it"
            aside={
              firstDate ? (
                <Link
                  href={`/admin/calendar?day=${mauDay(firstDate)}`}
                  className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-teal-dark hover:underline"
                >
                  <IconCalendar width={13} height={13} aria-hidden="true" /> See the day in Calendar
                </Link>
              ) : undefined
            }
          >
            {detail === undefined ? (
              <LinesSkeleton />
            ) : loadError ? (
              <p className="text-[13px] text-coral-dark">{loadError}</p>
            ) : items.length === 0 ? (
              <p className="text-[13px] text-ink-soft">Nothing added yet.</p>
            ) : (
              <>
                <ul className="divide-y divide-line-soft">
                  {items.map((item) => (
                    <LineItem key={item.id} item={item} />
                  ))}
                </ul>
                <div className="mt-2 flex items-baseline justify-between border-t border-line pt-2.5">
                  <span className="text-[13px] font-semibold text-ink">Total</span>
                  <span className="text-[16px] font-bold tabular-nums text-ink">
                    {eurFromMinor(row.totalMinor)}
                  </span>
                </div>
              </>
            )}
          </PanelCard>

          <PanelCard title="Details">
            <dl className="divide-y divide-line-soft text-[13px]">
              <Fact label="Trip">
                {firstDate
                  ? lastDate && mauDay(lastDate) !== mauDay(firstDate)
                    ? `${fmtDate(firstDate)} – ${fmtDate(lastDate)}`
                    : fmtDate(firstDate)
                  : detail === undefined
                    ? '…'
                    : 'No date yet'}
              </Fact>
              <Fact label="Sent">{row.sentAt ? fmtDate(row.sentAt) : 'Not yet'}</Fact>
              <Fact label="Valid until">
                {fmtDate(`${row.validUntil}T12:00:00+04:00`)}
                {stage.group === 'waiting' && (
                  <span
                    className={`block text-[12px] ${validityCountdown(row.validUntil, today).urgent ? 'font-semibold text-coral-dark' : 'text-ink-soft'}`}
                  >
                    {validityCountdown(row.validUntil, today).text}
                  </span>
                )}
              </Fact>
              <Fact label="Payment">{paymentPlan(row)}</Fact>
              {row.roomOrCabin && <Fact label="Room">{row.roomOrCabin}</Fact>}
              <Fact label="Language">{row.locale === 'fr' ? 'French' : 'English'}</Fact>
              {row.bookingId && (
                <Fact label="Booking">
                  <Link
                    href={`/admin/bookings?open=${encodeURIComponent(row.bookingId)}`}
                    className="font-semibold text-teal-dark hover:underline"
                  >
                    Open in Bookings
                  </Link>
                </Fact>
              )}
              <Fact label="Created">{fmtDate(row.createdAt)}</Fact>
            </dl>
          </PanelCard>

          {detail?.introNote && (
            <PanelCard title="Message to the guest">
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                {detail.introNote}
              </p>
            </PanelCard>
          )}
          {showNotes && detail?.internalNotes && (
            <PanelCard title="Private note">
              <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                {detail.internalNotes}
              </p>
            </PanelCard>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line-soft bg-white px-4 py-3 sm:px-6">
        {actions.resend && (
          <button
            type="button"
            onClick={whatsapp}
            disabled={busy !== null}
            aria-disabled={!waReady || undefined}
            className={`${buttonClass('ghost')} ${waReady ? '' : 'opacity-50'}`}
          >
            <IconChat width={15} height={15} aria-hidden="true" />
            WhatsApp
            <span className="sr-only">: send quote {row.ref} again and share the new link</span>
          </button>
        )}
        {mail && (
          <a href={mail} className={buttonClass('ghost')}>
            <IconMail width={15} height={15} aria-hidden="true" />
            Email
            <span className="sr-only"> {row.customerName}</span>
          </a>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <MoreMenu
            groups={menu}
            busyLabel={busy && !['send', 'balance'].includes(busy) ? BUSY_WORDS[busy]! : null}
            disabled={busy !== null}
          />
          {primary !== 'finish' && (
            <button
              type="button"
              onClick={() => onEdit(row.id)}
              disabled={busy !== null}
              className={buttonClass('ghost')}
            >
              Edit
            </button>
          )}
          {primaryButton}
        </div>
      </footer>
    </>
  );
}

const STEP_BAR: Record<StepState, string> = {
  done: 'bg-teal',
  current: 'bg-gold-light',
  stopped: 'bg-coral',
  todo: 'bg-line',
};

const STEP_WORDS: Record<StepState, string> = {
  done: 'done',
  current: 'in progress',
  stopped: 'stopped',
  todo: 'not yet',
};

function paymentPlan(row: QuoteRow): string {
  if (row.paymentMode === 'per_date') return 'One payment per trip date';
  const bps = row.depositBps ?? 1000;
  if (bps >= 10000) return 'Paid in full at checkout';
  return `${bps / 100}% deposit at checkout, the balance later`;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-ink [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function LineItem({ item }: { item: QuoteItem }) {
  const title = item.description?.trim() || item.priceLabel || 'Untitled line';
  // The day only: a tour line's clock is the day-slot's placeholder, not its departure time.
  const when = item.startsAt
    ? item.endsAt && mauDay(item.endsAt) !== mauDay(item.startsAt)
      ? `${dayMonth(mauDay(item.startsAt))} – ${dayMonth(mauDay(item.endsAt))}`
      : dayMonth(mauDay(item.startsAt))
    : null;
  const qty =
    item.quantity > 1
      ? `${item.quantity} × ${eurFromMinor(item.unitAmountMinor)}${item.priceLabel && item.description ? ` · ${item.priceLabel}` : ''}`
      : item.priceLabel && item.description
        ? item.priceLabel
        : null;
  return (
    <li className="py-2.5 first:pt-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold leading-snug text-ink">{title}</p>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {[when, qty, item.guests ? `${item.guests} guests` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="shrink-0 text-[13.5px] font-semibold tabular-nums text-ink">
          {eurFromMinor(item.subtotalMinor)}
        </span>
      </div>
      {item.transportFareMinor !== null && item.transportFareMinor > 0 && (
        <div className="mt-1.5 flex items-start justify-between gap-3 rounded-lg bg-ground px-2.5 py-1.5 text-[12px] text-ink-muted">
          <span className="min-w-0">
            Transfer
            {item.transportPickupLabel ? `: ${item.transportPickupLabel}` : ''}
            {item.transportDropoffLabel ? ` → ${item.transportDropoffLabel}` : ''}
          </span>
          <span className="shrink-0 tabular-nums">{eurFromMinor(item.transportFareMinor)}</span>
        </div>
      )}
    </li>
  );
}

function LinesSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <div className="h-3.5 w-3/5 rounded bg-line-soft motion-safe:animate-pulse" />
            <div className="mt-1.5 h-3 w-2/5 rounded bg-line-soft motion-safe:animate-pulse" />
          </div>
          <div className="h-3.5 w-14 rounded bg-line-soft motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
