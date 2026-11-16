'use client';

import Link from 'next/link';
import { useMemo, useState, type MouseEvent } from 'react';
import { sendInstallmentReminder } from '@/lib/admin/bookings';
import { sendBalanceLink } from '@/lib/admin/quotes';
import { euro } from '@/lib/admin/dashboard';
import {
  balanceWhatsAppText,
  whatsappHref,
  whatsappNumber,
} from '@/components/admin/quotes/whatsapp';
import {
  plural,
  sendList,
  sendQuestion,
  sendWhat,
  shortDay,
  type BalanceRow,
} from '@/components/admin/assistant/rules';
import type { RunRow } from '@/components/admin/today/rules';
import type { BalanceOutcome } from '@/components/admin/assistant/AssistantProvider';

/**
 * The chat's answer cards. Both are built from the back office's own reads, never from the model:
 * the balances are Today's balances and the departures are Today's run sheet.
 *
 * The balances card sends only what Today could already send, through the same two senders: the
 * per-date installment reminder and a quote's balance link. Nothing goes out until the operator
 * answers ONE confirmation that names every guest, address and what each will get; then the sends
 * run one after another, each row showing its own outcome. A row with no sender opens its booking.
 */

type RowState = { status: 'sending' } | { status: 'error'; text: string } | BalanceOutcome;

/**
 * A plain click on a card's link is handed to the panel (which opens the booking, quote or day
 * through context and closes the chat); a new-tab click stays an ordinary link.
 */
function openClick(
  e: MouseEvent<HTMLAnchorElement>,
  href: string,
  onOpen?: (href: string) => void,
) {
  if (!onOpen || e.defaultPrevented || e.button !== 0) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  onOpen(href);
}

function errText(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === 'string' && m) return m;
  }
  return fallback;
}

/** Rows shown before "Show all". */
const FIRST = 8;
/** The "Only over €100" chip. */
const OVER = 100;

function buttonLabel(rows: readonly BalanceRow[]): string {
  if (rows.length === 0) return 'Nothing ticked';
  const links = rows.filter((r) => r.action.kind === 'balance-link').length;
  if (links === rows.length) return `Send ${plural(rows.length, 'balance link')}`;
  if (links === 0) return `Send ${plural(rows.length, 'reminder')}`;
  return `Email ${plural(rows.length, 'guest')}`;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(url)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false));
      }}
      className="bmai-chip min-h-8 rounded-lg px-2.5 text-[12px] font-semibold"
    >
      {copied ? 'Copied' : 'Copy link'}
    </button>
  );
}

function LinkOutcome({ state }: { state: Extract<BalanceOutcome, { status: 'link' }> }) {
  const wa = whatsappNumber(state.quote.customerPhone);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[25px]">
      <p role="status" className="w-full text-[12px] text-[#9FD6D1]">
        {state.emailed === false
          ? `The link is ready but the email to ${state.quote.customerEmail} could not be sent. Copy it to the guest.`
          : `Emailed to ${state.quote.customerEmail}.`}
      </p>
      <CopyLink url={state.url} />
      {'digits' in wa && (
        <a
          href={whatsappHref(
            wa.digits,
            balanceWhatsAppText({
              customerName: state.quote.customerName,
              url: state.url,
              locale: state.quote.locale,
            }),
          )}
          target="_blank"
          rel="noopener noreferrer"
          className="bmai-chip inline-flex min-h-8 items-center rounded-lg px-2.5 text-[12px] font-semibold"
        >
          WhatsApp
        </a>
      )}
    </div>
  );
}

