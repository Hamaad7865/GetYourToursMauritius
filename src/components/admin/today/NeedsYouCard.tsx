'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { TODAY_LIFT } from '@/components/admin/today/MetricCard';
import { Panel, buttonClass } from '@/components/admin/ui';
import { FreshLink } from '@/components/admin/quotes/FreshLink';
import { balanceWhatsAppText } from '@/components/admin/quotes/whatsapp';
import { IconCheck, IconMail, IconTag, IconWallet, IconClock } from '@/components/ui/icons';
import { sendInstallmentReminder } from '@/lib/admin/bookings';
import { sendBalanceLink, type QuoteRow } from '@/lib/admin/quotes';
import { euro } from '@/lib/admin/dashboard';
import type { NeedRow, NeedsYou } from '@/components/admin/today/rules';
import { balanceLinkQuestion } from '@/components/admin/quotes/worklist';

type SendState =
  | { status: 'sending' }
  | { status: 'done'; text: string }
  | { status: 'error'; text: string }
  | { status: 'link'; quote: QuoteRow; url: string; emailed: boolean | undefined };

function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

const GROUP_ICON = {
  balance: { Icon: IconWallet, cls: 'bg-gold-tint text-gold-dark' },
  awaiting: { Icon: IconClock, cls: 'bg-gold-tint text-gold-dark' },
  quotes: { Icon: IconTag, cls: 'bg-blue-tint text-blue-dark' },
  leads: { Icon: IconMail, cls: 'bg-teal-tint text-teal-dark' },
} as const;

/**
 * "Needs you": what the owner has to act on, each row naming the guest, the problem and ONE action.
 * Sends happen only where an existing sender covers exactly that case — the per-date installment
 * reminder, or a quote-born balance link — with the same confirmation the Quotes screen asks for.
 * Everything else opens the booking, the quotes or the enquiries.
 */
export function NeedsYouCard({
  needs,
  loading,
  showMoney,
  showBookings,
}: {
  needs: NeedsYou | null;
  loading: boolean;
  showMoney: boolean;
  showBookings: boolean;
}) {
  const [sends, setSends] = useState<Record<string, SendState>>({});
  const set = (key: string, s: SendState) => setSends((all) => ({ ...all, [key]: s }));

  async function remind(row: NeedRow, ref: string, seq: number) {
    set(row.key, { status: 'sending' });
    try {
      const out = await sendInstallmentReminder(ref, seq);
      set(
        row.key,
        out.emailed
          ? { status: 'done', text: `Reminder sent to ${out.recipient}.` }
          : { status: 'error', text: 'The reminder could not be sent. Try again.' },
      );
    } catch (err) {
      set(row.key, { status: 'error', text: errText(err, 'The reminder could not be sent.') });
    }
  }

  async function balanceLink(row: NeedRow, quote: QuoteRow) {
    // The Quotes screen's own question, word for word.
    if (!window.confirm(balanceLinkQuestion(quote.ref, quote.customerEmail))) {
      return;
    }
    set(row.key, { status: 'sending' });
    try {
      const out = await sendBalanceLink(quote.ref);
      set(row.key, { status: 'link', quote, url: out.url, emailed: out.emailed });
    } catch (err) {
      set(row.key, { status: 'error', text: errText(err, 'Could not create the balance link.') });
    }
  }

  const header =
    needs && showBookings && needs.balances.count > 0
      ? showMoney
        ? `${euro(needs.balances.owedEur)} to collect`
        : `${needs.balances.count} open`
      : null;

  return (
    <Panel
      title="Needs you"
      className={TODAY_LIFT}
      style={{ '--i': 6 } as CSSProperties}
      meta={needs ? [String(needs.total), header].filter(Boolean).join(' · ') : undefined}
    >
      {loading && !needs && <p className="px-4 py-6 text-center text-ink-soft">Loading…</p>}
      {needs && needs.rows.length === 0 && (
        <p className="flex items-center gap-2.5 px-4 py-3.5 text-ink-muted">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-teal-tint text-teal-dark"
          >
            <IconCheck width={16} height={16} />
          </span>
          Nothing needs you right now. No payments waiting and no balances to collect.
        </p>
      )}
      {needs && needs.rows.length > 0 && (
        <ul>
          {needs.rows.map((row) => {
            const { Icon, cls } = GROUP_ICON[row.group];
            const st = sends[row.key];
            const a = row.action;
            return (
              <li
                key={row.key}
                className="border-b border-line-soft px-4 py-[11px] last:border-b-0"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cls}`}
                  >
                    <Icon width={15} height={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold text-ink">{row.title}</span>
                    <span className="block truncate text-[12px] text-ink-soft">{row.meta}</span>
                  </span>
                  {a.kind === 'link' && (
                    <Link
                      href={a.href}
                      className={buttonClass('ghost', 'sm')}
                      aria-label={`${a.label}: ${row.meta}`}
                    >
                      {a.label}
                    </Link>
                  )}
                  {a.kind === 'reminder' && st?.status !== 'done' && (
                    <button
                      type="button"
                      disabled={st?.status === 'sending'}
                      onClick={() => void remind(row, a.ref, a.seq)}
                      className={buttonClass('ghost', 'sm')}
                      title={`Emails the reminder for ${a.label}`}
                    >
                      {st?.status === 'sending'
                        ? 'Sending…'
                        : st?.status === 'error'
                          ? 'Try again'
                          : 'Send reminder'}
                    </button>
                  )}
                  {a.kind === 'balance-link' && st?.status !== 'link' && (
                    <button
                      type="button"
                      disabled={st?.status === 'sending'}
                      onClick={() => void balanceLink(row, a.quote)}
                      className={buttonClass('ghost', 'sm')}
                    >
                      {st?.status === 'sending' ? 'Sending…' : 'Send balance link'}
                    </button>
                  )}
                </div>
                {st?.status === 'done' && (
                  <p
                    role="status"
                    className="mt-1.5 pl-11 text-[12px] font-semibold text-teal-dark"
                  >
                    {st.text}
                  </p>
                )}
                {st?.status === 'error' && (
                  <p role="alert" className="mt-1.5 pl-11 text-[12px] text-coral-dark">
                    {st.text}
                  </p>
                )}
                {st?.status === 'link' && (
                  <div className="mt-2.5 pl-11">
                    <p role="status" className="mb-2 text-[12.5px] text-ink">
                      {st.emailed === false
                        ? `The link is ready but the email to ${st.quote.customerEmail} could not be sent — copy it to the guest.`
                        : `Emailed to ${st.quote.customerEmail}.`}
                    </p>
                    <FreshLink
                      url={st.url}
                      heading="The balance link"
                      inputLabel="Balance payment link"
                      phone={st.quote.customerPhone}
                      message={balanceWhatsAppText({
                        customerName: st.quote.customerName,
                        url: st.url,
                        locale: st.quote.locale,
                      })}
                      note="It opens a fresh checkout each time, for as long as the balance is owed."
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {needs && (needs.more.length > 0 || needs.notes.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft px-4 py-2.5 text-[12px]">
          {needs.more.map((m) => (
            <Link
              key={m.href}
              href={m.href}
              className="font-semibold text-teal-dark hover:underline"
            >
              {m.label}
            </Link>
          ))}
          {needs.notes.map((n) => (
            <span key={n} className="text-coral-dark">
              {n}
            </span>
          ))}
        </div>
      )}
    </Panel>
  );
}
