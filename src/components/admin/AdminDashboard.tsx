'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
import { computeDashboard, euro, statsFor, type DashboardData } from '@/lib/admin/dashboard';
import { loadBookings, paymentView, type BookingRow } from '@/lib/admin/bookings';
import { loadCalendarRange, type DayEntry } from '@/lib/admin/calendar';
import {
  ALL_TYPES_ON,
  MONTHS,
  WEEKDAYS,
  addDays,
  dayNumber,
  shortDay,
  summarize,
  toCalLines,
  weekdayIndex,
  yearMonth,
} from '@/lib/admin/calendar-view';
import { loadQuotes, type QuoteRow } from '@/lib/admin/quotes';
import { loadLeads, type LeadRow } from '@/lib/admin/leads';
import { mauDay, serviceWhen, titleCase } from '@/lib/admin/format';
import { BookingStatusChip, PaymentChip } from '@/components/admin/BookingFacts';
import { GuestAvatar } from '@/components/admin/GuestAvatar';
import { RevenueChart } from '@/components/admin/RevenueChart';
import { RunSheetCard } from '@/components/admin/today/RunSheetCard';
import { NeedsYouCard } from '@/components/admin/today/NeedsYouCard';
import { MetricCard, TODAY_LIFT, type MetricTone } from '@/components/admin/today/MetricCard';
import { IconCalendar, IconClock, IconMail, IconTrendUp, IconWallet } from '@/components/ui/icons';
import {
  daySummary,
  isReady,
  needsYou,
  quoteTotals,
  quietDays,
  departuresByDay,
  runSheetRows,
  todayKpis,
  todaySentence,
  tomorrowOf,
  type Loaded,
  type TodayViewer,
} from '@/components/admin/today/rules';
import {
  AdminError,
  AdminHeading,
  DataTable,
  Panel,
  Td,
  Th,
  buttonClass,
} from '@/components/admin/ui';

/** KPI grid columns by the number of cards, as FULL literal class names so Tailwind emits them. */
const KPI_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
};

/** Each figure's icon and tint on Today. Presentation only: which figures show is `todayKpis`. */
const KPI_LOOK: Record<string, { icon: ReactNode; tone: MetricTone }> = {
  today: { icon: <IconCalendar width={15} height={15} />, tone: 'blue' },
  revenue: { icon: <IconWallet width={15} height={15} />, tone: 'teal' },
  pending: { icon: <IconClock width={15} height={15} />, tone: 'gold' },
  upcoming: { icon: <IconTrendUp width={15} height={15} />, tone: 'violet' },
  quotes: { icon: <IconMail width={15} height={15} />, tone: 'blue' },
};

/** "Saturday 14 November" — the day in Mauritius, as the page's heading. */
function longDay(day: string): string {
  return `${WEEKDAYS[weekdayIndex(day)]} ${dayNumber(day)} ${MONTHS[yearMonth(day)[1]]}`;
}

/** Load one read into its own slot: each fails on its own and says so where it is shown. */
function useRead<T>(enabled: boolean, load: () => Promise<T>, key: string): Loaded<T> {
  const [value, setValue] = useState<Loaded<T>>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setValue(null);
    load()
      .then((v) => active && setValue(v))
      .catch((err: unknown) => {
        console.error(`[today] ${key} could not be loaded`, err);
        if (active) setValue('error');
      });
    return () => {
      active = false;
    };
    // `load` is a module function per call site; the key names the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  return enabled ? value : null;
}

/**
 * TODAY — the back office's home (phase 2 of the redesign). The day's figures, the run sheet with a
 * look at tomorrow, what needs the owner, the money taken and the latest bookings; the two settings
 * that live here stay at the bottom.
 *
 * Who sees what is unchanged from the old dashboard (statsFor / DashViewer): money.revenue for
 * business totals, section.bookings for guest names, per-booking amounts and links into Bookings,
 * Bookings-or-Calendar for departures. Quotes and enquiries appear only with their own sections.
 */
