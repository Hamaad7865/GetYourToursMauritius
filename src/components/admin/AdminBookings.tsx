'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import {
  loadBookings,
  loadBookingDetail,
  setBookingStatus,
  markBookingRefunded,
  eraseCustomerData,
  resetGuestBookingLink,
  saveBookingNotes,
  sendInstallmentReminder,
  bookingExtraCharges,
  findBookingIdByMerchantRef,
  paymentView,
  type BookingRow,
  type BookingDetail,
  type BookingStatus,
  type PaymentState,
  type PaymentView,
} from '@/lib/admin/bookings';
import {
  BOOKING_VIEWS,
  bookingViewCounts,
  inBookingView,
  parseBookingView,
  sortSentence,
  viewSort,
  type BookingSortKey,
  type BookingView,
  type SortDir,
} from '@/lib/admin/booking-views';
import { mailtoHref, telHref, whatsappChatHref } from '@/lib/admin/contact-links';
import { BookingChangePanel } from '@/components/admin/BookingChangePanel';
import { balanceIsOutstanding } from '@/lib/quotes/deposit';
import { csvCell } from '@/lib/admin/csv';
import { IconCalendar, IconUsers, IconX, IconSearch, IconDownload } from '@/components/ui/icons';
import { childSeatsCost } from '@/lib/services/pricing';
import {
  eur,
  fmtDate,
  fmtDateShort,
  fmtDateTime,
  fmtTime,
  mauDay,
  serviceWhen,
  titleCase,
} from '@/lib/admin/format';
import {
  BookingStatusChip,
  PaymentChip,
  PickupFacts,
  TransferFacts,
  paymentCsvLabel,
} from './BookingFacts';
import { PaymentSchedule } from '@/components/booking/PaymentSchedule';
import {
  AdminError,
  AdminHeading,
  INPUT_CLS,
  SELECT_CLS,
  StatusChip,
  Tabs,
  Td,
  Tr,
  buttonClass,
  type StatusTone,
} from '@/components/admin/ui';
import { useElementWidth, useTopbarHeight } from '@/components/admin/useDock';
import { GuestAvatar } from '@/components/admin/GuestAvatar';

