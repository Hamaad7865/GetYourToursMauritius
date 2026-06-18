import { loadBookings, type BookingRow, type BookingStatus, type PaymentState } from './bookings';

/* Admin dashboard view-model. All figures are DERIVED from the bookings the admin can already
 * read (loadBookings) — no extra queries — and computed in a pure function so they're unit-testable
 * and timezone-correct (Mauritius local day, GMT+4). */

export interface DashStat {
  key: string;
  label: string;
  value: string;
  /** Small contextual label under the value (e.g. "4 open", "next 7 days"). Honest context, not a fabricated %. */
  hint: string;
  tone: 'teal' | 'green' | 'amber' | 'ink';
}

export interface DepartureRow {
  id: string;
  ref: string;
  time: string; // "08:00"
  tour: string;
  guests: number;
  pickup: string | null;
  status: BookingStatus;
}

export interface RecentRow {
  id: string;
  ref: string;
  customer: string;
  tour: string;
  totalEur: number;
  source: string;
  status: BookingStatus;
  paymentState: PaymentState;
}

export interface PendingRow {
  id: string;
  ref: string;
  customer: string;
  totalEur: number;
}

export interface SparkPoint {
  day: string; // "Mon"
  value: number; // revenue that day, EUR
}

export interface DashboardData {
  greetingPart: 'morning' | 'afternoon' | 'evening';
  todayLabel: string; // "Saturday, 18 July 2026"
  departuresToday: number;
  upcoming7: number;
  revenueWeekEur: number;
  pendingTotalEur: number;
  pendingCount: number;
  stats: DashStat[];
  departures: DepartureRow[];
  recent: RecentRow[];
  pending: PendingRow[];
  spark: SparkPoint[];
}

const TZ = 'Indian/Mauritius';
const NOT_ACTIVE = new Set<BookingStatus>(['cancelled', 'expired', 'failed', 'refunded', 'refund_pending']);

/** YYYY-MM-DD for an instant, in Mauritius local time. */
function mauDay(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}
/** HH:MM for an instant, in Mauritius local time. */
function mauTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
}
function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function euro(n: number): string {
  return `€${Math.round(n).toLocaleString('en-US')}`;
}

/** Pure: turn the booking list into the dashboard view-model as of `now`. */
export function computeDashboard(bookings: BookingRow[], now: Date): DashboardData {
  const today = mauDay(now);
  const hour = Number(now.toLocaleString('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }));
  const greetingPart = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const todayLabel = now.toLocaleDateString('en-GB', {
    timeZone: TZ,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const weekStart = addDays(today, -6);

  // Today's departures (active bookings whose trip is today), earliest first.
  const departures: DepartureRow[] = bookings
    .filter((b) => b.startsAt && mauDay(b.startsAt) === today && !NOT_ACTIVE.has(b.status))
    .sort((a, b) => (a.startsAt! < b.startsAt! ? -1 : 1))
    .map((b) => ({
      id: b.id,
      ref: b.ref,
      time: mauTime(b.startsAt!),
      tour: b.activityTitle,
      guests: b.guests,
      pickup: b.pickupLocation,
      status: b.status,
    }));

  const upcoming7 = bookings.filter((b) => {
    if (!b.startsAt || NOT_ACTIVE.has(b.status)) return false;
    const d = mauDay(b.startsAt);
    return d >= today && d <= addDays(today, 6);
  }).length;

  // Recent bookings (loadBookings is already newest-first).
  const recent: RecentRow[] = bookings.slice(0, 6).map((b) => ({
    id: b.id,
    ref: b.ref,
    customer: b.customerName,
    tour: b.activityTitle,
    totalEur: b.totalEur,
    source: b.source,
    status: b.status,
    paymentState: b.paymentState,
  }));

  // Needs attention: payment still pending.
  const pendingAll = bookings.filter((b) => b.paymentState === 'pending' && !NOT_ACTIVE.has(b.status));
  const pendingTotalEur = pendingAll.reduce((s, b) => s + b.totalEur, 0);
  const pending: PendingRow[] = pendingAll.slice(0, 4).map((b) => ({
    id: b.id,
    ref: b.ref,
    customer: b.customerName,
    totalEur: b.totalEur,
  }));

  // Revenue = net cash retained (Σ paid − refunded) on bookings created in the last 7 Mauritius days.
  const revByDay = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) revByDay.set(addDays(weekStart, i), 0);
  let revenueWeekEur = 0;
  for (const b of bookings) {
    const d = mauDay(b.createdAt);
    if (d >= weekStart && d <= today && b.netPaidEur > 0) {
      revByDay.set(d, (revByDay.get(d) ?? 0) + b.netPaidEur);
      revenueWeekEur += b.netPaidEur;
    }
  }
  const spark: SparkPoint[] = [...revByDay.entries()].map(([day, value]) => ({
    day: new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short' }),
    value,
  }));

  const stats: DashStat[] = [
    { key: 'today', label: 'Departures today', value: String(departures.length), hint: today === mauDay(now) ? 'scheduled' : '', tone: 'teal' },
    { key: 'revenue', label: 'Revenue this week', value: euro(revenueWeekEur), hint: 'last 7 days', tone: 'green' },
    { key: 'pending', label: 'Pending payments', value: euro(pendingTotalEur), hint: `${pendingAll.length} open`, tone: 'amber' },
    { key: 'upcoming', label: 'Upcoming departures', value: String(upcoming7), hint: 'next 7 days', tone: 'ink' },
  ];

  return {
    greetingPart,
    todayLabel,
    departuresToday: departures.length,
    upcoming7,
    revenueWeekEur,
    pendingTotalEur,
    pendingCount: pendingAll.length,
    stats,
    departures,
    recent,
    pending,
    spark,
  };
}

/** Load bookings and compute the dashboard. */
export async function loadDashboard(now: Date = new Date()): Promise<DashboardData> {
  const bookings = await loadBookings(300);
  return computeDashboard(bookings, now);
}

/** Stable initials + a deterministic colour for an avatar chip. */
export function avatar(name: string): { initials: string; hue: number } {
  const parts = name.trim().split(/\s+/);
  const initials = ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = name.charCodeAt(i) + ((h << 5) - h);
  return { initials, hue: Math.abs(h) % 360 };
}
