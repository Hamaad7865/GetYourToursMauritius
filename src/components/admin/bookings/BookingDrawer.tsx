'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import {
  bookingExtraCharges,
  downloadBookingPdf,
  eraseCustomerData,
  loadBookingDetail,
  markBookingRefunded,
  paymentView,
  resetGuestBookingLink,
  saveBookingNotes,
  sendInstallmentReminder,
  setBookingStatus,
  type BookingDetail,
  type BookingStatus,
  type PaymentState,
} from '@/lib/admin/bookings';
import { mailtoHref, telHref, whatsappChatHref } from '@/lib/admin/contact-links';
import { balanceIsOutstanding } from '@/lib/quotes/deposit';
import { childSeatsCost } from '@/lib/services/pricing';
import { eur, fmtDate, fmtDateTime, titleCase } from '@/lib/admin/format';
import { BookingChangePanel } from '@/components/admin/BookingChangePanel';
import {
  BookingStatusChip,
  PaymentChip,
  PickupFacts,
  TransferFacts,
} from '@/components/admin/BookingFacts';
import { PaymentSchedule } from '@/components/booking/PaymentSchedule';
import { GuestAvatar } from '@/components/admin/GuestAvatar';
import {
  CopyIcon,
  MoreMenu,
  PANEL_FOCUS_RING as FOCUS_RING,
  PanelCard as Card,
  SidePanel,
  type MenuAction,
} from '@/components/admin/SidePanel';
import {
  AdminError,
  StatusChip,
  TEXTAREA_CLS,
  Tabs,
  buttonClass,
  type StatusTone,
} from '@/components/admin/ui';
import {
  IconCalendar,
  IconChat,
  IconCheck,
  IconMail,
  IconPin,
  IconWallet,
} from '@/components/ui/icons';
import {
  DRAWER_TABS,
  drawerAttention,
  drawerMoney,
  drawerPrimary,
  itemWhens,
  parseDrawerTab,
  paymentEventTone,
  type AttentionItem,
  type DrawerTab,
} from './rules';

/* THE BOOKING PANEL: what opens when a booking is chosen on the Bookings screen.
 *
 * A panel over the list (the owner's mock-up, 15 Nov 2026, in the back office's own colours and type):
 * the guest and the booking's two chips on top, then three tabs (Overview, Payment, Notes), and a footer
 * with the ways to reach the guest, every other action under "More", and the one main action the booking
 * needs next. Previous / Next step through the list as it is filtered and sorted, without closing.
 *
 * Everything the old single-column drawer showed or did is here, with its confirmation wordings
 * unchanged; the rules for the tiles, the money band and the main action are in `./rules` (pure,
 * unit-tested). Nothing here writes anything the old drawer did not: the invoice and voucher downloads
 * use the guest's own PDF routes, which let staff read any booking. */

/** Every booking that can still be cancelled from here. */
const CANCELLABLE: BookingStatus[] = ['draft', 'held', 'payment_pending', 'confirmed'];

/** Money was taken and has not all gone back: a refund is outstanding or can be recorded. */
function isRefundable(b: Pick<BookingDetail, 'status' | 'paymentState'>): boolean {
  return (
    b.status === 'refund_pending' ||
    ((b.status === 'confirmed' || b.status === 'completed') &&
      (b.paymentState === 'paid' || b.paymentState === 'partially_refunded'))
  );
}

/** A payments row's own state, as a chip (the provider's word, title-cased, as before). */
const PAYMENT_ROW_TONE: Record<PaymentState, StatusTone> = {
  paid: 'ok',
  pending: 'neutral',
  failed: 'bad',
  refunded: 'info',
  partially_refunded: 'info',
};

/** The colour of a payment event's bar on the timeline (the words carry the meaning). */
const EVENT_BAR: Record<ReturnType<typeof paymentEventTone>, string> = {
  ok: 'bg-teal',
  bad: 'bg-coral',
  info: 'bg-blue-dark',
  neutral: 'bg-[#C2CED1]',
};

