'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadBookings,
  loadBookingDetail,
  setBookingStatus,
  saveBookingNotes,
  type BookingRow,
  type BookingDetail,
  type BookingStatus,
  type PaymentState,
} from '@/lib/admin/bookings';
import { IconCalendar, IconUsers, IconX } from '@/components/ui/icons';
import { childSeatsCost } from '@/lib/services/pricing';

// Departures + timestamps are shown in Mauritius local time, so the calendar day is
// deterministic regardless of the staff member's own browser timezone.
const TZ = 'Indian/Mauritius';
const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TZ,
});

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateFmt.format(d);
}
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}
function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}
function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusClass(status: BookingStatus): string {
  switch (status) {
    case 'confirmed':
      return 'bg-teal/10 text-teal-dark';
    case 'completed':
      return 'bg-ink/10 text-ink';
    case 'cancelled':
    case 'expired':
    case 'failed':
      return 'bg-coral/10 text-coral';
    case 'refunded':
    case 'refund_pending':
      return 'bg-coral/10 text-coral';
    default:
      return 'bg-gold-light/20 text-ink';
  }
}
function paymentClass(state: PaymentState): string {
  switch (state) {
    case 'paid':
      return 'bg-teal/10 text-teal-dark';
    case 'partially_refunded':
    case 'refunded':
    case 'failed':
      return 'bg-coral/10 text-coral';
    default:
      return 'bg-gold-light/20 text-ink';
  }
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>{children}</span>
  );
}

const STATUS_FILTERS: Array<{ value: 'all' | BookingStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'payment_pending', label: 'Awaiting payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'refunded', label: 'Refunded' },
];

