/**
 * Read-only display of a per-date payment schedule — one row per activity date, each showing what is
 * due and what is covered. Shared by the guest booking page and the admin drawer so both read the same
 * `installments[]` (from booking_json) the same way. `coveredEur` is a pure waterfall over the booking's
 * balance, so "Paid" here means settlement has reached this installment's running total.
 *
 * Renders nothing on an ordinary deposit booking (empty schedule), so callers can drop it in unguarded.
 */

export interface ScheduleInstallment {
  seq: number;
  /** yyyy-mm-dd. */
  dueOn: string;
  label: string;
  amountEur: number;
  coveredEur: number;
}

function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}

/** dd Mon — a compact date for the row (the label already carries the full date, this is the badge). */
function dueBadge(dueOn: string): string {
  const d = new Date(`${dueOn}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dueOn
    : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

export function PaymentSchedule({
  installments,
  className,
}: {
  installments: ScheduleInstallment[] | null | undefined;
  className?: string;
}) {
  if (!installments || installments.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
        Payment schedule
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {installments.map((i) => {
          // Small tolerance for float display: covered is derived from minor units server-side.
          const paid = i.coveredEur >= i.amountEur - 0.005;
          const partial = !paid && i.coveredEur > 0.005;
          return (
            <li
              key={i.seq}
              className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 px-3 py-2 text-[13px]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded-md bg-ink/[0.05] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-ink-muted">
                  {dueBadge(i.dueOn)}
                </span>
                <span className="truncate text-ink">
                  {i.label}
                  {i.seq === 0 && <span className="text-ink-muted"> · deposit</span>}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2.5">
                <span className="font-semibold tabular-nums text-ink">{eur(i.amountEur)}</span>
                {paid ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Paid
                  </span>
                ) : partial ? (
                  <span className="rounded-full bg-gold-light/15 px-2 py-0.5 text-[11px] font-bold text-gold">
                    {eur(i.coveredEur)} paid
                  </span>
                ) : (
                  <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                    Due
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