/** What the "More" button says while one of its actions runs. */
const BUSY_WORDS: Record<string, string> = {
  complete: 'Saving…',
  cancel: 'Cancelling…',
  refund: 'Recording…',
  'guest-link': 'Resetting…',
  erase: 'Erasing…',
  invoice: 'Downloading…',
  voucher: 'Downloading…',
};

const TITLE_ID = 'booking-panel-title';
const PICKUP_ID = 'booking-panel-pickup';

export interface BookingDrawerProps {
  id: string;
  tab: DrawerTab;
  onTab: (tab: DrawerTab) => void;
  /** The bookings either side in the list as it is filtered and sorted; null at either end. */
  prevId: string | null;
  nextId: string | null;
  /** Where the open booking sits in that list, or null when the filters hide it. */
  position: { index: number; count: number } | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
  /** Something on the booking changed: the list reloads. */
  onChanged: () => void;
  /** The Mauritius day, YYYY-MM-DD. */
  today: string;
  /** How many other bookings in the list share this guest's email (0 hides the button). */
  otherBookings: number;
  onShowOtherBookings: (email: string) => void;
}

/**
 * The booking in the shared side panel (`SidePanel`: the backdrop, Previous / Next / Close, the
 * keyboard). The booking itself is {@link BookingBody}, keyed by id, so stepping to another booking
 * starts it fresh while the frame, and the button just pressed, stay put.
 */
export function BookingDrawer(props: BookingDrawerProps) {
  const { id, onClose, prevId, nextId, onNavigate, position } = props;
  // An action in flight holds the panel open; an unsaved note asks first.
  const busyRef = useRef(false);
  const dirtyRef = useRef(false);
  const onBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
  }, []);
  const onDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);
  const mayLeave = useCallback(
    () =>
      !busyRef.current &&
      (!dirtyRef.current || window.confirm('You have an unsaved note. Leave without saving it?')),
    [],
  );

  return (
    <SidePanel
      itemKey={id}
      titleId={TITLE_ID}
      noun="booking"
      prevId={prevId}
      nextId={nextId}
      position={position}
      onNavigate={onNavigate}
      onClose={onClose}
      mayLeave={mayLeave}
    >
      <BookingBody
        key={id}
        {...props}
        // Showing the guest's other bookings closes the panel, so it asks first like Close does.
        onShowOtherBookings={(email) => {
          if (mayLeave()) props.onShowOtherBookings(email);
        }}
        onBusy={onBusy}
        onDirty={onDirty}
      />
    </SidePanel>
  );
}