function euroInt(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** When the bookings screen itself is this wide, the detail docks beside the table; narrower (a
 *  laptop with the assistant open, a tablet, a phone) it slides over the list with a scrim. */
const DOCK_AT = 1100;

/** The filters sit side by side at their own width (the shared select fills its column). */
const FILTER_SELECT = SELECT_CLS.replace('w-full', 'w-auto');

/** The Date cell: when the guest is collected — a transfer's own pickup time or a tour's start time,
 *  never the day-slot's placeholder clock, and the day alone when there is no time. See `serviceWhen`. */
function ServiceWhenCell({ booking }: { booking: BookingRow }) {
  const when = serviceWhen(booking);
  if (!when) return <>—</>;
  const day = fmtDateShort(when.at);
  return <>{when.time ? `${day} · ${when.time}` : day}</>;
}

/** A payments row's own state, as a chip (the provider's word, title-cased, as before). */
const PAYMENT_ROW_TONE: Record<PaymentState, StatusTone> = {
  paid: 'ok',
  pending: 'neutral',
  failed: 'bad',
  refunded: 'info',
  partially_refunded: 'info',
};

// The status filter stays beside the tabs (a link such as ?status=confirmed still lands here).
const STATUS_FILTERS: Array<{ value: 'all' | BookingStatus; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'payment_pending', label: 'Awaiting payment' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];
// Matched against paymentView, like the chip: "Paid" is paid IN FULL, and a deposit-only booking is
// under "Part paid" (Today's balances link here as ?view=part_paid; ?pay=part_paid still works).
const PAY_FILTERS: Array<{ value: 'all' | PaymentView; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'paid', label: 'Paid' },
  { value: 'part_paid', label: 'Part paid' },
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
    // `paymentCsvLabel` keeps the export's words exactly as they were before the redesign.
    [
      b.ref,
      b.customerName,
      b.customerEmail,
      b.activityTitle,
      fmtDate(serviceWhen(b)?.at ?? null),
      b.createdAt,
      b.guests,
      b.totalEur.toFixed(2),
      paymentCsvLabel(paymentView(b), b.status),
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

/** A sortable column header: a real button, the current order said by `aria-sort`. */
function SortTh({
  label,
  sort,
  current,
  dir,
  onSort,
  num = false,
}: {
  label: string;
  sort: BookingSortKey;
  current: BookingSortKey;
  dir: SortDir;
  onSort: (key: BookingSortKey) => void;
  num?: boolean;
}) {
  const on = current === sort;
  return (
    <th
      scope="col"
      aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={num ? 'text-right' : 'text-left'}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={`-mx-1 inline-flex items-center gap-1 rounded px-1 font-semibold hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-dark ${
          on ? 'text-ink' : ''
        }`}
      >
        {label}
        <span aria-hidden="true" className="w-2.5 text-teal-dark">
          {on ? (dir === 'asc' ? '↑' : '↓') : ''}
        </span>
      </button>
    </th>
  );
}

export function AdminBookings() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';
  // The CSV carries every booking's guest and money columns — it is the Reports permission.
  const canExport = can(useAdminAccess(), 'money.reports');
  // The global top-bar search (AdminShell) routes here as /admin/bookings?q=… — seed the filter from it
  // on arrival, and re-sync if the bar pushes a new query while this screen is already open.
  const searchParams = useSearchParams();
  const qParam = searchParams.get('q');

  const [rows, setRows] = useState<BookingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [today] = useState(() => mauDay(new Date()));
  // Filters + the open booking seed from URL params (Today's cards and rows deep-link here, e.g.
  // ?view=awaiting, ?pay=paid, ?open=<id>). Each param is validated against its allowed values so junk
  // falls back to the neutral default. Only `q` re-syncs live (the top-bar search pushes it while the
  // screen is open); the rest never change mid-screen, so an initializer is enough and won't fight
  // the user's own filtering.
  const [view, setView] = useState<BookingView>(() => parseBookingView(searchParams.get('view')));
  const [status, setStatus] = useState<'all' | BookingStatus>(() => {
    const v = searchParams.get('status');
    return v && STATUS_FILTERS.some((f) => f.value === v) ? (v as 'all' | BookingStatus) : 'all';
  });
  const [pay, setPay] = useState<'all' | PaymentView>(() => {
    const v = searchParams.get('pay');
    return v && PAY_FILTERS.some((f) => f.value === v) ? (v as 'all' | PaymentView) : 'all';
  });
  const [tour, setTour] = useState('all');
  const [dateF, setDateF] = useState<DateFilter>(() => {
    const v = searchParams.get('date');
    return v && DATE_FILTERS.some((f) => f.value === v) ? (v as DateFilter) : 'all';
  });
  const [query, setQuery] = useState(() => qParam ?? '');
  const [sortKey, setSortKey] = useState<BookingSortKey>(() => viewSort(view).key);
  const [sortDir, setSortDir] = useState<SortDir>(() => viewSort(view).dir);
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('open'));
  // Whatever opened the detail gets focus back when it closes.
  // The booking whose row opened the detail, so focus can go back to that row's button on close. An
  // id, not the element: the table changes layout while the detail is docked, so the button that was
  // pressed is not the one on screen when it closes.
  const triggerRef = useRef<string | null>(null);
  const focusBackRef = useRef<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const docked = width >= DOCK_AT;
  const topbar = useTopbarHeight();

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
  // Keyed on the VALUE of q, not the whole query string: choosing a tab rewrites ?view= in place, and
  // that must not wipe what the user has typed.
  useEffect(() => {
    if (qParam !== null) setQuery(qParam);
  }, [qParam]);

  const tourOptions = useMemo(() => {
    const set = new Set<string>();
    for (const b of rows ?? []) set.add(b.activityTitle);
    return [...set].sort();
  }, [rows]);

  // Tab counts from the WHOLE list, before any filter — the Awaiting payment count is Today's.
  const counts = useMemo(() => bookingViewCounts(rows ?? [], today), [rows, today]);

  const filtersActive =
    status !== 'all' || pay !== 'all' || tour !== 'all' || dateF !== 'all' || query.trim() !== '';
  const clearFilters = () => {
    setStatus('all');
    setPay('all');
    setTour('all');
    setDateF('all');
    setQuery('');
  };

  const selectView = (id: string) => {
    const next = parseBookingView(id);
    setView(next);
    // Each tab opens in its own order (a day tab soonest first); a header click still overrides it.
    const s = viewSort(next);
    setSortKey(s.key);
    setSortDir(s.dir);
    const url = new URL(window.location.href);
    if (next === 'all') url.searchParams.delete('view');
    else url.searchParams.set('view', next);
    window.history.replaceState(null, '', url);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (rows ?? []).filter((b) => {
      if (!inBookingView(b, view, today)) return false;
      if (status !== 'all' && b.status !== status) return false;
      if (pay !== 'all' && paymentView(b) !== pay) return false;
      if (tour !== 'all' && b.activityTitle !== tour) return false;
      if (dateF !== 'all') {
        // The guest's real day — a departure-only transfer's slot can sit days before its return_date.
        const d = serviceWhen(b)?.day ?? null;
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
      // By when the guest is collected (a transfer's slot is a placeholder noon). Parsed, not compared
      // as strings: these mix +04:00 and +00:00 offsets.
      else
        [av, bv] = [
          Date.parse(serviceWhen(a)?.at ?? a.createdAt),
          Date.parse(serviceWhen(b)?.at ?? b.createdAt),
        ];
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, view, today, status, pay, tour, dateF, query, sortKey, sortDir]);

  // Searching a PROVIDER reference. A generated merchantTransactionId carries no booking ref, so a
  // staffer holding one from the Peach dashboard would otherwise have nowhere to paste it. Only tried
  // when the ordinary search comes up empty, which is what keeps a real booking ref on the fast path.
  const [refMiss, setRefMiss] = useState(false);
  useEffect(() => {
    const q = query.trim().toUpperCase();
    if (!rows || filtered.length > 0 || !/^BMT[0-9A-Z]{13}$/.test(q)) {
      setRefMiss(false);
      return;
    }
    let cancelled = false;
    findBookingIdByMerchantRef(q)
      .then((id) => {
        if (cancelled) return;
        if (id) setSelectedId(id);
        else setRefMiss(true);
      })
      .catch(() => {
        if (!cancelled) setRefMiss(true);
      });
    return () => {
      cancelled = true;
    };
  }, [query, rows, filtered.length]);

  const toggleSort = (key: BookingSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'total' || key === 'date' || key === 'booked' ? 'desc' : 'asc');
    }
  };

  const open = (id: string) => {
    triggerRef.current = id;
    setSelectedId(id);
  };
  const close = useCallback(() => {
    focusBackRef.current = triggerRef.current;
    triggerRef.current = null;
    setSelectedId(null);
  }, []);
  // After the panel has gone and the table is back in its full layout, focus that row's button.
  useEffect(() => {
    if (selectedId !== null || !focusBackRef.current) return;
    const id = focusBackRef.current;
    focusBackRef.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-open-booking="${CSS.escape(id)}"]`)?.focus();
  }, [selectedId]);

  const subtitle = rows
    ? `${rows.length} ${rows.length === 1 ? 'booking' : 'bookings'}. ${
        counts.awaiting === 0
          ? 'Nothing is waiting for payment.'
          : counts.awaiting === 1
            ? '1 is waiting for payment.'
            : `${counts.awaiting} are waiting for payment.`
      }`
    : 'Loading…';
  const sort = { current: sortKey, dir: sortDir, onSort: toggleSort };
  const panelOpen = selectedId !== null;
  const compact = panelOpen && docked;

  const detail = selectedId ? (
    <BookingDrawer
      key={selectedId}
      id={selectedId}
      mode={docked ? 'docked' : 'overlay'}
      onClose={close}
      onChanged={() => void load()}
    />
  ) : null;

  return (
    <div ref={rootRef} className="min-w-0">
      <AdminHeading
        title="Bookings"
        subtitle={subtitle}
        action={
          canExport ? (
            <button
              type="button"
              disabled={!rows || rows.length === 0}
              onClick={() => exportCsv(filtered)}
              className={buttonClass('ghost')}
              title="Downloads the bookings shown below, as a spreadsheet"
            >
              <IconDownload width={15} height={15} aria-hidden="true" />
              Export CSV
            </button>
          ) : undefined
        }
      />

      <Tabs
        label="Booking views"
        items={BOOKING_VIEWS.map((v) => ({
          id: v.id,
          label: v.label,
          count: rows ? counts[v.id] : undefined,
        }))}
        active={view}
        onSelect={selectView}
        className="mb-3"
      />

      {error && <AdminError>{error}</AdminError>}

      <div className="flex items-start gap-3.5">
        {/* The list: its search and filters on top (they combine with the tab), then the table. */}
        <section
          aria-label="Bookings"
          className="min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-white shadow-[0_1px_2px_rgba(10,46,54,0.05)]"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <div className="relative min-w-[180px] flex-[1_1_220px] sm:max-w-[300px]">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft">
                <IconSearch width={15} height={15} aria-hidden="true" />
              </span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search bookings"
                placeholder="Search ref, name or email"
                className={`${INPUT_CLS} bg-[#FAFBFB] pl-8 focus:bg-white`}
              />
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'all' | BookingStatus)}
              aria-label="Filter by status"
              className={FILTER_SELECT}
            >
              {STATUS_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select
              value={tour}
              onChange={(e) => setTour(e.target.value)}
              aria-label="Filter by tour"
              className={`${FILTER_SELECT} max-w-[200px]`}
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
              onChange={(e) => setPay(e.target.value as 'all' | PaymentView)}
              aria-label="Filter by payment"
              className={FILTER_SELECT}
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
              className={FILTER_SELECT}
            >
              {DATE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            {filtersActive && (
              <button type="button" onClick={clearFilters} className={buttonClass('quiet', 'sm')}>
                <IconX width={13} height={13} aria-hidden="true" /> Clear filters
              </button>
            )}
            <span
              className="ml-auto whitespace-nowrap pl-1 text-[12px] text-ink-soft"
              aria-live="polite"
            >
              {rows ? `${filtered.length} of ${rows.length} · ` : ''}
              {sortSentence(sortKey, sortDir)}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table
              className={`w-full ${compact ? 'min-w-[560px]' : 'min-w-[900px]'} border-collapse text-[13px] [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[#FAFBFB] [&_th]:px-3 [&_th]:py-[9px] [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-ink-soft [&_tr:last-child>td]:border-b-0`}
            >
              <caption className="sr-only">
                Bookings, {sortSentence(sortKey, sortDir).toLowerCase()}. Choose a reference to open
                its details.
              </caption>
              <thead>
                {compact ? (
                  /* Beside the open booking there is room for four columns; every fact is still in
                     the row (the ref under the guest, the tour under the date, both chips). */
                  <tr>
                    <SortTh label="Guest" sort="customer" {...sort} />
                    <SortTh label="Trip date" sort="date" {...sort} />
                    <SortTh label="Total" sort="total" num {...sort} />
                    <th scope="col" className="text-left">
                      Payment and status
                    </th>
                  </tr>
                ) : (
                  <tr>
                    <SortTh label="Ref" sort="ref" {...sort} />
                    <SortTh label="Guest" sort="customer" {...sort} />
                    <th scope="col" className="text-left">
                      Tour
                    </th>
                    <SortTh label="Trip date" sort="date" {...sort} />
                    <SortTh label="Booked" sort="booked" {...sort} />
                    <SortTh label="Total" sort="total" num {...sort} />
                    <th scope="col" className="text-left">
                      Payment and status
                    </th>
                  </tr>
                )}
              </thead>
              <tbody>
                {(rows ?? []).length > 0 &&
                  filtered.map((b) => {
                    const refButton = (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open(b.id);
                        }}
                        aria-label={`Open booking ${b.ref} for ${b.customerName}`}
                        data-open-booking={b.id}
                        className={`whitespace-nowrap rounded font-mono font-semibold text-teal-dark hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark ${
                          compact ? 'text-[11.5px]' : 'text-[12.5px]'
                        }`}
                      >
                        {b.ref}
                      </button>
                    );
                    const guests = `${b.guests} ${b.guests === 1 ? 'guest' : 'guests'}`;
                    return (
                      <Tr
                        key={b.id}
                        selected={b.id === selectedId}
                        onClick={() => {
                          // A click anywhere on the row opens it; the ref button is the keyboard way in.
                          open(b.id);
                        }}
                        className={`cursor-pointer ${b.id === selectedId ? '' : 'hover:[&>td]:bg-[#FAFBFB]'}`}
                      >
                        {compact ? (
                          <>
                            <Td>
                              <span className="flex min-w-0 items-center gap-2.5">
                                <GuestAvatar name={b.customerName} />
                                <span className="min-w-0">
                                  <span className="block max-w-[170px] truncate font-semibold text-ink">
                                    {b.customerName}
                                  </span>
                                  {refButton}
                                </span>
                              </span>
                            </Td>
                            <Td className="text-ink-muted">
                              <span className="block whitespace-nowrap font-semibold text-ink">
                                <ServiceWhenCell booking={b} />
                              </span>
                              <span className="block max-w-[180px] truncate text-[12px] text-ink-soft">
                                {b.activityTitle} · {guests}
                              </span>
                            </Td>
                            <Td num className="font-semibold text-ink">
                              {euroInt(b.totalEur)}
                            </Td>
                            <Td>
                              <span className="flex flex-col items-start gap-1">
                                <PaymentChip view={paymentView(b)} status={b.status} />
                                <BookingStatusChip status={b.status} />
                              </span>
                            </Td>
                          </>
                        ) : (
                          <>
                            <Td>{refButton}</Td>
                            <Td>
                              <span className="flex min-w-0 items-center gap-2.5">
                                <GuestAvatar name={b.customerName} />
                                <span className="min-w-0">
                                  <span className="block max-w-[220px] truncate font-semibold text-ink">
                                    {b.customerName}
                                  </span>
                                  <span className="block max-w-[220px] truncate text-[12px] text-ink-soft">
                                    {b.customerEmail}
                                  </span>
                                </span>
                              </span>
                            </Td>
                            <Td className="max-w-[220px]">
                              <span className="block truncate text-ink">{b.activityTitle}</span>
                              <span className="block text-[12px] text-ink-soft">{guests}</span>
                            </Td>
                            <Td className="whitespace-nowrap text-ink">
                              <ServiceWhenCell booking={b} />
                            </Td>
                            <Td className="whitespace-nowrap text-ink-muted">
                              <span className="block">
                                {`${fmtDateShort(b.createdAt)} · ${fmtTime(b.createdAt)}`}
                              </span>
                              <span className="block text-[12px] text-ink-soft">
                                via {titleCase(b.source)}
                              </span>
                            </Td>
                            <Td num className="font-semibold text-ink">
                              {euroInt(b.totalEur)}
                            </Td>
                            <Td>
                              <span className="flex flex-col items-start gap-1">
                                <PaymentChip view={paymentView(b)} status={b.status} />
                                <BookingStatusChip status={b.status} />
                              </span>
                            </Td>
                          </>
                        )}
                      </Tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {rows !== null && filtered.length === 0 && (
            <div className="px-6 py-12 text-center">
              <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-line-soft text-ink-muted">
                <IconSearch width={18} height={18} aria-hidden="true" />
              </div>
              <div className="text-[14px] font-bold text-ink">
                {refMiss
                  ? 'No booking for that reference'
                  : rows.length === 0
                    ? 'No bookings yet'
                    : 'No bookings match these filters'}
              </div>
              <div className="mt-1 text-[13px] text-ink-soft">
                {refMiss
                  ? 'That looks like a provider reference, but it isn’t one we issued.'
                  : rows.length === 0
                    ? 'They’ll appear here as customers book.'
                    : view !== 'all'
                      ? 'Try the All tab, widening the date range or clearing filters.'
                      : 'Try widening the date range or clearing filters.'}
              </div>
            </div>
          )}
          {rows === null && <p className="p-6 text-ink-soft">Loading…</p>}
        </section>

        {/* The open booking, docked beside the table on a wide screen. */}
        {panelOpen && docked && (
          <div
            className="sticky w-[420px] shrink-0 self-start"
            style={{ top: topbar + 12, maxHeight: `calc(100dvh - ${topbar + 24}px)` }}
          >
            {detail}
          </div>
        )}
      </div>

      {/* …or over the list on a narrower one. */}
      {panelOpen && !docked && width > 0 && detail}
    </div>
  );
}

const CANCELLABLE: BookingStatus[] = ['draft', 'held', 'payment_pending', 'confirmed'];

/** Money was taken and has not all gone back: a refund is outstanding or can be recorded. */
function isRefundable(b: Pick<BookingDetail, 'status' | 'paymentState'>): boolean {
  return (
    b.status === 'refund_pending' ||
    ((b.status === 'confirmed' || b.status === 'completed') &&
      (b.paymentState === 'paid' || b.paymentState === 'partially_refunded'))
  );
}

const SECTION = 'border-t border-line-soft px-4 py-3.5';
const SECTION_H = 'mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft';

function BookingDrawer({
  id,
  mode,
  onClose,
  onChanged,
}: {
  id: string;
  /** Docked beside the table (wide screens) or a modal sheet over it. */
  mode: 'docked' | 'overlay';
  onClose: () => void;
  onChanged: () => void;
}) {
  const canRefund = can(useAdminAccess(), 'money.refunds');
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `booking === null`: a well-formed id that has no row (deleted / erased / stale
  // deep-link) resolves to null WITHOUT throwing, so without this flag the drawer can't tell
  // "loaded, not found" from "still loading" and would hang on the spinner forever.
  const [notFound, setNotFound] = useState(false);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [erasedMsg, setErasedMsg] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const busyRef = useRef<string | null>(null);
  busyRef.current = busy;
  const overlay = mode === 'overlay';

  // Priced components that carry no booking_items row of their own — see bookingExtraCharges.
  const extraCharges = useMemo(() => (booking ? bookingExtraCharges(booking) : []), [booking]);

  const requestClose = useCallback(() => {
    if (!busyRef.current) onClose();
  }, [onClose]);

  const reload = useCallback(async () => {
    try {
      const detail = await loadBookingDetail(id);
      setBooking(detail);
      setNotFound(detail === null); // resolved, but no such booking → show a not-found state, not a spinner
      setNotes(detail?.notes ?? '');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this booking.');
    }
  }, [id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Only the overlay holds the page still; the docked panel scrolls beside a list that still works.
  useEffect(() => {
    if (!overlay) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [overlay]);

  // Focus moves into the panel when it opens (the list gives it back on close).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!busyRef.current) onClose();
        return;
      }
      // The overlay is modal: Tab stays inside it. The docked panel is part of the page.
      if (overlay && e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [onClose, overlay]);

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

  const email = booking ? mailtoHref(booking.customerEmail) : null;
  const phone = booking ? telHref(booking.customerPhone) : null;
  const whatsapp = booking ? whatsappChatHref(booking.customerPhone) : null;

  const panel = (
    <aside
      ref={panelRef}
      role={overlay ? 'dialog' : undefined}
      aria-modal={overlay ? true : undefined}
      aria-label="Booking details"
      tabIndex={-1}
      className={`flex flex-col bg-white outline-none ${
        overlay
          ? 'relative h-full w-full max-w-[440px] overflow-y-auto shadow-[-30px_0_60px_-24px_rgba(8,30,33,0.45)]'
          : 'max-h-[inherit] overflow-y-auto rounded-xl border border-line'
      }`}
    >
      <header className="sticky top-0 z-[1] flex min-h-[46px] items-center gap-2 border-b border-line-soft bg-white px-4 py-2">
        {booking ? (
          <>
            <span className="font-mono text-[13px] font-semibold text-teal-dark">
              {booking.ref}
            </span>
            <BookingStatusChip status={booking.status} />
            <PaymentChip view={paymentView(booking)} status={booking.status} />
          </>
        ) : (
          <span className="text-[13.5px] font-bold text-ink">Booking details</span>
        )}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close booking details"
          className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted hover:bg-line-soft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-dark"
        >
          <IconX width={16} height={16} aria-hidden="true" />
        </button>
      </header>

      {!booking ? (
        notFound ? (
          <div className="flex flex-col items-start gap-3 p-4">
            <p className="text-ink-muted">
              This booking couldn’t be found — it may have been cancelled or deleted.
            </p>
            <button type="button" onClick={requestClose} className={buttonClass('ghost', 'sm')}>
              Close
            </button>
          </div>
        ) : error ? (
          <p role="alert" className="p-4 text-coral-dark">
            {error}
          </p>
        ) : (
          <p className="p-4 text-ink-soft">Loading…</p>
        )
      ) : (
        <div className="flex flex-col">
          {/* The guest, and the quickest ways to reach them. */}
          <div className="px-4 py-3.5">
            <p className="text-[16px] font-bold text-ink">{booking.customerName}</p>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">
              Booked {fmtDateTime(booking.createdAt)} · via {booking.source}
            </p>
            <div className="mt-2 flex flex-col text-[13px]">
              {email ? (
                <a href={email} className="w-fit text-teal-dark hover:underline">
                  {booking.customerEmail}
                </a>
              ) : (
                <span className="text-ink-muted">{booking.customerEmail}</span>
              )}
              {booking.customerPhone &&
                (phone ? (
                  <a href={phone} className="w-fit text-ink-muted hover:underline">
                    {booking.customerPhone}
                  </a>
                ) : (
                  <span className="text-ink-muted">{booking.customerPhone}</span>
                ))}
            </div>
            {(whatsapp || email) && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {whatsapp && (
                  <a
                    href={whatsapp}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClass('ghost', 'sm')}
                  >
                    WhatsApp
                    <span className="sr-only"> {booking.customerName} (opens WhatsApp)</span>
                  </a>
                )}
                {email && (
                  <a href={email} className={buttonClass('ghost', 'sm')}>
                    Email
                    <span className="sr-only"> {booking.customerName}</span>
                  </a>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4">
              <AdminError>{error}</AdminError>
            </div>
          )}

          <section className={SECTION}>
            <h3 className={SECTION_H}>Items</h3>
            <ul className="flex flex-col gap-3">
              {booking.items.map((it, i) => (
                <li key={i}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{it.activityTitle}</p>
                      <p className="text-[12.5px] text-ink-muted">
                        {/* On a single-option activity the option name IS the price label; printing
                            both gives "X · 1 × X". */}
                        {it.optionName && it.optionName !== it.priceLabel
                          ? `${it.optionName} · `
                          : ''}
                        {it.quantity} × {it.priceLabel}
                        {/* Unit price only when it differs from the line total, else it reads twice. */}
                        {it.quantity > 1 ? ` · ${eur(it.unitAmountEur)} each` : ''}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
                        <IconCalendar width={13} height={13} aria-hidden="true" />{' '}
                        {fmtDate(
                          serviceWhen({
                            startsAt: it.startsAt,
                            transfer: booking.transfer,
                            pickupTime: booking.pickupTime,
                            departureTime: it.departureTime,
                          })?.at ?? null,
                        )}
                        <IconUsers width={13} height={13} className="ml-2" aria-hidden="true" />{' '}
                        <span className="sr-only">Guests:</span>
                        {it.pax ?? it.quantity}
                      </p>
                    </div>
                    <span className="shrink-0 font-semibold text-ink">{eur(it.subtotalEur)}</span>
                  </div>
                  {/* The line's OWN round-trip transfer, nested under it exactly like the invoice, so a
                      multi-tour booking shows each activity's pickup instead of one booking-level line. */}
                  {it.transportFareEur > 0 && (
                    <div className="ml-3 mt-1.5 flex items-baseline justify-between gap-3 border-l-2 border-line pl-2.5 text-[12.5px]">
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
              ))}
            </ul>
            {/* Charges with no booking_items row (quote lines + their transfers, region transport,
                child seats, supplements). Without these the Total silently exceeds the lines above
                and staff cannot explain the amount charged. An add-on transfer is indented under its
                line, like the invoice; keyed by index because two lines can share a transfer label. */}
            {extraCharges.length > 0 && (
              <ul className="mt-2.5 flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
                {extraCharges.map((charge, i) => (
                  <li
                    key={i}
                    className={`flex items-baseline justify-between gap-3 text-[13px] ${
                      charge.isAddon ? 'ml-3 border-l-2 border-line pl-2.5' : ''
                    }`}
                  >
                    <span className="text-ink-muted">{charge.label}</span>
                    <span className="shrink-0 font-semibold text-ink">{eur(charge.amountEur)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-line-soft pt-3">
              <span className="font-bold text-ink">Total</span>
              <span className="text-[16px] font-bold text-ink">{eur(booking.totalEur)}</span>
            </div>
            {/* A DEPOSIT-CONFIRMED QUOTE BOOKING IS NOT SETTLED. `payment_state` flips to 'paid' the
                moment the deposit clears, so without this a €1.00 booking with €0.10 taken reads
                "Paid" beside its €1.00 total and nothing says the rest is still to collect.

                Gated on balanceIsOutstanding, NOT on `balanceDueEur > 0`: that column is recomputed
                after a FAILED payment too, so the bare test claimed a balance was "still to
                collect" on ordinary bookings nobody had ever paid for. */}
            {balanceIsOutstanding({
              deposit: booking.depositEur,
              balanceDue: booking.balanceDueEur,
              total: booking.totalEur,
            }) && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-gold-tint px-3 py-2 text-gold-dark">
                <span className="text-[13px] font-semibold">Balance still to collect</span>
                <span className="text-[15px] font-bold">{eur(booking.balanceDueEur)}</span>
              </div>
            )}
          </section>

          {booking.installments.length > 0 && (
            <section className={SECTION}>
              <PaymentSchedule
                installments={booking.installments}
                onSendReminder={(seq) => sendInstallmentReminder(booking.ref, seq)}
              />
            </section>
          )}

          <section className={SECTION}>
            <h3 className={SECTION_H}>Pickup &amp; drop-off</h3>
            <PickupFacts
              pickupLocation={booking.pickupLocation}
              dropoffLocation={booking.dropoffLocation}
              pickupPending={booking.pickupPending}
              transportPickup={booking.transportPickup}
              transportDropoff={booking.transportDropoff}
              transferDirection={booking.transfer?.direction ?? null}
            />
          </section>

          {booking.transfer && (
            <section className={SECTION}>
              <h3 className={SECTION_H}>Transfer details</h3>
              <TransferFacts transfer={booking.transfer} />
            </section>
          )}

          {booking.childSeats > 0 && (
            <section className={SECTION}>
              <h3 className={SECTION_H}>Baby &amp; child seats</h3>
              <p className="text-[13px] text-ink-muted">
                {booking.childSeats} {booking.childSeats === 1 ? 'seat' : 'seats'}
                {childSeatsCost(booking.childSeats) > 0
                  ? ` — first free, €${childSeatsCost(booking.childSeats)} extra`
                  : ' — free'}
              </p>
            </section>
          )}

          {booking.customItinerary && booking.customItinerary.length > 0 && (
            <section className={SECTION}>
              <h3 className={SECTION_H}>Customer route</h3>
              <ol className="list-decimal pl-5 text-[13px] text-ink-muted">
                {booking.customItinerary.map((s, i) => (
                  <li key={i}>{s.area ? `${s.title} — ${s.area}` : s.title}</li>
                ))}
              </ol>
            </section>
          )}

          <section className={SECTION}>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
                Payments
              </h3>
              {/* The master reference every provider id below hangs off. A generated id is opaque,
                  so this is the only place the two are shown together. */}
              <span className="text-[11.5px] text-ink-soft">
                master ref · <span className="font-mono text-ink-muted">{booking.ref}</span>
              </span>
            </div>
            {booking.payments.length === 0 ? (
              <p className="text-[13px] text-ink-soft">No payment started yet.</p>
            ) : (
              booking.payments.map((p) => (
                <div key={p.id} className="mt-2 first:mt-0">
                  <div className="flex items-center justify-between gap-2 text-[13px]">
                    <span className="font-semibold text-ink">
                      {titleCase(p.provider)} · {eur(p.amountEur)}
                    </span>
                    <StatusChip tone={PAYMENT_ROW_TONE[p.status] ?? 'neutral'}>
                      {titleCase(p.status)}
                    </StatusChip>
                  </div>
                  {/* Provider references, oldest first. Each is a merchantTransactionId this payment
                      issued; a second one means the session was reissued after the first was refused.
                      Searching any of them in the box above lands back on this booking. */}
                  {p.merchantRefs.length > 0 ? (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
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
                    <p className="mt-1.5 text-[12px] text-ink-soft">
                      No provider reference recorded — this payment pre-dates the history, so its id
                      was derived from the booking ref.
                    </p>
                  )}
                  {p.events.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-1 border-l-2 border-line pl-3">
                      {p.events.map((e, i) => (
                        <li key={i} className="text-[12px] text-ink-soft">
                          <span className="font-semibold text-ink-muted">{titleCase(e.type)}</span>
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

          {/* Change of tour. Only a confirmed + paid booking can be moved — the RPC enforces this
              too, but offering the panel on an unpayable booking would be a dead end. */}
          {booking.status === 'confirmed' && booking.paymentState === 'paid' && (
            <BookingChangePanel
              bookingId={booking.id}
              bookingRef={booking.ref}
              currentStartsAt={booking.items.map((i) => i.startsAt).filter(Boolean)[0] ?? null}
              currentDepartureTime={booking.items.find((i) => i.startsAt)?.departureTime ?? null}
              onChanged={() => {
                void reload();
                onChanged();
              }}
            />
          )}

          <section className={SECTION}>
            <label htmlFor={`booking-note-${booking.id}`} className={`block ${SECTION_H}`}>
              Private note
            </label>
            <textarea
              id={`booking-note-${booking.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add a private note (not shown to the customer)…"
              className="w-full rounded-lg border border-line bg-white px-2.5 py-2 text-[13px] text-ink outline-none placeholder:text-ink-soft focus:border-teal-dark focus:ring-[3px] focus:ring-teal-dark/20"
            />
            <button
              type="button"
              disabled={busy === 'note' || notes === (booking.notes ?? '')}
              onClick={() => void act('note', () => saveBookingNotes(booking.id, notes))}
              className={`mt-2 ${buttonClass('ghost', 'sm')}`}
            >
              {busy === 'note' ? 'Saving…' : 'Save note'}
            </button>
          </section>

          <section className={`${SECTION} flex flex-wrap gap-2`} aria-label="Booking actions">
            {booking.status === 'confirmed' && (
              <button
                type="button"
                disabled={busy === 'complete'}
                onClick={() =>
                  void act('complete', () => setBookingStatus(booking.id, 'completed'))
                }
                className={buttonClass('ghost', 'sm')}
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
                className={buttonClass('danger', 'sm')}
              >
                {busy === 'cancel' ? 'Cancelling…' : 'Cancel booking'}
              </button>
            )}
            {/* Only where a refund is actually waiting; an ordinary paid booking needs no note. */}
            {booking.status === 'refund_pending' && !canRefund && (
              <p className="w-full text-[12px] text-ink-soft">
                The owner records refunds — tell them once it’s been sent in Peach.
              </p>
            )}
            {canRefund && isRefundable(booking) && (
              <button
                type="button"
                disabled={busy === 'refund'}
                onClick={() => {
                  const msg = `Confirm you've refunded ${eur(booking.netPaidEur)} to ${booking.customerName} in Peach. This records the refund in the ledger and emails the customer their refund confirmation.`;
                  if (window.confirm(msg))
                    void act('refund', () => markBookingRefunded(booking.id));
                }}
                className={buttonClass('ghost', 'sm')}
              >
                {busy === 'refund' ? 'Recording…' : 'Mark refunded'}
              </button>
            )}
            {/* For a leaked manage link. Harmless on an account's booking, which has no link. */}
            <button
              type="button"
              disabled={busy === 'guest-link'}
              onClick={() => {
                const msg =
                  'Reset the guest link? Every link already emailed for this booking stops working. The guest can get a new one at /bookings/find.';
                if (!window.confirm(msg)) return;
                setBusy('guest-link');
                setError(null);
                setErasedMsg(null);
                void (async () => {
                  try {
                    await resetGuestBookingLink(booking.ref);
                    setErasedMsg('Guest link reset. Links already emailed no longer work.');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Action failed.');
                  } finally {
                    setBusy(null);
                  }
                })();
              }}
              className={buttonClass('ghost', 'sm')}
            >
              {busy === 'guest-link' ? 'Resetting…' : 'Reset guest link'}
            </button>
            <button
              type="button"
              disabled={busy === 'erase'}
              onClick={() => {
                const msg = `Permanently anonymise ${booking.customerEmail}'s personal data across ALL their bookings + delete their account data. Use ONLY for a verified erasure request. This cannot be undone.`;
                if (!window.confirm(msg)) return;
                const customerEmail = booking.customerEmail;
                setBusy('erase');
                setError(null);
                setErasedMsg(null);
                void (async () => {
                  try {
                    const r = await eraseCustomerData(customerEmail);
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
              className={buttonClass('danger', 'sm')}
            >
              {busy === 'erase' ? 'Erasing…' : 'Erase customer data'}
            </button>
          </section>
          {erasedMsg && (
            <p
              role="status"
              className="mx-4 mb-3 rounded-lg bg-teal-tint px-3 py-2 text-[13px] font-medium text-teal-dark"
            >
              {erasedMsg}
            </p>
          )}
          <p className="border-t border-line-soft px-4 py-3 text-[11.5px] leading-relaxed text-ink-soft">
            Payment confirmation is handled automatically by the payment provider — staff can mark a
            booking completed or cancel it, but cannot mark it paid here.
          </p>
        </div>
      )}
    </aside>
  );

  if (!overlay) return panel;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close booking details"
        tabIndex={-1}
        onClick={requestClose}
        className="absolute inset-0 bg-[rgba(8,30,33,0.32)]"
      />
      {panel}
    </div>
  );
}