export function AdminBookings() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';

  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | BookingStatus>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await loadBookings());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings.');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    // Net cash actually retained: Σ(paid − refunded) per booking. Pending bookings add 0,
    // and a refund nets itself out — so this never overstates revenue.
    const revenue = all.reduce((sum, b) => sum + b.netPaidEur, 0);
    return {
      total: all.length,
      confirmed: all.filter((b) => b.status === 'confirmed' || b.status === 'completed').length,
      pending: all.filter((b) => b.status === 'payment_pending').length,
      revenue,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? []).filter((b) => {
      if (status !== 'all' && b.status !== status) return false;
      if (!q) return true;
      return (
        b.ref.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.customerEmail.toLowerCase().includes(q) ||
        b.activityTitle.toLowerCase().includes(q)
      );
    });
  }, [rows, status, query]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Bookings</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Every booking taken on the site, newest first.</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
        >
          Refresh
        </button>
      </div>

      {/* KPI strip */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total bookings" value={String(stats.total)} />
        <Stat label="Confirmed" value={String(stats.confirmed)} tone="teal" />
        <Stat label="Awaiting payment" value={String(stats.pending)} tone="gold" />
        <Stat label="Net paid" value={eur(stats.revenue)} tone="teal" />
      </div>

      {/* Filters */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-bold ${
                status === f.value ? 'bg-ink text-white' : 'bg-white text-ink-muted hover:text-ink'
              } border border-ink/10`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ref, name, email or activity"
          className="ml-auto w-full max-w-xs rounded-full border border-ink/15 px-4 py-2 text-sm outline-none focus:border-teal sm:w-72"
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-2xl border border-ink/10 bg-white">
        {rows === null ? (
          <p className="p-6 text-sm text-ink-muted">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-ink-muted">
            {rows.length === 0 ? 'No bookings yet.' : 'No bookings match your filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-ink/10">
            {filtered.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(b.id)}
                  className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-cream/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12.5px] font-bold text-teal">{b.ref}</span>
                      <span className="truncate font-bold text-ink">{b.customerName}</span>
                      <Badge className={statusClass(b.status)}>{titleCase(b.status)}</Badge>
                      <Badge className={paymentClass(b.paymentState)}>{titleCase(b.paymentState)}</Badge>
                    </div>
                    <p className="mt-0.5 truncate text-[12.5px] text-ink-muted">
                      {b.activityTitle} · {fmtDate(b.startsAt)} · {b.guests} {b.guests === 1 ? 'guest' : 'guests'}
                    </p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block font-extrabold text-ink">{eur(b.totalEur)}</span>
                    <span className="block text-[11.5px] text-ink-muted">{fmtDate(b.createdAt)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selectedId && (
        <BookingDrawer
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'teal' | 'gold' }) {
  const valueColor = tone === 'teal' ? 'text-teal-dark' : tone === 'gold' ? 'text-ink' : 'text-ink';
  return (
    <div className="rounded-2xl border border-ink/10 bg-white px-4 py-3">
      <p className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`mt-1 text-xl font-extrabold ${valueColor}`}>{value}</p>
    </div>
  );
}

const CANCELLABLE: BookingStatus[] = ['draft', 'held', 'payment_pending', 'confirmed'];

function BookingDrawer({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Read the latest `busy` inside event handlers without re-binding them.
  const busyRef = useRef<string | null>(null);
  busyRef.current = busy;

  // Don't dismiss the drawer while a write is in flight (would drop success/error feedback).
  const requestClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);

  const reload = useCallback(async () => {
    try {
      const detail = await loadBookingDetail(id);
      setBooking(detail);
      setNotes(detail?.notes ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this booking.');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Lock background scroll while the drawer is open (matches AuthDialog / LangCurrencyModal).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Move focus into the dialog on open and restore it to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

  // Escape closes (unless busy); Tab is trapped within the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) onClose();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function act(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError(null);
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close booking details"
        onClick={requestClose}
        className="absolute inset-0 bg-ink/30"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Booking details"
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-2xl outline-none"
      >
        <header className="sticky top-0 flex items-center justify-between border-b border-ink/10 bg-white px-5 py-3.5">
          <span className="font-display text-lg font-semibold text-ink">Booking details</span>
          <button
            type="button"
            onClick={requestClose}
            className="grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
          >
            <IconX width={18} height={18} />
          </button>
        </header>

        {!booking ? (
          <p className="p-6 text-sm text-ink-muted">{error ?? 'Loading…'}</p>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-teal">{booking.ref}</span>
                <Badge className={statusClass(booking.status)}>{titleCase(booking.status)}</Badge>
                <Badge className={paymentClass(booking.paymentState)}>{titleCase(booking.paymentState)}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-muted">Booked {fmtDateTime(booking.createdAt)} · via {booking.source}</p>
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-medium text-coral">
                {error}
              </p>
            )}

            {/* Customer */}
            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Customer</h3>
              <p className="mt-1.5 font-bold text-ink">{booking.customerName}</p>
              <a href={`mailto:${booking.customerEmail}`} className="block text-[13.5px] text-teal hover:underline">
                {booking.customerEmail}
              </a>
              {booking.customerPhone && (
                <a href={`tel:${booking.customerPhone}`} className="block text-[13.5px] text-ink/80">
                  {booking.customerPhone}
                </a>
              )}
            </section>

            {/* Items */}
            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Items</h3>
              <ul className="mt-2 flex flex-col gap-3">
                {booking.items.map((it, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-bold text-ink">{it.activityTitle}</p>
                    <p className="text-[13px] text-ink-muted">
                      {it.optionName ? `${it.optionName} · ` : ''}
                      {it.quantity} × {it.priceLabel} · {eur(it.unitAmountEur)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink/70">
                      <IconCalendar width={13} height={13} className="text-teal" /> {fmtDate(it.startsAt)}
                      <IconUsers width={13} height={13} className="ml-2 text-teal" /> {it.pax ?? it.quantity}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
                <span className="text-sm font-bold text-ink">Total</span>
                <span className="text-lg font-extrabold text-ink">{eur(booking.totalEur)}</span>
              </div>
            </section>

            {/* Customer pickup location (entered at checkout) */}
            {booking.pickupLocation && (
              <section className="rounded-xl border border-ink/10 p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  Pickup location
                </h3>
                <p className="mt-2 text-[13px] text-ink/80">{booking.pickupLocation}</p>
              </section>
            )}

            {/* Baby & child seats (first free, €6 each extra) */}
            {booking.childSeats > 0 && (
              <section className="rounded-xl border border-ink/10 p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  Baby &amp; child seats
                </h3>
                <p className="mt-2 text-[13px] text-ink/80">
                  {booking.childSeats} {booking.childSeats === 1 ? 'seat' : 'seats'}
                  {childSeatsCost(booking.childSeats) > 0
                    ? ` — first free, €${childSeatsCost(booking.childSeats)} extra`
                    : ' — free'}
                </p>
              </section>
            )}

            {/* Customer-customized route (sightseeing tours) */}
            {booking.customItinerary && booking.customItinerary.length > 0 && (
              <section className="rounded-xl border border-ink/10 p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  Customer route
                </h3>
                <ol className="mt-2 list-decimal pl-5 text-[13px] text-ink/80">
                  {booking.customItinerary.map((s, i) => (
                    <li key={i}>{s.area ? `${s.title} — ${s.area}` : s.title}</li>
                  ))}
                </ol>
              </section>
            )}

            {/* Payment ledger */}
            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Payments</h3>
              {booking.payments.length === 0 ? (
                <p className="mt-1.5 text-[13px] text-ink-muted">No payment started yet.</p>
              ) : (
                booking.payments.map((p) => (
                  <div key={p.id} className="mt-2">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-semibold text-ink">
                        {titleCase(p.provider)} · {eur(p.amountEur)}
                      </span>
                      <Badge className={paymentClass(p.status)}>{titleCase(p.status)}</Badge>
                    </div>
                    {p.events.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-1 border-l-2 border-ink/10 pl-3">
                        {p.events.map((e, i) => (
                          <li key={i} className="text-[12px] text-ink-muted">
                            <span className="font-semibold text-ink/80">{titleCase(e.type)}</span>
                            {e.amountEur ? ` · ${eur(e.amountEur)}` : ''} · {fmtDateTime(e.occurredAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </section>

            {/* Internal note */}
            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">Internal note</h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add a private note (not shown to the customer)…"
                className="mt-2 w-full rounded-xl border border-ink/15 px-3 py-2 text-sm outline-none focus:border-teal"
              />
              <button
                type="button"
                disabled={busy === 'note' || notes === (booking.notes ?? '')}
                onClick={() => void act('note', () => saveBookingNotes(booking.id, notes))}
                className="mt-2 rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
              >
                {busy === 'note' ? 'Saving…' : 'Save note'}
              </button>
            </section>

            {/* Actions */}
            <section className="flex flex-wrap gap-2">
              {booking.status === 'confirmed' && (
                <button
                  type="button"
                  disabled={busy === 'complete'}
                  onClick={() => void act('complete', () => setBookingStatus(booking.id, 'completed'))}
                  className="rounded-full bg-teal px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
                >
                  {busy === 'complete' ? 'Saving…' : 'Mark as completed'}
                </button>
              )}
              {CANCELLABLE.includes(booking.status) && (
                <button
                  type="button"
                  disabled={busy === 'cancel'}
                  onClick={() => {
                    // A confirmed booking's seats are freed immediately; an unpaid hold's seats
                    // free themselves when the hold expires. A PAID booking is routed to
                    // refund_pending (the DB does this) so the refund owed is tracked — warn the
                    // operator to actually issue it.
                    const paid =
                      booking.paymentState === 'paid' || booking.paymentState === 'partially_refunded';
                    const msg = paid
                      ? `Cancel booking ${booking.ref}? It's PAID — this frees the seats and marks it refund-pending. Remember to refund the customer in your payment provider.`
                      : booking.status === 'confirmed'
                        ? `Cancel booking ${booking.ref}? This frees the seats.`
                        : `Cancel booking ${booking.ref}? Any held seats free up when the hold expires.`;
                    if (window.confirm(msg))
                      void act('cancel', () => setBookingStatus(booking.id, 'cancelled'));
                  }}
                  className="rounded-full border border-coral/40 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
                >
                  {busy === 'cancel' ? 'Cancelling…' : 'Cancel booking'}
                </button>
              )}
            </section>
            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              Payment confirmation is handled automatically by the payment provider — staff can mark a
              booking completed or cancel it, but cannot mark it paid here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