/** One small fact in a grey tile (Date, Time, Guests). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-ground px-3 py-2">
      <dt className="text-[11.5px] text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-semibold text-ink [overflow-wrap:anywhere]">
        {value}
      </dd>
    </div>
  );
}

function BookingBody({
  id,
  tab,
  onTab,
  onChanged,
  today,
  otherBookings,
  onShowOtherBookings,
  onBusy,
  onDirty,
}: BookingDrawerProps & { onBusy: (busy: boolean) => void; onDirty: (dirty: boolean) => void }) {
  const canRefund = can(useAdminAccess(), 'money.refunds');
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `booking === null`: a well-formed id that has no row (deleted / erased / stale
  // deep-link) resolves to null WITHOUT throwing, so without this flag the panel can't tell
  // "loaded, not found" from "still loading" and would hang on the spinner forever.
  const [notFound, setNotFound] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const notesDirty = booking !== null && notes !== (booking.notes ?? '');
  useEffect(() => onBusy(busy !== null), [busy, onBusy]);
  useEffect(() => onDirty(notesDirty), [notesDirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);

  // Priced components that carry no booking_items row of their own — see bookingExtraCharges.
  const extraCharges = useMemo(() => (booking ? bookingExtraCharges(booking) : []), [booking]);

  const reload = useCallback(async () => {
    try {
      const detail = await loadBookingDetail(id);
      setBooking(detail);
      setNotFound(detail === null); // resolved, but no such booking → a not-found state, not a spinner
      setNotes(detail?.notes ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this booking.');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      await fn();
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(null);
    }
  }

  if (!booking) {
    return (
      <>
        <header className="shrink-0 px-4 pb-3 pt-4 sm:px-6">
          <h2 id={TITLE_ID} className="pr-[132px] text-[18px] font-bold text-ink sm:pr-[200px]">
            Booking details
          </h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line bg-ground px-4 py-4 sm:px-6">
          {notFound ? (
            <p className="text-ink-muted">
              This booking couldn’t be found — it may have been cancelled or deleted.
            </p>
          ) : error ? (
            <p role="alert" className="text-coral-dark">
              {error}
            </p>
          ) : (
            <p className="text-ink-soft">Loading…</p>
          )}
        </div>
      </>
    );
  }

  const b = booking;
  const email = mailtoHref(b.customerEmail);
  const phone = telHref(b.customerPhone);
  const whatsapp = whatsappChatHref(b.customerPhone);
  const attention = drawerAttention(b, { canRefund, today });
  const primary = drawerPrimary(b, { canRefund, today, tab });
  const whens = itemWhens(b);
  const firstDay = whens.find((w) => w !== null)?.day ?? null;

  const copyRef = () => {
    void navigator.clipboard
      ?.writeText(b.ref)
      .then(() => setCopied(true))
      .catch(() => setError('Could not copy the reference.'));
  };

  const complete = () => void act('complete', () => setBookingStatus(b.id, 'completed'));
  const cancel = () => {
    const paid = b.paymentState === 'paid' || b.paymentState === 'partially_refunded';
    const msg = paid
      ? `Cancel booking ${b.ref}? It's PAID — this frees the seats and marks it refund-pending. Remember to refund the customer in your payment provider.`
      : b.status === 'confirmed'
        ? `Cancel booking ${b.ref}? This frees the seats.`
        : `Cancel booking ${b.ref}? Any held seats free up when the hold expires.`;
    if (window.confirm(msg)) void act('cancel', () => setBookingStatus(b.id, 'cancelled'));
  };
  const refund = () => {
    const msg = `Confirm you've refunded ${eur(b.netPaidEur)} to ${b.customerName} in Peach. This records the refund in the ledger and emails the customer their refund confirmation.`;
    if (window.confirm(msg)) void act('refund', () => markBookingRefunded(b.id));
  };
  // For a leaked manage link. Harmless on an account's booking, which has no link.
  const resetLink = () => {
    const msg =
      'Reset the guest link? Every link already emailed for this booking stops working. The guest can get a new one at /bookings/find.';
    if (!window.confirm(msg)) return;
    setBusy('guest-link');
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        await resetGuestBookingLink(b.ref);
        setMessage('Guest link reset. Links already emailed no longer work.');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setBusy(null);
      }
    })();
  };
  const erase = () => {
    const msg = `Permanently anonymise ${b.customerEmail}'s personal data across ALL their bookings + delete their account data. Use ONLY for a verified erasure request. This cannot be undone.`;
    if (!window.confirm(msg)) return;
    const customerEmail = b.customerEmail;
    setBusy('erase');
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const r = await eraseCustomerData(customerEmail);
        setMessage(
          `Erased — anonymised ${r.anonymizedBookings} retained booking(s), deleted ${r.deletedBookings} booking(s) and ${r.deletedLeads} lead(s).`,
        );
        await reload();
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed.');
      } finally {
        setBusy(null);
      }
    })();
  };
  const download = (kind: 'invoice' | 'voucher') => {
    setBusy(kind);
    setError(null);
    setMessage(null);
    void downloadBookingPdf(b.ref, kind)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Download failed.'))
      .finally(() => setBusy(null));
  };
  const saveNote = () => void act('note', () => saveBookingNotes(b.id, notes));

  const openPickup = () => {
    const el = document.getElementById(PICKUP_ID);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  };
  const choose = (a: AttentionItem) => (a.target === 'payment' ? onTab('payment') : openPickup());

  // The invoice exists once the booking is paid; the e-voucher only for an airport transfer that is
  // confirmed or paid (the routes refuse anything else, so the menu doesn't offer it).
  const confirmedish = b.status === 'confirmed' || b.status === 'completed';
  const menu: MenuAction[][] = [
    [
      ...(b.paymentState === 'paid'
        ? [{ id: 'invoice', label: 'Download invoice', onSelect: () => download('invoice') }]
        : []),
      ...(b.transfer && (confirmedish || b.paymentState === 'paid')
        ? [{ id: 'voucher', label: 'Download e-voucher', onSelect: () => download('voucher') }]
        : []),
    ],
    [
      ...(b.status === 'confirmed' && primary?.kind !== 'complete'
        ? [{ id: 'complete', label: 'Mark as completed', onSelect: complete }]
        : []),
      ...(canRefund && isRefundable(b)
        ? [{ id: 'refund', label: 'Mark refunded', onSelect: refund }]
        : []),
      { id: 'guest-link', label: 'Reset guest link', onSelect: resetLink },
    ],
    [
      ...(CANCELLABLE.includes(b.status)
        ? [{ id: 'cancel', label: 'Cancel booking', onSelect: cancel, danger: true }]
        : []),
      { id: 'erase', label: 'Erase customer data', onSelect: erase, danger: true },
    ],
  ];

  return (
    <>
      <header className="shrink-0 px-4 pt-3.5 sm:px-6 sm:pt-4">
        <div className="flex min-h-9 items-center gap-1 pr-[132px] sm:pr-[200px]">
          <span className="truncate rounded-md bg-ground px-2 py-1 font-mono text-[12px] font-semibold text-ink-muted">
            {b.ref}
          </span>
          <button
            type="button"
            onClick={copyRef}
            aria-label={`Copy reference ${b.ref}`}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-line-soft hover:text-ink motion-reduce:transition-none ${FOCUS_RING}`}
          >
            {copied ? (
              <IconCheck width={14} height={14} className="text-teal-dark" aria-hidden="true" />
            ) : (
              <CopyIcon />
            )}
          </button>
          <span role="status" className="sr-only">
            {copied ? 'Reference copied' : ''}
          </span>
        </div>
        <div className="mt-2.5 flex items-center gap-3.5">
          <GuestAvatar name={b.customerName} size="lg" />
          <div className="min-w-0 flex-1">
            <h2
              id={TITLE_ID}
              className="truncate text-[21px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[24px]"
            >
              {b.customerName}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              Booked {fmtDateTime(b.createdAt)} · via {titleCase(b.source)}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <PaymentChip view={paymentView(b)} status={b.status} />
            <BookingStatusChip status={b.status} />
          </div>
        </div>
        <Tabs
          label="Booking sections"
          items={DRAWER_TABS.map((t) => ({ id: t.id, label: t.label }))}
          active={tab}
          onSelect={(t) => onTab(parseDrawerTab(t))}
          className="mt-3"
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-ground px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3">
          {error && <AdminError>{error}</AdminError>}
          {message && (
            <p
              role="status"
              className="rounded-lg bg-teal-tint px-3 py-2 text-[13px] font-medium text-teal-dark"
            >
              {message}
            </p>
          )}

          {tab === 'overview' && (
            <>
              {attention.length > 0 && (
                <ul aria-label="Needs attention" className="grid gap-2.5 sm:grid-cols-2">
                  {attention.map((a) => (
                    <li key={a.id} className="sm:only:col-span-2">
                      <button
                        type="button"
                        onClick={() => choose(a)}
                        className={`flex h-full w-full items-center gap-3 rounded-xl border border-gold-light/50 bg-gold-tint px-3.5 py-3 text-left transition-colors hover:border-gold-light motion-reduce:transition-none ${FOCUS_RING}`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/70 text-gold-dark">
                          {a.id === 'pickup' ? (
                            <IconPin width={16} height={16} aria-hidden="true" />
                          ) : (
                            <IconWallet width={16} height={16} aria-hidden="true" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13.5px] font-semibold text-ink">
                            {a.title}
                          </span>
                          <span className="block text-[12.5px] text-gold-dark">
                            {a.detail}
                            <span aria-hidden="true"> →</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Card
                title="Trip"
                aside={
                  firstDay ? (
                    <Link
                      href={`/admin/calendar?day=${firstDay}`}
                      className={`inline-flex items-center gap-1 rounded text-[12.5px] font-semibold text-teal-dark hover:underline ${FOCUS_RING}`}
                    >
                      <IconCalendar width={13} height={13} aria-hidden="true" />
                      See the day in Calendar
                    </Link>
                  ) : undefined
                }
              >
                <ul className="flex flex-col gap-3">
                  {b.items.map((it, i) => {
                    const when = whens[i] ?? null;
                    return (
                      <li
                        key={i}
                        className="border-t border-line-soft pt-3 first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-bold leading-snug text-ink">
                              {it.activityTitle}
                            </p>
                            <p className="mt-0.5 text-[12.5px] text-ink-soft">
                              {/* On a single-option activity the option name IS the price label;
                                  printing both gives "X · 1 × X". */}
                              {it.optionName && it.optionName !== it.priceLabel
                                ? `${it.optionName} · `
                                : ''}
                              {it.quantity} × {it.priceLabel}
                              {/* Unit price only when it differs from the line total. */}
                              {it.quantity > 1 ? ` · ${eur(it.unitAmountEur)} each` : ''}
                            </p>
                          </div>
                          <span className="shrink-0 text-[15px] font-bold text-ink">
                            {eur(it.subtotalEur)}
                          </span>
                        </div>
                        <dl className="mt-2.5 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
                          <Fact label="Date" value={when ? fmtDate(when.at) : '—'} />
                          <Fact label="Time" value={when?.time ?? '—'} />
                          <Fact label="Guests" value={String(it.pax ?? it.quantity)} />
                        </dl>
                        {/* The line's OWN round-trip transfer, nested under it like the invoice, so
                            a multi-tour booking shows each activity's pickup. */}
                        {it.transportFareEur > 0 && (
                          <div className="ml-3 mt-2 flex items-baseline justify-between gap-3 border-l-2 border-line pl-2.5 text-[12.5px]">
                            <span className="text-ink-muted">
                              Round-trip transfer
                              {it.transportPickupLabel ? ` · from ${it.transportPickupLabel}` : ''}
                            </span>
                            <span className="shrink-0 font-semibold text-ink">
                              {eur(it.transportFareEur)}
                            </span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {/* Charges with no booking_items row (quote lines + their transfers, region
                    transport, child seats, supplements). Without these the Total silently exceeds
                    the lines above and staff cannot explain the amount charged. An add-on transfer
                    is indented under its line, like the invoice; keyed by index because two lines
                    can share a transfer label. */}
                {extraCharges.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-1.5 border-t border-line-soft pt-3">
                    {extraCharges.map((charge, i) => (
                      <li
                        key={i}
                        className={`flex items-baseline justify-between gap-3 text-[13px] ${
                          charge.isAddon ? 'ml-3 border-l-2 border-line pl-2.5' : ''
                        }`}
                      >
                        <span className="text-ink-muted">{charge.label}</span>
                        <span className="shrink-0 font-semibold text-ink">
                          {eur(charge.amountEur)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3">
                  <span className="font-bold text-ink">Total</span>
                  <span className="text-[17px] font-bold text-ink">{eur(b.totalEur)}</span>
                </div>
                {/* A DEPOSIT-CONFIRMED QUOTE BOOKING IS NOT SETTLED. `payment_state` flips to 'paid'
                    the moment the deposit clears, so without this a €1.00 booking with €0.10 taken
                    reads "Paid" beside its €1.00 total and nothing says the rest is still to collect.
                    Gated on balanceIsOutstanding, NOT on `balanceDueEur > 0`: that column is
                    recomputed after a FAILED payment too. */}
                {balanceIsOutstanding({
                  deposit: b.depositEur,
                  balanceDue: b.balanceDueEur,
                  total: b.totalEur,
                }) && (
                  <div className="mt-2 flex items-center justify-between rounded-lg bg-gold-tint px-3 py-2 text-gold-dark">
                    <span className="text-[13px] font-semibold">Balance still to collect</span>
                    <span className="text-[15px] font-bold">{eur(b.balanceDueEur)}</span>
                  </div>
                )}
              </Card>

              {b.notes && (
                <Card
                  title="Private note"
                  aside={
                    <button
                      type="button"
                      onClick={() => onTab('notes')}
                      className={`rounded text-[12.5px] font-semibold text-teal-dark hover:underline ${FOCUS_RING}`}
                    >
                      Edit note
                    </button>
                  }
                >
                  <p className="line-clamp-4 whitespace-pre-wrap text-[13px] text-ink">{b.notes}</p>
                </Card>
              )}

              {/* Change of tour. Only a confirmed + paid booking can be moved — the RPC enforces
                  this too, but offering the panel on an unpayable booking would be a dead end. */}
              {b.status === 'confirmed' && b.paymentState === 'paid' && (
                <div className="overflow-hidden rounded-xl border border-line bg-white [&>section]:border-t-0 [&>section]:px-4 sm:[&>section]:px-5">
                  <BookingChangePanel
                    bookingId={b.id}
                    bookingRef={b.ref}
                    currentStartsAt={b.items.map((i) => i.startsAt).filter(Boolean)[0] ?? null}
                    currentDepartureTime={b.items.find((i) => i.startsAt)?.departureTime ?? null}
                    onChanged={() => {
                      void reload();
                      onChanged();
                    }}
                  />
                </div>
              )}

              <Card id={PICKUP_ID} title="Pickup & drop-off">
                <PickupFacts
                  pickupLocation={b.pickupLocation}
                  dropoffLocation={b.dropoffLocation}
                  pickupPending={b.pickupPending}
                  transportPickup={b.transportPickup}
                  transportDropoff={b.transportDropoff}
                  transferDirection={b.transfer?.direction ?? null}
                />
              </Card>

              {b.transfer && (
                <Card title="Transfer details">
                  <TransferFacts transfer={b.transfer} />
                </Card>
              )}

              {b.childSeats > 0 && (
                <Card title="Baby & child seats">
                  <p className="text-[13px] text-ink-muted">
                    {b.childSeats} {b.childSeats === 1 ? 'seat' : 'seats'}
                    {childSeatsCost(b.childSeats) > 0
                      ? ` — first free, €${childSeatsCost(b.childSeats)} extra`
                      : ' — free'}
                  </p>
                </Card>
              )}

              {b.customItinerary && b.customItinerary.length > 0 && (
                <Card title="Customer route">
                  <ol className="list-decimal pl-5 text-[13px] text-ink-muted">
                    {b.customItinerary.map((s, i) => (
                      <li key={i}>{s.area ? `${s.title} — ${s.area}` : s.title}</li>
                    ))}
                  </ol>
                </Card>
              )}

              <Card title="Guest">
                <p className="font-semibold text-ink">{b.customerName}</p>
                <div className="mt-1 flex flex-col text-[13px]">
                  {email ? (
                    <a href={email} className="w-fit break-all text-teal-dark hover:underline">
                      {b.customerEmail}
                    </a>
                  ) : (
                    <span className="break-all text-ink-muted">{b.customerEmail}</span>
                  )}
                  {b.customerPhone &&
                    (phone ? (
                      <a href={phone} className="w-fit text-ink-muted hover:underline">
                        {b.customerPhone}
                      </a>
                    ) : (
                      <span className="text-ink-muted">{b.customerPhone}</span>
                    ))}
                </div>
                {(phone || otherBookings > 0) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {phone && (
                      <a href={phone} className={buttonClass('ghost', 'sm')}>
                        Call
                        <span className="sr-only"> {b.customerName}</span>
                      </a>
                    )}
                    {otherBookings > 0 && (
                      <button
                        type="button"
                        onClick={() => onShowOtherBookings(b.customerEmail)}
                        className={buttonClass('ghost', 'sm')}
                      >
                        {otherBookings === 1
                          ? 'Their other booking'
                          : `Their ${otherBookings} other bookings`}
                      </button>
                    )}
                  </div>
                )}
              </Card>
            </>
          )}

          {tab === 'payment' && (
            <>
              <MoneyBand booking={b} />

              {b.status === 'refund_pending' &&
                (canRefund ? (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold-light/50 bg-gold-tint px-4 py-3.5">
                    <div className="min-w-0 flex-[1_1_260px]">
                      <p className="text-[14px] font-semibold text-ink">
                        Refund waiting to be recorded
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-gold-dark">
                        Send {eur(b.netPaidEur)} back to {b.customerName} in Peach, then record it
                        here. Recording it emails the guest their refund confirmation.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={busy === 'refund'}
                      onClick={refund}
                      className={buttonClass('primary')}
                    >
                      {busy === 'refund' ? 'Recording…' : 'Mark refunded'}
                    </button>
                  </div>
                ) : (
                  <p className="rounded-xl border border-line bg-white px-4 py-3 text-[12.5px] text-ink-soft">
                    The owner records refunds — tell them once it’s been sent in Peach.
                  </p>
                ))}

              {b.installments.length > 0 && (
                <Card>
                  <PaymentSchedule
                    installments={b.installments}
                    onSendReminder={(seq) => sendInstallmentReminder(b.ref, seq)}
                  />
                </Card>
              )}

              <Card
                title="Payments"
                aside={
                  // The master reference every provider id below hangs off. A generated id is
                  // opaque, so this is the only place the two are shown together.
                  <span className="text-[11.5px] text-ink-soft">
                    master ref · <span className="font-mono text-ink-muted">{b.ref}</span>
                  </span>
                }
              >
                {b.payments.length === 0 ? (
                  <p className="text-[13px] text-ink-soft">No payment started yet.</p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {b.payments.map((p) => (
                      <li
                        key={p.id}
                        className="border-t border-line-soft pt-4 first:border-t-0 first:pt-0"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13.5px] font-semibold text-ink">
                            {titleCase(p.provider)} · {eur(p.amountEur)}
                          </span>
                          <StatusChip tone={PAYMENT_ROW_TONE[p.status] ?? 'neutral'}>
                            {titleCase(p.status)}
                          </StatusChip>
                        </div>
                        {p.events.length > 0 && (
                          <ol
                            aria-label="Payment history"
                            className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-x-2 gap-y-3"
                          >
                            {p.events.map((e, i) => (
                              <li key={i} className="flex min-w-0 flex-col gap-1">
                                <span
                                  aria-hidden="true"
                                  className={`h-1.5 rounded-full ${EVENT_BAR[paymentEventTone(e.type)]}`}
                                />
                                <span className="text-[12.5px] font-semibold text-ink">
                                  {titleCase(e.type)}
                                  {e.amountEur ? ` · ${eur(e.amountEur)}` : ''}
                                </span>
                                <span className="text-[11.5px] text-ink-soft">
                                  {fmtDateTime(e.occurredAt)}
                                </span>
                              </li>
                            ))}
                          </ol>
                        )}
                        {/* Provider references, oldest first. Each is a merchantTransactionId this
                            payment issued; a second one means the session was reissued after the
                            first was refused. Searching any of them on the Bookings list lands back
                            on this booking. */}
                        {p.merchantRefs.length > 0 ? (
                          <ul className="mt-3 flex flex-col gap-0.5">
                            {p.merchantRefs.map((r, i) => (
                              <li
                                key={r.id}
                                className="flex flex-wrap items-baseline gap-x-2 text-[12px]"
                              >
                                <span className="font-mono text-ink-muted">{r.id}</span>
                                <span className="text-ink-soft">
                                  {i === 0 ? 'issued' : 'reissued'} {fmtDateTime(r.issuedAt)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-3 text-[12px] text-ink-soft">
                            No provider reference recorded — this payment pre-dates the history, so
                            its id was derived from the booking ref.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <p className="px-1 text-[11.5px] leading-relaxed text-ink-soft">
                Payment confirmation is handled automatically by the payment provider — staff can
                mark a booking completed or cancel it, but cannot mark it paid here.
              </p>
            </>
          )}

          {tab === 'notes' && (
            <Card>
              <label
                htmlFor={`booking-note-${b.id}`}
                className="block text-[13px] font-semibold text-ink"
              >
                Private note{' '}
                <span className="font-normal text-ink-soft">
                  · for the team, never shown to the guest
                </span>
              </label>
              <textarea
                id={`booking-note-${b.id}`}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={8}
                placeholder="Add a private note (not shown to the customer)…"
                className={`${TEXTAREA_CLS} mt-2`}
              />
              <div className="mt-2.5 flex items-center justify-end gap-3">
                {notesDirty && <span className="text-[12px] text-ink-soft">Not saved yet</span>}
                <button
                  type="button"
                  disabled={busy === 'note' || !notesDirty}
                  onClick={saveNote}
                  className={buttonClass('primary', 'sm')}
                >
                  {busy === 'note' ? 'Saving…' : 'Save note'}
                </button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-white px-4 py-3 sm:px-6">
        {whatsapp && (
          <a
            href={whatsapp}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('ghost')}
          >
            <IconChat width={15} height={15} aria-hidden="true" />
            WhatsApp
            <span className="sr-only"> {b.customerName} (opens WhatsApp)</span>
          </a>
        )}
        {email && (
          <a href={email} className={buttonClass('ghost')}>
            <IconMail width={15} height={15} aria-hidden="true" />
            Email
            <span className="sr-only"> {b.customerName}</span>
          </a>
        )}
        <div className="ml-auto flex items-center gap-2">
          <MoreMenu
            groups={menu}
            busyLabel={
              busy && busy !== 'note' && busy !== primary?.kind ? (BUSY_WORDS[busy] ?? null) : null
            }
            disabled={busy !== null}
          />
          {primary && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={primary.kind === 'review-refund' ? () => onTab('payment') : complete}
              className={buttonClass('primary')}
            >
              {busy === 'complete' && primary.kind === 'complete' ? 'Saving…' : primary.label}
            </button>
          )}
        </div>
      </footer>
    </>
  );
}

/** The Payment tab's dark band: the total, what was paid, and where the money stands. */
function MoneyBand({ booking }: { booking: BookingDetail }) {
  const figures = drawerMoney(booking);
  return (
    <div className="rounded-xl bg-ink px-4 py-4 text-white sm:px-5">
      <dl
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${figures.length}, minmax(0, 1fr))` }}
      >
        {figures.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[12px] font-medium text-white/75">
              {f.tone !== 'plain' && (
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.tone === 'warn' ? 'bg-gold-light' : 'bg-[#8EC5F2]'}`}
                />
              )}
              {f.label}
            </dt>
            <dd className="mt-0.5 break-words text-[18px] font-bold tabular-nums tracking-[-0.02em] sm:text-[22px]">
              {eur(f.amountEur)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
