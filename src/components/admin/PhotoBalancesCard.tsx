'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  loadPhotoBalances,
  requestPhotoBalance,
  type PhotoBalanceRow,
} from '@/lib/admin/photography';
import { AdminError, Card } from '@/components/admin/ui';

function eur(n: number): string {
  return `€${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Photography bookings that paid their 50% deposit and still owe the other half. When the photos are
 * delivered, "Request balance" emails the guest a link to their booking page, where they pay the rest
 * by card. Paid balances drop off the list on the next load.
 */
export function PhotoBalancesCard() {
  const [rows, setRows] = useState<PhotoBalanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, { url: string; emailed: boolean }>>({});

  const load = useCallback(async () => {
    try {
      setRows(await loadPhotoBalances());
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Could not load balances.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function request(ref: string) {
    setBusyRef(ref);
    setError(null);
    try {
      const result = await requestPhotoBalance(ref);
      setSent((cur) => ({ ...cur, [ref]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request the balance.');
    } finally {
      setBusyRef(null);
    }
  }

  return (
    <Card title="Balances to collect" className="mb-5">
      <p className="mb-3 text-[13px] text-ink-muted">
        Photography is paid in two halves: 50% to book (non-refundable), the rest when the photos
        are delivered. When a gallery is ready, press <b>Request balance</b> — the guest gets an
        email with a link to pay the rest by card.
      </p>
      {error && <AdminError>{error}</AdminError>}
      {rows === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-muted">No balances to collect right now.</p>
      ) : (
        <ul className="divide-y divide-[#F2F4F6]">
          {rows.map((r) => {
            const done = sent[r.ref];
            return (
              <li key={r.ref} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-ink">
                    {r.customerName} · {r.packageTitle}
                  </p>
                  <p className="text-[12.5px] text-ink-muted">
                    {r.ref}
                    {r.shootDate
                      ? ` · shoot ${new Date(r.shootDate).toLocaleDateString('en-GB', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'Indian/Mauritius',
                        })}`
                      : ''}{' '}
                    · paid {eur(r.depositEur)} of {eur(r.totalEur)}
                  </p>
                  {done && (
                    <p className="mt-0.5 text-[12px] font-semibold text-teal-dark">
                      {done.emailed
                        ? `Emailed to ${r.customerEmail}.`
                        : `Email not sent — share this link with the guest: ${done.url}`}
                    </p>
                  )}
                </div>
                <span className="text-[14px] font-extrabold text-ink">{eur(r.balanceDueEur)}</span>
                <button
                  type="button"
                  disabled={busyRef === r.ref}
                  onClick={() => void request(r.ref)}
                  className="rounded-lg bg-teal px-3 py-1.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-50"
                >
                  {busyRef === r.ref ? 'Sending…' : done ? 'Send again' : 'Request balance'}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
