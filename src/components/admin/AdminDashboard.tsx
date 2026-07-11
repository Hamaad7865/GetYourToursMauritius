'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadDashboard,
  euro,
  avatar,
  type DashboardData,
  type DashStat,
} from '@/lib/admin/dashboard';
import type { BookingStatus } from '@/lib/admin/bookings';
import {
  IconBookings,
  IconWallet,
  IconClock,
  IconUsers,
  IconPin,
  IconChevron,
  IconTrendUp,
} from '@/components/ui/icons';

const STAT_ICON = {
  today: IconBookings,
  revenue: IconWallet,
  pending: IconClock,
  upcoming: IconPin,
} as const;

const STAT_TONE: Record<DashStat['tone'], string> = {
  teal: 'bg-teal/10 text-teal',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  ink: 'bg-ink/[0.06] text-ink',
};

function statusPill(status: BookingStatus): { label: string; cls: string; dot: string } {
  switch (status) {
    case 'confirmed':
    case 'completed':
      return {
        label: status === 'completed' ? 'Completed' : 'Confirmed',
        cls: 'bg-emerald-50 text-emerald-700',
        dot: 'bg-emerald-500',
      };
    case 'cancelled':
    case 'expired':
    case 'failed':
      return { label: 'Cancelled', cls: 'bg-red-50 text-red-700', dot: 'bg-red-500' };
    case 'refunded':
    case 'refund_pending':
      return { label: 'Refunded', cls: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
    default:
      return { label: 'Pending', cls: 'bg-teal/10 text-teal-dark', dot: 'bg-teal' };
  }
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

function Sparkline({ data }: { data: number[] }) {
  const w = 240;
  const h = 64;
  const pad = 4;
  const max = Math.max(1, ...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const xs = (i: number) => pad + i * ((w - pad * 2) / Math.max(1, data.length - 1));
  const ys = (v: number) => h - 4 - ((v - min) / span) * (h - 14);
  const pts = data.map((v, i) => [xs(i), ys(v)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const area = `${line} L${xs(data.length - 1).toFixed(1)} ${h} L${xs(0).toFixed(1)} ${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg
      width="100%"
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block overflow-visible"
    >
      <defs>
        <linearGradient id="spk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgb(var(--color-teal))" stopOpacity={0.22} />
          <stop offset="100%" stopColor="rgb(var(--color-teal))" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spk)" />
      <path
        d={line}
        fill="none"
        stroke="rgb(var(--color-teal))"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={4}
          fill="rgb(var(--color-teal))"
          stroke="#fff"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-[#EAEEF0] bg-white ${className}`}>
      {children}
    </section>
  );
}

export function AdminDashboard() {
  const { profile } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDashboard()
      .then((d) => active && setData(d))
      .catch(
        (e) => active && setError(e instanceof Error ? e.message : 'Could not load the dashboard.'),
      );
    return () => {
      active = false;
    };
  }, []);

  const firstName = (profile?.fullName || 'there').split(' ')[0];
  const sparkData = useMemo(() => data?.spark.map((s) => s.value) ?? [], [data]);

  if (error) {
    return (
      <p className="rounded-2xl border border-coral/30 bg-coral/5 p-4 text-sm font-medium text-coral">
        {error}
      </p>
    );
  }
  if (!data) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[116px] animate-pulse rounded-2xl border border-[#EAEEF0] bg-white"
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* Heading */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-medium tracking-tight text-ink">
            Good {data.greetingPart}, {firstName}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {data.todayLabel} · Belle Mare · {data.departuresToday} departures today
          </p>
        </div>
        <Link
          href="/admin/bookings"
          className="flex items-center gap-1.5 rounded-xl border border-[#E2E7EA] bg-white px-3.5 py-2.5 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal"
        >
          View all bookings <IconChevron width={15} height={15} className="-rotate-90" />
        </Link>
      </div>

      {/* Stat cards */}
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {data.stats.map((s) => {
          const Icon = STAT_ICON[s.key as keyof typeof STAT_ICON] ?? IconBookings;
          return (
            <div
              key={s.key}
              className="rounded-2xl border border-[#EAEEF0] bg-white p-[18px] shadow-[0_1px_2px_rgba(10,46,54,.04)]"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${STAT_TONE[s.tone]}`}
                >
                  <Icon width={19} height={19} />
                </span>
                {s.hint && (
                  <span className="text-[12px] font-semibold text-ink-muted">{s.hint}</span>
                )}
              </div>
              <div className="mt-3.5 text-[28px] font-extrabold leading-none tracking-tight text-ink">
                {s.value}
              </div>
              <div className="mt-1.5 text-[13px] font-medium text-ink-muted">{s.label}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 items-start gap-[18px] xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* ===== LEFT ===== */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Today's departures */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#EEF1F3] px-[18px] py-4">
              <h2 className="flex items-center gap-2.5 text-[15px] font-extrabold text-ink">
                <IconClock width={17} height={17} className="text-teal" /> Today&apos;s departures
              </h2>
              <span className="text-[12.5px] text-ink-muted">
                {data.departures.length} scheduled
              </span>
            </div>
            {data.departures.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-sm text-ink-muted">
                No departures today. Enjoy the calm.
              </div>
            ) : (
              data.departures.map((d) => {
                const pill = statusPill(d.status);
                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3.5 border-b border-[#F4F6F7] px-[18px] py-3.5 last:border-b-0"
                  >
                    <div className="w-12 shrink-0 text-center">
                      <div className="text-[15px] font-extrabold tracking-tight text-ink">
                        {d.time}
                      </div>
                    </div>
                    <div className="h-9 w-px self-stretch bg-[#EEF1F3]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-ink">{d.tour}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <IconUsers width={13} height={13} /> {d.guests}
                        </span>
                        {d.pickup && (
                          <>
                            <span className="h-1 w-1 rounded-full bg-[#cdd6d8]" />
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <IconPin width={13} height={13} className="shrink-0" />
                              <span className="truncate">{d.pickup}</span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${pill.cls}`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                      {pill.label}
                    </span>
                  </div>
                );
              })
            )}
          </Card>

          {/* Recent bookings */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#EEF1F3] px-[18px] py-4">
              <h2 className="text-[15px] font-extrabold text-ink">Recent bookings</h2>
              <Link
                href="/admin/bookings"
                className="text-[12.5px] font-bold text-teal hover:text-teal-dark"
              >
                See all
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse">
                <thead>
                  <tr className="bg-[#FAFBFC] text-left text-[11px] font-bold uppercase tracking-wide text-ink-muted">
                    <th className="px-[18px] py-2.5">Customer</th>
                    <th className="px-3 py-2.5">Tour</th>
                    <th className="px-3 py-2.5">Total</th>
                    <th className="px-[18px] py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((r) => {
                    const pill = statusPill(r.status);
                    return (
                      <tr key={r.id} className="border-t border-[#F2F4F6] hover:bg-[#FAFBFC]">
                        <td className="px-[18px] py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={r.customer} />
                            <span className="min-w-0">
                              <span className="block whitespace-nowrap text-[13.5px] font-bold text-ink">
                                {r.customer}
                              </span>
                              <span className="block text-[11.5px] capitalize text-ink-muted">
                                {r.source}
                              </span>
                            </span>
                          </div>
                        </td>
                        <td className="max-w-[170px] px-3 py-3 text-[13px] text-ink/70">
                          <span className="block truncate">{r.tour}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-[13.5px] font-bold text-ink">
                          {euro(r.totalEur)}
                        </td>
                        <td className="px-[18px] py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold ${pill.cls}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
                            {pill.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {data.recent.length === 0 && (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-[18px] py-10 text-center text-sm text-ink-muted"
                      >
                        No bookings yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* ===== RIGHT ===== */}
        <div className="flex min-w-0 flex-col gap-[18px]">
          {/* Revenue */}
          <Card className="p-[18px]">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[15px] font-extrabold text-ink">Revenue</h2>
                <p className="mt-0.5 text-[12.5px] text-ink-muted">Last 7 days</p>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[12px] font-bold text-emerald-700">
                <IconTrendUp width={14} height={14} /> 7d
              </span>
            </div>
            <div className="mt-3 text-[30px] font-extrabold leading-none tracking-tight text-ink">
              {euro(data.revenueWeekEur)}
            </div>
            <div className="mt-3.5">
              <Sparkline data={sparkData} />
            </div>
            <div className="mt-2 flex justify-between">
              {data.spark.map((s, i) => (
                <span key={i} className="text-[10.5px] font-semibold text-ink-muted/70">
                  {s.day}
                </span>
              ))}
            </div>
          </Card>

          {/* Needs attention */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#EEF1F3] px-[18px] py-4">
              <h2 className="text-[15px] font-extrabold text-ink">Needs attention</h2>
              <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-[11.5px] font-bold text-amber-700">
                {data.pendingCount} pending
              </span>
            </div>
            {data.pending.length === 0 ? (
              <div className="px-[18px] py-10 text-center text-sm text-ink-muted">
                No pending payments. All settled.
              </div>
            ) : (
              data.pending.map((p) => (
                <Link
                  key={p.id}
                  href="/admin/bookings"
                  className="flex items-center gap-3 border-b border-[#F4F6F7] px-[18px] py-3.5 last:border-b-0 hover:bg-[#FAFBFC]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                    <IconWallet width={17} height={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-bold text-ink">{p.customer}</div>
                    <div className="mt-0.5 text-[12px] text-ink-muted">
                      {p.ref} · payment pending
                    </div>
                  </div>
                  <span className="text-sm font-extrabold text-ink">{euro(p.totalEur)}</span>
                </Link>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