export function AdminDashboard() {
  const { profile } = useAuth();
  const access = useAdminAccess();
  const showMoney = can(access, 'money.revenue');
  const showBookings = can(access, 'section.bookings');
  const showDepartures = can(access, ['section.bookings', 'section.calendar']);
  const showCalendar = can(access, 'section.calendar');
  const showQuotes = can(access, 'section.quotes');
  const showLeads = can(access, 'section.leads');
  const viewer: TodayViewer = useMemo(
    () => ({ showMoney, showBookings, showDepartures, showCalendar, showQuotes, showLeads }),
    [showMoney, showBookings, showDepartures, showCalendar, showQuotes, showLeads],
  );

  // The day is fixed for the visit, as a Mauritius calendar day.
  const [now] = useState(() => new Date());
  const today = mauDay(now);
  const tomorrow = tomorrowOf(today);

  // A role that sees none of the bookings figures has no use for the bookings query, so it is not made.
  const needsBookings = showMoney || showBookings || showDepartures;
  const bookings = useRead<BookingRow[]>(needsBookings, loadBookings, 'bookings');
  const entries = useRead<DayEntry[]>(
    showDepartures,
    () => loadCalendarRange(today, addDays(today, 6)),
    `calendar-${today}`,
  );
  const quotes = useRead<QuoteRow[]>(showQuotes, loadQuotes, 'quotes');
  const leads = useRead<LeadRow[]>(showLeads, loadLeads, 'leads');

  const data: DashboardData | null = useMemo(
    () => (isReady(bookings) ? computeDashboard(bookings, now) : null),
    [bookings, now],
  );
  // For the heading and the card list when the bookings read is not made or failed.
  const empty = useMemo(() => computeDashboard([], now), [now]);

  const lines = useMemo(
    () => (isReady(entries) ? toCalLines(entries, today) : null),
    [entries, today],
  );
  const calendar = useMemo(() => {
    if (!isReady(entries) || !lines) return entries === 'error' ? ('error' as const) : null;
    return {
      today: daySummary(lines, today),
      tomorrow: daySummary(lines, tomorrow),
      next7Departures: summarize(lines, today, addDays(today, 6), {
        types: ALL_TYPES_ON,
        attentionOnly: false,
      }).departures,
    };
  }, [entries, lines, today, tomorrow]);

  const needs = useMemo(() => {
    if (!showBookings && !showQuotes && !showLeads) return null;
    // Bookings rows wait for the bookings read; a failed read says so instead of showing nothing.
    if (showBookings && bookings === null) return null;
    const out = needsYou({ bookings: isReady(bookings) ? bookings : [], quotes, leads }, viewer);
    if (showBookings && bookings === 'error') {
      out.notes.unshift('Bookings could not be loaded.');
    }
    return out;
  }, [bookings, quotes, leads, viewer, showBookings, showQuotes, showLeads]);

  const kpis = useMemo(() => {
    const base = data ?? empty;
    const list = todayKpis(
      {
        stats: statsFor(base.stats, viewer),
        today,
        revenueDeltaPct: data ? data.revenue['7d'].deltaPct : null,
        pendingCount: base.pendingCount,
        pendingTotalEur: base.pendingTotalEur,
        calendar: calendar
          ? calendar === 'error'
            ? 'error'
            : { today: calendar.today, next7Departures: calendar.next7Departures }
          : null,
        quotes: showQuotes
          ? isReady(quotes)
            ? quoteTotals(quotes)
            : quotes === 'error'
              ? 'error'
              : null
          : undefined,
      },
      viewer,
    );
    // A figure from the bookings read never shows a made-up zero while it loads or after it fails.
    return list.map((k) =>
      (k.key === 'revenue' || k.key === 'pending') && !data
        ? {
            ...k,
            value: bookings === 'error' ? '—' : '…',
            detail: bookings === 'error' ? 'Could not load' : 'Loading',
            href: bookings === 'error' ? null : k.href,
          }
        : k,
    );
  }, [data, empty, calendar, quotes, bookings, today, viewer, showQuotes]);

  const firstName = (profile?.fullName || 'there').split(' ')[0];
  const sentence = todaySentence({
    departures:
      showDepartures && calendar && calendar !== 'error' ? calendar.today.departures : null,
    guests: showDepartures && calendar && calendar !== 'error' ? calendar.today.guests : null,
    needs: needs ? needs.total : null,
  });

  const runSheet = showDepartures ? (
    <RunSheetCard
      today={today}
      tomorrow={tomorrow}
      entries={entries}
      todayRows={lines ? runSheetRows(lines, today, showMoney) : []}
      tomorrowRows={lines ? runSheetRows(lines, tomorrow, showMoney) : []}
      tomorrowSummary={calendar && calendar !== 'error' ? calendar.tomorrow : null}
      quiet={lines ? quietDays(lines, today, showMoney) : null}
      showCalendar={showCalendar}
      showMoney={showMoney}
    />
  ) : null;
  const showNeeds = showBookings || showQuotes || showLeads;
  const showRight = showNeeds || (showMoney && Boolean(data));
  const showLatest = showBookings && isReady(bookings);
  const twoCols = showRight && Boolean(runSheet || showLatest);
  // Beside the right-hand stack, under the run sheet (or at the top when there is none).
  const latestClass = twoCols
    ? `min-w-0 self-start xl:col-start-1 ${runSheet ? 'xl:row-start-2' : 'xl:row-start-1'}`
    : 'min-w-0';

  // The latest bookings (loadBookings is newest first).
  const latestPanel = showLatest ? (
    <Panel
      title="Latest bookings"
      meta="Newest first"
      className={`${TODAY_LIFT} ${latestClass}`}
      style={{ '--i': 7 } as CSSProperties}
      actions={
        <Link href="/admin/bookings" className={buttonClass('quiet', 'sm')}>
          See all bookings
        </Link>
      }
    >
      {bookings.length === 0 ? (
        <p className="px-4 py-6 text-center text-ink-soft">No bookings yet.</p>
      ) : (
        <DataTable label="Latest bookings">
          <thead>
            <tr>
              <Th>Guest and tour</Th>
              <Th>Ref</Th>
              <Th>Trip date</Th>
              <Th num>Total</Th>
              <Th>Payment and status</Th>
            </tr>
          </thead>
          <tbody>
            {bookings.slice(0, 6).map((b) => {
              const when = serviceWhen(b);
              return (
                <tr key={b.id}>
                  {/* w-full + max-w-0: this column takes whatever width the others leave and
                      truncates inside it, so a longer chip or ref never pushes the table wider
                      than its card; min-w keeps the name readable on a phone, where it scrolls. */}
                  <Td className="w-full min-w-[170px] max-w-0">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <GuestAvatar name={b.customerName} />
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">
                          {b.customerName}
                        </span>
                        <span className="block truncate text-[12px] text-ink-soft">
                          {b.activityTitle}
                        </span>
                      </span>
                    </span>
                  </Td>
                  <Td>
                    <Link
                      href={`/admin/bookings?open=${b.id}`}
                      className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-teal-dark hover:underline"
                      aria-label={`Open booking ${b.ref} for ${b.customerName}`}
                    >
                      {b.ref}
                    </Link>
                    <span className="block whitespace-nowrap text-[12px] text-ink-soft">
                      {titleCase(b.source)}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{when ? shortDay(when.day) : '—'}</Td>
                  <Td num className="font-semibold text-ink">
                    {euro(b.totalEur)}
                  </Td>
                  <Td>
                    <span className="flex flex-col items-start gap-1">
                      <PaymentChip view={paymentView(b)} status={b.status} />
                      <BookingStatusChip status={b.status} />
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </Panel>
  ) : null;

  return (
    <div>
      <AdminHeading
        title={longDay(today)}
        subtitle={`Good ${(data ?? empty).greetingPart}, ${firstName}.${sentence ? ` ${sentence}` : ''}`}
        action={
          showBookings ? (
            <Link href="/admin/bookings" className={buttonClass('ghost')}>
              View all bookings
            </Link>
          ) : undefined
        }
      />

      {bookings === 'error' && (
        <AdminError>
          The bookings could not be loaded, so the money figures and the booking lists are missing.
          Try reloading the page.
        </AdminError>
      )}

      {/* The figures across the top. */}
      {needsBookings && bookings === null ? (
        <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[124px] animate-pulse rounded-xl border border-line bg-white motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : (
        kpis.length > 0 && (
          <div
            className={`mb-3.5 grid grid-cols-2 gap-3.5 ${KPI_COLS[kpis.length] ?? 'lg:grid-cols-4'}`}
          >
            {kpis.map((k, i) => {
              const look = KPI_LOOK[k.key] ?? KPI_LOOK.today!;
              // A change pill only where there is a real comparison, a trend line only where there
              // is a real series: the money taken (day by day, against the 7 days before) and the
              // week's departures (day by day, from the Calendar's read).
              const delta = k.key === 'revenue' && data ? data.revenue['7d'].deltaPct : null;
              const spark =
                k.key === 'revenue' && data
                  ? data.revenue['7d'].points.map((p) => p.value)
                  : k.key === 'upcoming' && lines
                    ? departuresByDay(lines, today)
                    : null;
              return (
                <MetricCard
                  key={k.key}
                  index={i}
                  label={k.label}
                  value={k.value}
                  detail={delta !== null ? 'Against the 7 days before' : k.detail}
                  href={k.href}
                  icon={look.icon}
                  tone={look.tone}
                  delta={delta}
                  deltaAgainst="the 7 days before"
                  spark={spark}
                  className={
                    kpis.length % 2 === 1 && k === kpis[kpis.length - 1]
                      ? 'col-span-2 lg:col-span-1'
                      : ''
                  }
                />
              );
            })}
          </div>
        )
      )}

      {/* The day and the latest bookings on the left, what needs doing and the money on the right.
          The two columns run independently, so a short run sheet never leaves a hole beside a long
          "Needs you": the bookings table rises into the space. On a phone the order is run sheet,
          Needs you, Money in, latest bookings. */}
      {(runSheet || showRight || latestPanel) && (
        <div
          className={`mb-3.5 grid grid-cols-1 items-start gap-3.5 ${
            twoCols ? 'xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)] xl:grid-rows-[auto_1fr]' : ''
          }`}
        >
          {runSheet && <div className="min-w-0 xl:col-start-1 xl:row-start-1">{runSheet}</div>}
          {showRight && (
            <div
              className={`flex min-w-0 flex-col gap-3.5 ${twoCols ? 'xl:col-start-2 xl:row-span-2 xl:row-start-1' : ''}`}
            >
              {showNeeds && (
                <NeedsYouCard
                  needs={needs}
                  loading={needs === null}
                  showMoney={showMoney}
                  showBookings={showBookings}
                />
              )}
              {showMoney && data && <RevenueChart revenue={data.revenue} />}
            </div>
          )}
          {latestPanel}
        </div>
      )}
    </div>
  );
}