export function BalancesCard({
  rows,
  showMoney,
  sent: sentBefore,
  onSent,
  onOpen,
}: {
  rows: readonly BalanceRow[];
  showMoney: boolean;
  /**
   * What was already sent from this card, by booking id. It lives on the thread item, so a card
   * brought back from History shows those rows as sent and never offers to email them again.
   */
  sent?: Readonly<Record<string, BalanceOutcome>>;
  onSent?: (id: string, outcome: BalanceOutcome) => void;
  onOpen?: (href: string) => void;
}) {
  const [ticked, setTicked] = useState<Set<string>>(
    () => new Set(rows.filter((r) => r.sendable && !sentBefore?.[r.id]).map((r) => r.id)),
  );
  const [local, setLocal] = useState<Record<string, RowState>>({});
  const states = useMemo<Record<string, RowState>>(
    () => ({ ...sentBefore, ...local }),
    [sentBefore, local],
  );
  const [overOnly, setOverOnly] = useState(false);
  const [all, setAll] = useState(rows.length <= FIRST);
  const [running, setRunning] = useState(false);

  const set = (id: string, s: RowState) => setLocal((cur) => ({ ...cur, [id]: s }));
  const settle = (id: string, outcome: BalanceOutcome) => {
    set(id, outcome);
    onSent?.(id, outcome);
  };
  const sent = useMemo(
    () =>
      new Set(
        Object.entries(states)
          .filter(([, s]) => s.status === 'done' || s.status === 'link')
          .map(([id]) => id),
      ),
    [states],
  );

  const filtered = overOnly && showMoney ? rows.filter((r) => r.owedEur > OVER) : rows;
  const shown = all ? filtered : filtered.slice(0, FIRST);
  // Only what is on screen is sent: a filter or a folded list never sends a row you cannot see.
  const toSend = sendList(shown, ticked, sent);
  const hasOver =
    showMoney && rows.some((r) => r.owedEur > OVER) && rows.some((r) => r.owedEur <= OVER);

  function toggle(id: string) {
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function sendTicked() {
    const list = sendList(shown, ticked, sent);
    if (list.length === 0 || running) return;
    if (!window.confirm(sendQuestion(list, showMoney))) return;
    setRunning(true);
    // One after another: each row's outcome is its own, and a failure does not stop the rest.
    for (const row of list) {
      set(row.id, { status: 'sending' });
      try {
        if (row.action.kind === 'reminder') {
          const out = await sendInstallmentReminder(row.action.ref, row.action.seq);
          if (out.emailed)
            settle(row.id, { status: 'done', text: `Reminder sent to ${out.recipient}.` });
          else set(row.id, { status: 'error', text: 'The reminder could not be sent. Try again.' });
        } else if (row.action.kind === 'balance-link') {
          const quote = row.action.quote;
          const out = await sendBalanceLink(quote.ref);
          settle(row.id, { status: 'link', quote, url: out.url, emailed: out.emailed });
        }
      } catch (err) {
        set(row.id, { status: 'error', text: errText(err, 'That could not be sent. Try again.') });
      }
    }
    setRunning(false);
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111F22]">
        {hasOver && (
          <div className="flex items-center gap-2 border-b border-white/[0.05] px-3.5 py-2">
            <button
              type="button"
              aria-pressed={overOnly}
              onClick={() => setOverOnly((v) => !v)}
              className={`bmai-chip min-h-7 rounded-full px-2.5 text-[11.5px] font-semibold ${
                overOnly ? 'bmai-chip-on' : ''
              }`}
            >
              Only over {euro(OVER)}
            </button>
          </div>
        )}
        <ul>
          {shown.map((row) => {
            const st = states[row.id];
            const done = st?.status === 'done' || st?.status === 'link';
            const id = `bmai-bal-${row.id}`;
            return (
              <li
                key={row.id}
                className="border-b border-white/[0.05] px-3.5 py-2.5 last:border-b-0"
              >
                <div className="flex items-center gap-2.5">
                  {row.sendable && !done ? (
                    <input
                      id={id}
                      type="checkbox"
                      checked={ticked.has(row.id)}
                      onChange={() => toggle(row.id)}
                      disabled={running}
                      className="h-[15px] w-[15px] shrink-0 accent-[#F4B860]"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full ${
                        done ? 'bg-[#3FB5AC] text-[#06181A]' : 'border border-white/15'
                      }`}
                    >
                      {done && (
                        <svg
                          width={9}
                          height={9}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={4}
                        >
                          <path d="M20 6L9 17l-5-5" />
                        </svg>
                      )}
                    </span>
                  )}
                  <label
                    htmlFor={row.sendable && !done ? id : undefined}
                    className="min-w-0 flex-1 cursor-pointer"
                  >
                    <span className="block truncate text-[13px] font-medium text-white">
                      {row.name}
                    </span>
                    <span className="block truncate text-[12px] text-[#8FA5A3]">
                      {row.tripDay ? `Trip ${shortDay(row.tripDay)}` : 'No trip date'}
                      {row.sendable ? ` · ${sendWhat(row)}` : ''}
                    </span>
                  </label>
                  {showMoney && (
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-white">
                      {euro(row.owedEur)}
                    </span>
                  )}
                  {!row.sendable && row.action.kind === 'link' && (
                    <Link
                      href={row.action.href}
                      onClick={(e) =>
                        row.action.kind === 'link' && openClick(e, row.action.href, onOpen)
                      }
                      className="bmai-chip inline-flex min-h-8 shrink-0 items-center rounded-lg px-2.5 text-[12px] font-semibold"
                      aria-label={`Open ${row.name}’s booking`}
                    >
                      Open
                    </Link>
                  )}
                </div>
                {st?.status === 'sending' && (
                  <p role="status" className="mt-1 pl-[25px] text-[12px] text-[#8FA5A3]">
                    Sending…
                  </p>
                )}
                {st?.status === 'done' && (
                  <p
                    role="status"
                    className="mt-1 pl-[25px] text-[12px] font-semibold text-[#7FD3CB]"
                  >
                    {st.text}
                  </p>
                )}
                {st?.status === 'error' && (
                  <p role="alert" className="mt-1 pl-[25px] text-[12px] text-[#FF9C8A]">
                    {st.text}
                  </p>
                )}
                {st?.status === 'link' && <LinkOutcome state={st} />}
              </li>
            );
          })}
        </ul>
        {!all && filtered.length > FIRST && (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="w-full border-t border-white/[0.05] px-3.5 py-2 text-left text-[12px] font-semibold text-[#7FD3CB] hover:text-white"
          >
            Show all {filtered.length}
          </button>
        )}
        {rows.some((r) => r.sendable) && (
          <div className="p-3">
            <button
              type="button"
              onClick={() => void sendTicked()}
              disabled={running || toSend.length === 0}
              className="bmai-send-btn min-h-10 w-full rounded-[10px] px-3 text-[13px] font-semibold disabled:opacity-50"
            >
              {running ? 'Sending…' : buttonLabel(toSend)}
            </button>
          </div>
        )}
      </div>
      {rows.some((r) => r.sendable) && (
        <p className="text-[12px] text-[#8FA5A3]">Nothing is sent until you confirm.</p>
      )}
    </div>
  );
}

/** Today's departures, each opening its line on the calendar. */
export function DeparturesCard({
  rows,
  onOpen,
}: {
  rows: readonly RunRow[];
  onOpen?: (href: string) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <ul className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111F22]">
      {rows.map((r) => {
        const href = `/admin/calendar?day=${r.day}&line=${encodeURIComponent(r.key)}`;
        return (
          <li key={r.key} className="border-b border-white/[0.05] last:border-b-0">
            <Link
              href={href}
              onClick={(e) => openClick(e, href, onOpen)}
              className="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-white/[0.04]"
            >
              <span className="w-12 shrink-0 text-[12.5px] font-semibold tabular-nums text-[#F4B860]">
                {r.allDay ? 'All day' : (r.time ?? 'TBC')}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-white">{r.title}</span>
                <span className="block truncate text-[12px] text-[#8FA5A3]">
                  {plural(r.guests, 'guest')}
                  {r.pickups ? ` · ${plural(r.pickups, 'pickup')}` : ''}
                  {r.pendingGuests ? ` · +${r.pendingGuests} unpaid` : ''}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
