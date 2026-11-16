'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import {
  loadBookings,
  findBookingIdByMerchantRef,
  paymentView,
  type BookingRow,
  type BookingStatus,
  type PaymentView,
  bookingLineDays,
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
import { csvCell } from '@/lib/admin/csv';
import { IconX, IconSearch, IconDownload } from '@/components/ui/icons';
import { fmtDate, fmtDateShort, fmtTime, mauDay, serviceWhen, titleCase } from '@/lib/admin/format';
import { BookingStatusChip, PaymentChip, paymentCsvLabel } from './BookingFacts';
import {
  AdminError,
  AdminHeading,
  INPUT_CLS,
  SELECT_CLS,
  Tabs,
  Td,
  Tr,
  buttonClass,
  AdminSelect,
} from '@/components/admin/ui';
import { GuestAvatar } from '@/components/admin/GuestAvatar';
import { BookingDrawer } from '@/components/admin/bookings/BookingDrawer';
import { useAssistant } from '@/components/admin/assistant/AssistantProvider';
import {
  listNeighbours,
  otherBookingCount,
  parseDrawerTab,
  type DrawerTab,
} from '@/components/admin/bookings/rules';

function euroInt(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The filters sit side by side at their own width (the shared select fills its column). */
const FILTER_SELECT = SELECT_CLS.replace('w-full', 'w-auto');

/** The Date cell: when the guest is collected — a transfer's own pickup time or a tour's start time,
 *  never the day-slot's placeholder clock, and the day alone when there is no time. See `serviceWhen`.
 *  A booking whose lines run over several days (a multi-line quote: a tour, then a rental, then a
 *  transfer) adds the last of them underneath, and how many dates there are when it is more than two. */
function ServiceWhenCell({ booking }: { booking: BookingRow }) {
  const when = serviceWhen(booking);
  if (!when) return <>—</>;
  const day = fmtDateShort(when.at);
  const head = when.time ? `${day} · ${when.time}` : day;
  const days = bookingLineDays(booking);
  const last = days[days.length - 1];
  if (!last || last <= when.day) return <>{head}</>;
  return (
    <>
      {head}
      <span className="block text-[11.5px] font-normal text-ink-soft">
        to {fmtDateShort(`${last}T12:00:00+04:00`)}
        {days.length > 2 ? ` · ${days.length} dates` : ''}
      </span>
    </>
  );
}

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
  // The panel's tab (?tab=payment deep-links it). Kept here, not in the panel, so Previous / Next
  // stay on the tab being worked through; opening a booking from the list starts on Overview.
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(() =>
    parseDrawerTab(searchParams.get('tab')),
  );
  // The booking whose row opened the panel, so focus goes back to that row's button on close. An id,
  // not the element: Previous / Next move it on, and the row last shown is the one to return to.
  const triggerRef = useRef<string | null>(null);
  const focusBackRef = useRef<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);

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
    setDrawerTab('overview');
    setSelectedId(id);
  };
  // Previous / Next in the panel: the same list, in the order shown.
  const navigate = (id: string) => {
    triggerRef.current = id;
    setSelectedId(id);
  };
  const close = useCallback(() => {
    focusBackRef.current = triggerRef.current;
    triggerRef.current = null;
    setSelectedId(null);
  }, []);
  // Belle Mare AI asks for a booking through its context, not the address: `?open=` is read once, on
  // arrival, so a link to this screen from the chat while already on it would open nothing.
  const assistant = useAssistant();
  const openRequest = assistant?.openRequest ?? null;
  const takeOpenRequest = assistant?.takeOpenRequest;
  useEffect(() => {
    if (!openRequest || !takeOpenRequest) return;
    const r = takeOpenRequest('booking');
    if (!r) return;
    triggerRef.current = null;
    setDrawerTab('overview');
    setSelectedId(r.id);
  }, [openRequest, takeOpenRequest]);
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
  const neighbours = listNeighbours(
    filtered.map((b) => b.id),
    selectedId,
  );
  // "Their other bookings" in the panel: the list, cleared down to this guest's email.
  const showGuestBookings = (email: string) => {
    close();
    selectView('all');
    clearFilters();
    setQuery(email);
  };

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
            <AdminSelect
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
            </AdminSelect>
            <AdminSelect
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
            </AdminSelect>
            <AdminSelect
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
            </AdminSelect>
            <AdminSelect
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
            </AdminSelect>
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
              className={`w-full min-w-[900px] border-collapse text-[13px] [&_td]:border-b [&_td]:border-line-soft [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:bg-[#FAFBFB] [&_th]:px-3 [&_th]:py-[9px] [&_th]:text-[11.5px] [&_th]:font-semibold [&_th]:text-ink-soft [&_tr:last-child>td]:border-b-0`}
            >
              <caption className="sr-only">
                Bookings, {sortSentence(sortKey, sortDir).toLowerCase()}. Choose a reference to open
                its details.
              </caption>
              <thead>
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
                        className="whitespace-nowrap rounded font-mono text-[12.5px] font-semibold text-teal-dark hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark"
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
      </div>

      {/* The open booking, in a panel over the list (Previous / Next step through it). */}
      {selectedId && (
        <BookingDrawer
          id={selectedId}
          tab={drawerTab}
          onTab={setDrawerTab}
          prevId={neighbours.prev}
          nextId={neighbours.next}
          position={
            neighbours.index >= 0 ? { index: neighbours.index, count: filtered.length } : null
          }
          onNavigate={navigate}
          onClose={close}
          onChanged={() => void load()}
          today={today}
          otherBookings={otherBookingCount(rows ?? [], selectedId)}
          onShowOtherBookings={showGuestBookings}
        />
      )}
    </div>
  );
}
