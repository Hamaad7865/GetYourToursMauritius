/**
 * Read-only per-date payment schedule for the ADMIN drawer — an operational forecast, not just a list.
 * For each activity date it shows what is owed, what is already settled, and — crucially — WHEN the
 * automated reminder email fires and how much it will ask for, so the operator can see at a glance
 * "what do we charge this customer next, and when". A "Next reminder" headline pulls the soonest one out.
 *
 * `coveredEur` is a pure waterfall over the booking's balance, so "Paid" means settlement has reached
 * this installment's running total; the "next" one is the earliest not-yet-fully-covered row. The
 * reminder date mirrors the cron: api_enqueue_installment_reminders chases an installment once its date
 * is within `leadDays` (default 3) — so the guest is emailed ~3 days before each date.
 *
 * ADMIN-ONLY (imported solely by AdminBookings) — it exposes internal reminder timing, which the guest
 * booking page deliberately does not show. Renders nothing on an ordinary deposit booking (empty
 * schedule), so callers can drop it in unguarded.
 */

export interface ScheduleInstallment {
  seq: number;
  /** yyyy-mm-dd. */
  dueOn: string;
  label: string;
  amountEur: number;
  coveredEur: number;
}

/** The cron's default reminder lead — kept in step with api_enqueue_installment_reminders' `leadDays`. */
const REMINDER_LEAD_DAYS = 3;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** dd Mon — a compact date badge (the label already carries the full date). */
function dueBadge(dueOn: string): string {
  const d = new Date(`${dueOn}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dueOn
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/** The date the reminder fires — `days` before `dueOn`, formatted "1 Sep 2026". UTC math, so no drift. */
function reminderDate(dueOn: string, days: number): string {
  const ms = Date.parse(`${dueOn}T00:00:00Z`);
  if (Number.isNaN(ms)) return dueOn;
  const d = new Date(ms - days * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function PaymentSchedule({
  installments,
  className,
}: {
  installments: ScheduleInstallment[] | null | undefined;
  className?: string;
}) {
  if (!installments || installments.length === 0) return null;

  const total = round2(installments.reduce((s, i) => s + i.amountEur, 0));
  const settled = round2(installments.reduce((s, i) => s + Math.min(i.coveredEur, i.amountEur), 0));
  const remainingTotal = round2(Math.max(0, total - settled));
  // The NEXT payment: the earliest installment not yet fully covered. Null once everything is settled.
  const next = installments.find((i) => i.coveredEur < i.amountEur - 0.005) ?? null;
  const nextRemaining = next ? round2(next.amountEur - next.coveredEur) : 0;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
          Payment schedule
        </h3>
        <span className="text-[12px] font-semibold tabular-nums text-ink-muted">
          {eur(settled)} of {eur(total)} paid
        </span>
      </div>

      {next !== null ? (
        <div className="mt-2 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2.5">
          <div className="text-[11px] font-bold uppercase tracking-wide text-teal-dark">
            Next reminder
          </div>
          <div className="mt-0.5 text-[13px] leading-relaxed text-ink">
            We email the customer on{' '}
            <span className="font-semibold">{reminderDate(next.dueOn, REMINDER_LEAD_DAYS)}</span>{' '}
            asking for <span className="font-semibold tabular-nums">{eur(nextRemaining)}</span>
            <span className="text-ink-muted"> · {eur(remainingTotal)} left to collect</span>
          </div>
        </div>
      ) : (
        <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] font-semibold text-emerald-700">
          Fully paid — nothing left to collect.
        </p>
      )}

      <ul className="mt-2 flex flex-col gap-1.5">
        {installments.map((i) => {
          const paid = i.coveredEur >= i.amountEur - 0.005;
          const isNext = next !== null && i.seq === next.seq;
          const remaining = round2(i.amountEur - i.coveredEur);
          // A row partly covered by the deposit/earlier waterfall shows what is STILL owed, so the
          // operator reads "€72 due" on Christophe's 4 Sep, not the full €290 it costs.
          const partlyCovered = !paid && i.coveredEur > 0.005;
          return (
            <li
              key={i.seq}
              className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-[13px] ${
                isNext ? 'border-teal/40 bg-teal/5 ring-1 ring-teal/20' : 'border-ink/10'
              }`}
            >
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 shrink-0 rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink-muted">
                  {dueBadge(i.dueOn)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-ink">
                    {i.label}
                    {i.seq === 0 && <span className="text-ink-muted"> · deposit</span>}
                    {isNext && (
                      <span className="ml-1.5 rounded bg-teal/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-dark">
                        Next
                      </span>
                    )}
                  </span>
                  {/* When the automated chase for THIS date will fire. Paid rows need no reminder. */}
                  {!paid && (
                    <span className="mt-0.5 block text-[11px] text-ink-muted">
                      Reminder emails {reminderDate(i.dueOn, REMINDER_LEAD_DAYS)}
                    </span>
                  )}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <span className="font-semibold tabular-nums text-ink">{eur(i.amountEur)}</span>
                {paid ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Paid
                  </span>
                ) : (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${
                      isNext ? 'bg-teal text-white' : 'bg-ink/[0.06] text-ink-muted'
                    }`}
                  >
                    {partlyCovered ? `${eur(remaining)} due` : 'Due'}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
