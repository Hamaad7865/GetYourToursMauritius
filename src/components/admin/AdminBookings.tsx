'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadBookings,
  loadBookingDetail,
  setBookingStatus,
  markBookingRefunded,
  eraseCustomerData,
  saveBookingNotes,
  type BookingRow,
  type BookingDetail,
  type BookingStatus,
  type PaymentState,
} from '@/lib/admin/bookings';
import { avatar } from '@/lib/admin/dashboard';
import { csvCell } from '@/lib/admin/csv';
import { IconCalendar, IconUsers, IconX, IconSearch } from '@/components/ui/icons';
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
const dateShortFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: TZ,
});
const timeFmt = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit',
  minute: '2-digit',
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
function euroInt(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}
function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
/** YYYY-MM-DD in Mauritius local time. */
function mauDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Pastel pill (matches the back-office mockup): dot + label. */
function statusPill(status: BookingStatus): { label: string; cls: string; dot: string } {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
    case 'completed':
      return { label: 'Completed', cls: 'bg-ink/[0.06] text-ink', dot: 'bg-ink/40' };
    case 'cancelled':
    case 'expired':
    case 'failed':
      return { label: titleCase(status), cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
    case 'refunded':
    case 'refund_pending':
      return { label: titleCase(status), cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
    default:
      return { label: titleCase(status), cls: 'bg-teal/10 text-teal-dark', dot: 'bg-teal' };
  }
}
/** A booking that can no longer be paid. `payment_state` stays 'pending' in the LEDGER sense (no
 *  payment ever happened — it's a cached projection of payment_events), but rendering that as
 *  "Pending" on an expired/cancelled booking reads as money-still-expected. Show "Not paid". */
function paymentClosed(state: PaymentState, status: BookingStatus): boolean {
  return state === 'pending' && (status === 'expired' || status === 'cancelled');
}

function paymentPill(
  state: PaymentState,
  status: BookingStatus,
): { label: string; cls: string; dot: string } {
  if (paymentClosed(state, status)) {
    return { label: 'Not paid', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' };
  }
  switch (state) {
    case 'paid':
      return { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' };
    case 'partially_refunded':
    case 'refunded':
      return { label: titleCase(state), cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
    case 'failed':
      return { label: 'Failed', cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
    default:
      return { label: 'Pending', cls: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' };
  }
}

function Pill({ p }: { p: { label: string; cls: string; dot: string } }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold ${p.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />
      {p.label}
    </span>
  );
}

function Avatar({ name }: { name: string }) {
  const { initials, hue } = avatar(name);
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[12px] font-bold text-white"
      style={{ background: `hsl(${hue} 42% 46%)` }}
    >
      {initials}
    </span>
  );
}

function Badge({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}>
      {children}
    </span>
  );
}
// Kept for the drawer's compact badges.
function statusClass(status: BookingStatus): string {
  switch (status) {
    case 'confirmed':
      return 'bg-teal/10 text-teal-dark';
    case 'completed':
      return 'bg-ink/10 text-ink';
    case 'cancelled':
    case 'expired':
    case 'failed':
    case 'refunded':
    case 'refund_pending':
      return 'bg-coral/10 text-coral';
    default:
      return 'bg-gold-light/20 text-ink';
  }
}
/** Optional bookingStatus: the drawer's booking badge passes it so a closed (expired/cancelled)
 *  never-paid booking greys out instead of glowing "pending"; payment-row badges omit it. */
function paymentClass(state: PaymentState, bookingStatus?: BookingStatus): string {
  if (bookingStatus && paymentClosed(state, bookingStatus)) return 'bg-slate-100 text-slate-500';
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

const STATUS_FILTERS: Array<{ value: 'all' | BookingStatus; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'payment_pending', label: 'Awaiting payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PAY_FILTERS: Array<{ value: 'all' | PaymentState; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'paid', label: 'Paid' },
  { value: 'pending', label: 'Pending' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'failed', label: 'Failed' },
];
const DATE_FILTERS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: 'next7', label: 'Next 7 days' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
] as const;
type DateFilter = (typeof DATE_FILTERS)[number]['value'];
type SortKey = 'ref' | 'customer' | 'date' | 'booked' | 'total';

const SELECT_CLS =
  'rounded-xl border border-[#E2E7EA] bg-white px-3 py-2.5 text-[13.5px] text-ink outline-none focus:border-teal cursor-pointer';

function exportCsv(rows: BookingRow[]): void {
  const head = [
    'Ref',
    'Customer',
    'Email',
    'Tour',
    'Trip date',
    'Booked',
    'Guests',
    'Total EUR',
    'Payment',
    'Status',
    'Source',
  ];
  const lines = rows.map((b) =>
    // Payment exports the DISPLAYED label ("Not paid" for closed never-paid bookings) — exporting the
    // raw ledger state resurfaced exactly the "expired but Pending" misreading the chip fix removed.
    [
      b.ref,
      b.customerName,
      b.customerEmail,
      b.activityTitle,
      fmtDate(b.startsAt),
      b.createdAt,
      b.guests,
      b.totalEur.toFixed(2),
      paymentPill(b.paymentState, b.status).label,
      b.status,
      b.source,
    ]
      .map(csvCell)
      .join(','),
  );
  const csv = [head.join(','), ...lines].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookings-${mauDay(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdminBookings() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';
  // The global top-bar search (AdminShell) routes here as /admin/bookings?q=… — seed the filter from it
  // on arrival, and re-sync if the bar pushes a new query while this screen is already open.
  const searchParams = useSearchParams();

  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'all' | BookingStatus>('all');
  const [pay, setPay] = useState<'all' | PaymentState>('all');
  const [tour, setTour] = useState('all');
  const [dateF, setDateF] = useState<DateFilter>('all');
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [sortKey, setSortKey] = useState<SortKey>('booked');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
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

  // Re-sync the search box when the global bar pushes a new ?q= while we're already on this screen.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q !== null) setQuery(q);
  }, [searchParams]);

  const tourOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of rows ?? []) set.add(b.activityTitle);
    return [...set].sort();
  }, [rows]);

  const filtersActive =
    status !== 'all' || pay !== 'all' || tour !== 'all' || dateF !== 'all' || query.trim() !== '';
  const clearFilters = () => {
    setStatus('all');
    setPay('all');
    setTour('all');
    setDateF('all');
    setQuery('');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const today = mauDay(new Date());
    const list = (rows ?? []).filter((b) => {
      if (status !== 'all' && b.status !== status) return false;
      if (pay !== 'all' && b.paymentState !== pay) return false;
      if (tour !== 'all' && b.activityTitle !== tour) return false;
      if (dateF !== 'all') {
        const d = b.startsAt ? mauDay(b.startsAt) : null;
        if (!d) return false;
        if (dateF === 'today' && d !== today) return false;
        if (dateF === 'next7' && !(d >= today && d <= addDays(today, 6))) return false;
        if (dateF === 'upcoming' && !(d >= today)) return false;
        if (dateF === 'past' && !(d < today)) return false;
      }
      if (!q) return true;
      return (
        b.ref.toLowerCase().includes(q) ||
        b.customerName.toLowerCase().includes(q) ||
        b.customerEmail.toLowerCase().includes(q) ||
        b.activityTitle.toLowerCase().includes(q)
      );
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let av: string | number;
      let bv: string | number;
      if (sortKey === 'customer')
        [av, bv] = [a.customerName.toLowerCase(), b.customerName.toLowerCase()];
      else if (sortKey === 'total') [av, bv] = [a.totalEur, b.totalEur];
      else if (sortKey === 'ref') [av, bv] = [a.ref, b.ref];
      else if (sortKey === 'booked') [av, bv] = [a.createdAt, b.createdAt];
      else [av, bv] = [a.startsAt ?? a.createdAt, b.startsAt ?? b.createdAt];
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, status, pay, tour, dateF, query, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'total' || key === 'date' || key === 'booked' ? 'desc' : 'asc');
    }
  };
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '↑' : '↓') : '');

  const TH = ({ label, sort }: { label: string; sort?: SortKey }) => (
    <th
      onClick={sort ? () => toggleSort(sort) : undefined}
      className={`whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted ${
        sort ? 'cursor-pointer select-none' : ''
      } ${label === 'Total' ? 'text-right' : ''}`}
    >
      <span className={`inline-flex items-center gap-1 ${label === 'Total' ? 'justify-end' : ''}`}>
        {label}
        {sort && <span className="text-teal">{sortArrow(sort)}</span>}
      </span>
    </th>
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">Bookings</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {rows ? `${filtered.length} of ${rows.length} bookings` : 'Loading…'} · tap a row to
            open the details
          </p>
        </div>
        <button
          type="button"
          disabled={!rows || rows.length === 0}
          onClick={() => exportCsv(filtered)}
          className="rounded-xl border border-[#E2E7EA] bg-white px-4 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-50"
        >
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
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
              aria-label="Search bookings"
              placeholder="Search ref, name or email…"
              className="w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 pl-9 pr-3 text-[13.5px] text-ink outline-none focus:border-teal focus:bg-white"
            />
          </div>
          <select
            value={tour}
            onChange={(e) => setTour(e.target.value)}
            aria-label="Filter by tour"
            className={`${SELECT_CLS} max-w-[190px]`}
          >
            <option value="all">All tours</option>
            {tourOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={pay}
            onChange={(e) => setPay(e.target.value as 'all' | PaymentState)}
            aria-label="Filter by payment"
            className={SELECT_CLS}
          >
            {PAY_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={dateF}
            onChange={(e) => setDateF(e.target.value as DateFilter)}
            aria-label="Filter by date"
            className={SELECT_CLS}
          >
            {DATE_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-2 py-2 text-[13px] font-bold text-coral"
            >
              <IconX width={14} height={14} /> Clear
            </button>
          )}
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-coral/10 px-4 py-3 text-sm font-medium text-coral"
        >
          {error}
        </p>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#EAEEF0] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse">
            <thead>
              <tr className="bg-[#FAFBFC]">
                <TH label="Ref" sort="ref" />
                <TH label="Customer" sort="customer" />
                <TH label="Tour" />
                <TH label="Date" sort="date" />
                <TH label="Booked" sort="booked" />
                <TH label="Guests" />
                <TH label="Total" sort="total" />
                <TH label="Payment" />
                <TH label="Status" />
                <TH label="Source" />
              </tr>
            </thead>
            <tbody>
              {(rows ?? []).length > 0 &&
                filtered.map((b) => (
                  <tr
                    key={b.id}
                    onClick={() => setSelectedId(b.id)}
                    className={`cursor-pointer border-t border-[#F2F4F6] hover:bg-[#FAFBFC] ${
                      b.id === selectedId ? 'bg-teal/5' : ''
                    }`}
                  >
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] font-bold text-teal">
                      {b.ref}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={b.customerName} />
                        <span className="whitespace-nowrap text-[13.5px] font-bold text-ink">
                          {b.customerName}
                        </span>
                      </div>
                    </td>
                    <td className="max-w-[200px] px-3 py-3 text-[13px] text-ink/70">
                      <span className="block truncate">{b.activityTitle}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                      {b.startsAt
                        ? `${dateShortFmt.format(new Date(b.startsAt))} · ${timeFmt.format(new Date(b.startsAt))}`
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                      {`${dateShortFmt.format(new Date(b.createdAt))} · ${timeFmt.format(new Date(b.createdAt))}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[13px] text-ink/70">
                      {b.guests}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right text-[13.5px] font-extrabold text-ink">
                      {euroInt(b.totalEur)}
                    </td>
                    <td className="px-3 py-3">
                      <Pill p={paymentPill(b.paymentState, b.status)} />
                    </td>
                    <td className="px-3 py-3">
                      <Pill p={statusPill(b.status)} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[12.5px] font-semibold capitalize text-ink/70">
                      {b.source.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {rows !== null && filtered.length === 0 && (
          <div className="px-6 py-14 text-center">
            <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-[#F4F6F7] text-ink-muted">
              <IconSearch width={20} height={20} />
            </div>
            <div className="text-[15px] font-bold text-ink">
              {rows.length === 0 ? 'No bookings yet' : 'No bookings match these filters'}
            </div>
            <div className="mt-1 text-[13.5px] text-ink-muted">
              {rows.length === 0
                ? 'They’ll appear here as customers book.'
                : 'Try widening the date range or clearing filters.'}
            </div>
          </div>
        )}
        {rows === null && <p className="p-6 text-sm text-ink-muted">Loading…</p>}
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
  const [erasedMsg, setErasedMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const busyRef = useRef<string | null>(null);
  busyRef.current = busy;

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

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => trigger?.focus?.();
  }, []);

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
                <Badge className={paymentClass(booking.paymentState, booking.status)}>
                  {paymentPill(booking.paymentState, booking.status).label}
                </Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                Booked {fmtDateTime(booking.createdAt)} · via {booking.source}
              </p>
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-medium text-coral"
              >
                {error}
              </p>
            )}

            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                Customer
              </h3>
              <p className="mt-1.5 font-bold text-ink">{booking.customerName}</p>
              <a
                href={`mailto:${booking.customerEmail}`}
                className="block text-[13.5px] text-teal hover:underline"
              >
                {booking.customerEmail}
              </a>
              {booking.customerPhone && (
                <a
                  href={`tel:${booking.customerPhone}`}
                  className="block text-[13.5px] text-ink/80"
                >
                  {booking.customerPhone}
                </a>
              )}
            </section>

            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                Items
              </h3>
              <ul className="mt-2 flex flex-col gap-3">
                {booking.items.map((it, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-bold text-ink">{it.activityTitle}</p>
                    <p className="text-[13px] text-ink-muted">
                      {it.optionName ? `${it.optionName} · ` : ''}
                      {it.quantity} × {it.priceLabel} · {eur(it.unitAmountEur)}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink/70">
                      <IconCalendar width={13} height={13} className="text-teal" />{' '}
                      {fmtDate(it.startsAt)}
                      <IconUsers width={13} height={13} className="ml-2 text-teal" />{' '}
                      {it.pax ?? it.quantity}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center justify-between border-t border-ink/10 pt-3">
                <span className="text-sm font-bold text-ink">Total</span>
                <span className="text-lg font-extrabold text-ink">{eur(booking.totalEur)}</span>
              </div>
            </section>

            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                Pickup &amp; drop-off
              </h3>
              <dl className="mt-2 flex flex-col gap-2.5">
                <div>
                  <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                    Pickup
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-ink/80">
                    {booking.pickupLocation ? (
                      booking.pickupLocation
                    ) : booking.pickupPending ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-bold text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Pickup to be arranged
                      </span>
                    ) : (
                      <span className="text-ink-muted">No pickup · customer makes own way</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11.5px] font-bold uppercase tracking-wide text-ink-muted">
                    Drop-off
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-ink/80">
                    {booking.dropoffLocation ? (
                      booking.dropoffLocation
                    ) : booking.pickupLocation || booking.pickupPending ? (
                      // A null drop-off WITH a pickup means "same as pickup", not "no drop-off".
                      <span className="text-ink-muted">Same as pickup</span>
                    ) : (
                      '—'
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            {booking.transfer && (
              <section className="rounded-xl border border-ink/10 p-4">
                <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  Transfer details
                </h3>
                <dl className="mt-2 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                  <dt className="font-semibold text-ink-muted">Trip</dt>
                  <dd className="text-ink/80">
                    {booking.transfer.direction === 'departure'
                      ? 'Departure (hotel → airport)'
                      : booking.transfer.direction === 'return'
                        ? 'Return (both ways)'
                        : 'Arrival (airport → hotel)'}
                  </dd>
                  {booking.transfer.roomOrCabin && (
                    <>
                      <dt className="font-semibold text-ink-muted">Room/cabin</dt>
                      <dd className="text-ink/80">{booking.transfer.roomOrCabin}</dd>
                    </>
                  )}
                  {(booking.transfer.flightNumber || booking.transfer.arrivalTime) && (
                    <>
                      <dt className="font-semibold text-ink-muted">Arrival</dt>
                      <dd className="text-ink/80">
                        {[booking.transfer.flightNumber, booking.transfer.arrivalTime]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </>
                  )}
                  {(booking.transfer.departureFlightNumber ||
                    booking.transfer.returnDate ||
                    booking.transfer.returnTime) && (
                    <>
                      <dt className="font-semibold text-ink-muted">Departure</dt>
                      <dd className="text-ink/80">
                        {[
                          booking.transfer.departureFlightNumber,
                          [
                            booking.transfer.returnDate
                              ? fmtDate(booking.transfer.returnDate)
                              : null,
                            booking.transfer.returnTime,
                          ]
                            .filter(Boolean)
                            .join(' '),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </dd>
                    </>
                  )}
                  {booking.transfer.luggageDetails && (
                    <>
                      <dt className="font-semibold text-ink-muted">Luggage</dt>
                      <dd className="text-ink/80">{booking.transfer.luggageDetails}</dd>
                    </>
                  )}
                  {booking.transfer.childSeatAge != null && (
                    <>
                      <dt className="font-semibold text-ink-muted">Child seat</dt>
                      <dd className="text-ink/80">age {booking.transfer.childSeatAge}</dd>
                    </>
                  )}
                  {booking.transfer.travellerCountry && (
                    <>
                      <dt className="font-semibold text-ink-muted">Country</dt>
                      <dd className="text-ink/80">{booking.transfer.travellerCountry}</dd>
                    </>
                  )}
                  {booking.transfer.travellerCompany && (
                    <>
                      <dt className="font-semibold text-ink-muted">Company</dt>
                      <dd className="text-ink/80">{booking.transfer.travellerCompany}</dd>
                    </>
                  )}
                  {booking.transfer.travellerGender && (
                    <>
                      <dt className="font-semibold text-ink-muted">Gender</dt>
                      <dd className="text-ink/80 capitalize">{booking.transfer.travellerGender}</dd>
                    </>
                  )}
                  {booking.transfer.specialNotes && (
                    <>
                      <dt className="font-semibold text-ink-muted">Notes</dt>
                      <dd className="text-ink/80">{booking.transfer.specialNotes}</dd>
                    </>
                  )}
                </dl>
              </section>
            )}

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

            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                Payments
              </h3>
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
                            {e.amountEur ? ` · ${eur(e.amountEur)}` : ''} ·{' '}
                            {fmtDateTime(e.occurredAt)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </section>

            <section className="rounded-xl border border-ink/10 p-4">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                Internal note
              </h3>
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

            <section className="flex flex-wrap gap-2">
              {booking.status === 'confirmed' && (
                <button
                  type="button"
                  disabled={busy === 'complete'}
                  onClick={() =>
                    void act('complete', () => setBookingStatus(booking.id, 'completed'))
                  }
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
                    const paid =
                      booking.paymentState === 'paid' ||
                      booking.paymentState === 'partially_refunded';
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
              {(booking.status === 'refund_pending' ||
                ((booking.status === 'confirmed' || booking.status === 'completed') &&
                  (booking.paymentState === 'paid' ||
                    booking.paymentState === 'partially_refunded'))) && (
                <button
                  type="button"
                  disabled={busy === 'refund'}
                  onClick={() => {
                    const msg = `Confirm you've refunded ${eur(booking.netPaidEur)} to ${booking.customerName} in Peach. This records the refund in the ledger and emails the customer their refund confirmation.`;
                    if (window.confirm(msg))
                      void act('refund', () => markBookingRefunded(booking.id));
                  }}
                  className="rounded-full bg-ink px-4 py-2 text-[13px] font-bold text-white hover:bg-teal-dark disabled:opacity-50"
                >
                  {busy === 'refund' ? 'Recording…' : 'Mark refunded'}
                </button>
              )}
              <button
                type="button"
                disabled={busy === 'erase'}
                onClick={() => {
                  const msg = `Permanently anonymise ${booking.customerEmail}'s personal data across ALL their bookings + delete their account data. Use ONLY for a verified erasure request. This cannot be undone.`;
                  if (!window.confirm(msg)) return;
                  const email = booking.customerEmail;
                  setBusy('erase');
                  setError(null);
                  setErasedMsg(null);
                  void (async () => {
                    try {
                      const r = await eraseCustomerData(email);
                      setErasedMsg(
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
                }}
                className="rounded-full border border-coral/40 px-4 py-2 text-[13px] font-bold text-coral hover:bg-coral/10 disabled:opacity-50"
              >
                {busy === 'erase' ? 'Erasing…' : 'Erase customer data'}
              </button>
            </section>
            {erasedMsg && (
              <p
                role="status"
                className="rounded-lg bg-teal/10 px-3 py-2 text-[13px] font-medium text-teal-dark"
              >
                {erasedMsg}
              </p>
            )}
            <p className="text-[11.5px] leading-relaxed text-ink-muted">
              Payment confirmation is handled automatically by the payment provider — staff can mark
              a booking completed or cancel it, but cannot mark it paid here.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
