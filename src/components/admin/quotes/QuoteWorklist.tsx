'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminError,
  AdminHeading,
  BTN_PRIMARY,
  DataTable,
  INPUT_CLS,
  Kpi,
  Panel,
  PANEL_BODY,
  ProgressBar,
  StatusChip,
  Td,
  Th,
  buttonClass,
} from '@/components/admin/ui';
import { IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { fmtDate, fmtDateShort } from '@/lib/admin/format';
import { quoteTodayUtc } from '@/lib/quotes/validity';
import {
  duplicateQuote,
  loadQuoteLineBriefs,
  loadQuotes,
  sendBalanceLink,
  sendQuote,
  type QuoteRow,
} from '@/lib/admin/quotes';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';
import { FreshLink } from '@/components/admin/quotes/FreshLink';
import { eurFromMinor, refusalMessage } from '@/components/admin/quotes/state';
import {
  balanceWhatsAppText,
  quoteWhatsAppText,
  whatsappNumber,
} from '@/components/admin/quotes/whatsapp';
import {
  WORK_GROUPS,
  groupQuotes,
  guestInitials,
  lineSummaries,
  matchesQuoteSearch,
  quoteStage,
  rowActions,
  worklistTotals,
  type LineSummary,
  type QuoteStage,
  type QuoteWorkGroup,
} from '@/components/admin/quotes/worklist';

/**
 * /admin/quotes — the worklist. Quotes grouped by what the owner does next: waiting for the guest,
 * a balance to collect, drafts to finish, expired without paying, and done. The rules are pure and
 * tested (`worklist.ts`); this file only draws them and wires the row actions.
 *
 * ── SENDING FROM A ROW MINTS A NEW LINK ────────────────────────────────────────────────────────
 * "Send again" goes through the same route as the editor's Send: it emails the stored quote with a
 * NEW link, and the link the guest already holds stops working. The confirm says so. "WhatsApp" is
 * the same send, followed by a wa.me link carrying that new link — there is no WhatsApp sending of
 * our own, and no link to share without sending, because the raw token exists only in the response.
 *
 * ── THE BALANCE LINK ───────────────────────────────────────────────────────────────────────────
 * Offered only where `quoteStage` finds a paid deposit booking with a balance genuinely owed
 * (`balanceIsOutstanding`). It emails a balance payment link; a balance link sent earlier stops
 * working, and the guest's original quote link is left alone.
 */

const DONE_PAGE = 25;

type Sent = {
  kind: 'quote' | 'balance';
  row: QuoteRow;
  url: string;
  /** Balance links only: false when the email failed and the link must be copied by hand. */
  emailed?: boolean;
};

export function QuoteWorklist({
  onOpen,
  onNew,
}: {
  onOpen: (id: string) => void;
  /** A new quote; `ai` opens it with the enquiry drafter showing. */
  onNew: (ai: boolean) => void;
}) {
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [summaries, setSummaries] = useState<Map<string, LineSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [allDone, setAllDone] = useState(false);

  const load = useCallback(async () => {
    const [quotes, briefs] = await Promise.all([
      loadQuotes(),
      // The "what" column is a nicety: without it the row shows the guest's email instead.
      loadQuoteLineBriefs().catch(() => null),
    ]);
    setRows(quotes);
    if (briefs) setSummaries(lineSummaries(briefs));
  }, []);

  useEffect(() => {
    load().catch((err: unknown) => {
      setRows([]);
      setError(refusalMessage(err, 'Could not load the quotes.'));
    });
  }, [load]);

  const today = quoteTodayUtc();
  const visible = useMemo(
    () => (rows ?? []).filter((row) => matchesQuoteSearch(row, query)),
    [rows, query],
  );
  const groups = useMemo(() => groupQuotes(visible, today), [visible, today]);
  const totals = useMemo(() => worklistTotals(rows ?? [], today), [rows, today]);
  const sentEver = useMemo(() => (rows ?? []).filter((r) => r.sentAt).length, [rows]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setInfo(null);
    try {
      await task();
    } catch (err) {
      setError(refusalMessage(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  function resend(row: QuoteRow, viaWhatsApp: boolean) {
    const question = viaWhatsApp
      ? `Send quote ${row.ref} on WhatsApp? It is emailed to ${row.customerEmail} again with a NEW link — the link the guest already has stops working — and then you get that same new link to send on WhatsApp.`
      : `Send quote ${row.ref} again to ${row.customerEmail}? This makes a NEW link, and the link the guest already has stops working.`;
    if (!window.confirm(question)) return;
    void run(`send:${row.id}`, async () => {
      const result = await sendQuote(row.id);
      setSent({ kind: 'quote', row, url: result.url });
      await load();
    });
  }

  function sendBalance(row: QuoteRow) {
    if (
      !window.confirm(
        `Email a balance payment link for quote ${row.ref} to ${row.customerEmail}? A balance link sent earlier stops working; the guest’s quote link is not affected.`,
      )
    ) {
      return;
    }
    void run(`balance:${row.id}`, async () => {
      const result = await sendBalanceLink(row.ref);
      setSent({ kind: 'balance', row, url: result.url, emailed: result.emailed });
    });
  }

  function duplicate(row: QuoteRow) {
    void run(`dup:${row.id}`, async () => {
      onOpen(await duplicateQuote(row.id));
    });
  }

  function whatsapp(row: QuoteRow) {
    const number = whatsappNumber(row.customerPhone);
    if ('reason' in number) {
      setInfo(`${row.customerName} (${row.ref}): ${number.reason} Open the quote to change it.`);
      return;
    }
    resend(row, true);
  }

  const doneRows = allDone ? groups.done : groups.done.slice(0, DONE_PAGE);

  return (
    <div>
      <AdminHeading
        title="Quotes"
        subtitle={
          rows ? `${rows.length} quotes · ${totals.paid} paid of ${sentEver} sent` : 'Loading…'
        }
        action={
          <span className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onNew(true)} className={buttonClass('ai')}>
              <GeminiSpark size={15} /> Draft from an enquiry
            </button>
            <button type="button" onClick={() => onNew(false)} className={BTN_PRIMARY}>
              <IconPlus width={15} height={15} /> New quote
            </button>
          </span>
        }
      />

      {error && <AdminError>{error}</AdminError>}
      {info && (
        <p
          role="status"
          className="mb-4 rounded-lg bg-gold-tint px-3 py-2.5 text-[13px] font-medium text-ink"
        >
          {info}
        </p>
      )}

      {sent && (
        <Panel
          className="mb-3.5"
          title={sent.kind === 'quote' ? `Quote ${sent.row.ref} sent` : 'Balance link ready'}
          actions={
            <button
              type="button"
              onClick={() => setSent(null)}
              aria-label="Dismiss"
              className={buttonClass('quiet', 'sm')}
            >
              <IconX width={14} height={14} />
            </button>
          }
        >
          <div className={PANEL_BODY}>
            <p role="status" className="mb-2.5 text-[13px] text-ink">
              {sent.kind === 'balance' && sent.emailed === false
                ? `The link is ready but the email to ${sent.row.customerEmail} could not be sent — copy it to the guest.`
                : `Emailed to ${sent.row.customerEmail}.`}
            </p>
            <FreshLink
              url={sent.url}
              heading={sent.kind === 'quote' ? 'The guest’s new link' : 'The balance link'}
              inputLabel={sent.kind === 'quote' ? 'New quote link' : 'Balance payment link'}
              phone={sent.row.customerPhone}
              message={
                sent.kind === 'quote'
                  ? quoteWhatsAppText({
                      customerName: sent.row.customerName,
                      ref: sent.row.ref,
                      url: sent.url,
                      locale: sent.row.locale,
                    })
                  : balanceWhatsAppText({
                      customerName: sent.row.customerName,
                      url: sent.url,
                      locale: sent.row.locale,
                    })
              }
              note={
                sent.kind === 'balance'
                  ? 'It opens a fresh checkout each time, for as long as the balance is owed.'
                  : undefined
              }
            />
          </div>
        </Panel>
      )}

      <div className="mb-3.5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <Kpi
          label="Waiting for payment"
          value={totals.waiting.count}
          detail={`${eurFromMinor(totals.waiting.totalMinor)} sent and still valid`}
        />
        <Kpi
          label="Balance to collect"
          value={totals.balance.count}
          detail={`${eurFromMinor(totals.balance.owedMinor)} still owed`}
        />
        <Kpi label="Expired without paying" value={totals.expired} detail="Past valid-until" />
        <Kpi label="Paid" value={totals.paid} detail="Accepted and paid" />
      </div>

      <div className="relative mb-3.5">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft">
          <IconSearch width={15} height={15} />
        </span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search quotes"
          placeholder="Search by ref, name, email or phone"
          className={`${INPUT_CLS} pl-8`}
        />
      </div>

      {rows === null && <p className="text-[13px] text-ink-soft">Loading…</p>}
      {rows !== null && visible.length === 0 && (
        <Panel label="No quotes">
          <div className={`${PANEL_BODY} text-center`}>
            <p className="text-[14px] font-bold text-ink">
              {rows.length === 0 ? 'No quotes yet' : 'No quotes match this search'}
            </p>
            <p className="mt-1 text-[13px] text-ink-soft">
              {rows.length === 0
                ? 'Draft one for a guest who asked for a price, and email it from here.'
                : 'Try a ref, a surname or part of the email.'}
            </p>
          </div>
        </Panel>
      )}

      <div className="flex flex-col gap-3.5">
        {WORK_GROUPS.filter((g) => g.id !== 'done' && groups[g.id].length > 0).map((group) => (
          <Panel
            key={group.id}
            title={group.title}
            meta={`${groups[group.id].length} · ${group.meta}`}
          >
            <ul>
              {groups[group.id].map((row) => (
                <WorkRow
                  key={row.id}
                  row={row}
                  group={group.id}
                  stage={quoteStage(row, today)}
                  summary={summaries.get(row.id)}
                  busy={busy}
                  onOpen={() => onOpen(row.id)}
                  onResend={() => resend(row, false)}
                  onWhatsApp={() => whatsapp(row)}
                  onBalance={() => sendBalance(row)}
                  onDuplicate={() => duplicate(row)}
                />
              ))}
            </ul>
          </Panel>
        ))}

        {groups.done.length > 0 && (
          <Panel title="Done" meta={`${groups.done.length} · Paid, withdrawn or closed`}>
            <DataTable label="Done quotes">
              <thead>
                <tr>
                  <Th>Ref</Th>
                  <Th>Guest</Th>
                  <Th>What</Th>
                  <Th>Trip date</Th>
                  <Th>Status</Th>
                  <Th num>Total</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {doneRows.map((row) => {
                  const stage = quoteStage(row, today);
                  const summary = summaries.get(row.id);
                  return (
                    <tr key={row.id}>
                      <Td className="whitespace-nowrap font-mono text-[12px] font-semibold text-teal-dark">
                        <button
                          type="button"
                          onClick={() => onOpen(row.id)}
                          className="hover:underline"
                          aria-label={`Open quote ${row.ref} for ${row.customerName}`}
                        >
                          {row.ref}
                        </button>
                      </Td>
                      <Td className="font-semibold text-ink">{row.customerName}</Td>
                      <Td className="max-w-[16rem] truncate text-ink-muted">
                        {summary ? whatText(summary) : row.customerEmail}
                      </Td>
                      <Td className="whitespace-nowrap text-ink-muted">
                        {summary?.firstDate ? fmtDateShort(summary.firstDate) : '—'}
                      </Td>
                      <Td>
                        <StatusChip tone={stage.tone}>{stage.label}</StatusChip>
                      </Td>
                      <Td num className="font-bold text-ink">
                        {eurFromMinor(row.totalMinor)}
                      </Td>
                      <Td num>
                        <button
                          type="button"
                          onClick={() => duplicate(row)}
                          disabled={busy !== null}
                          className={buttonClass('quiet', 'sm')}
                          aria-label={`Duplicate quote ${row.ref}`}
                        >
                          {busy === `dup:${row.id}` ? 'Copying…' : 'Duplicate'}
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            {groups.done.length > DONE_PAGE && (
              <div className="border-t border-line-soft px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => setAllDone((v) => !v)}
                  className={buttonClass('quiet', 'sm')}
                >
                  {allDone ? `Show the latest ${DONE_PAGE}` : `Show all ${groups.done.length}`}
                </button>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}

function whatText(summary: LineSummary): string {
  return summary.more > 0
    ? `${summary.first}, and ${summary.more} more item${summary.more === 1 ? '' : 's'}`
    : summary.first;
}

function WorkRow({
  row,
  group,
  stage,
  summary,
  busy,
  onOpen,
  onResend,
  onWhatsApp,
  onBalance,
  onDuplicate,
}: {
  row: QuoteRow;
  group: QuoteWorkGroup;
  stage: QuoteStage;
  summary: LineSummary | undefined;
  busy: string | null;
  onOpen: () => void;
  onResend: () => void;
  onWhatsApp: () => void;
  onBalance: () => void;
  onDuplicate: () => void;
}) {
  const actions = rowActions(row);
  const waReady = 'digits' in whatsappNumber(row.customerPhone);
  const sending = busy === `send:${row.id}`;
  const owed = stage.balanceOwedMinor;
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3 last:border-b-0">
      <span
        aria-hidden="true"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-teal-tint text-[11.5px] font-bold text-teal-dark"
      >
        {guestInitials(row.customerName)}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <p className="truncate text-[13px] font-bold text-ink">
          {row.customerName}{' '}
          <span className="font-mono text-[11.5px] font-semibold text-ink-soft">{row.ref}</span>
        </p>
        <p className="truncate text-[12px] text-ink-soft">
          {summary ? whatText(summary) : row.customerEmail}
        </p>
      </div>
      <div className="w-28 shrink-0">
        <p className="text-[12.5px] font-semibold text-ink">
          {summary?.firstDate ? fmtDateShort(summary.firstDate) : '—'}
        </p>
        <p className="text-[11.5px] text-ink-soft">Trip date</p>
      </div>
      <div className="w-40 shrink-0">
        {group === 'balance' && owed !== null && stage.paidMinor !== null ? (
          <>
            <p className="text-[12px] font-semibold text-ink">
              {eurFromMinor(stage.paidMinor)} of{' '}
              {eurFromMinor(row.booking?.totalMinor ?? row.totalMinor)} paid
            </p>
            <ProgressBar
              value={stage.paidMinor}
              max={row.booking?.totalMinor ?? row.totalMinor}
              tone="gold"
              className="mt-1"
            />
          </>
        ) : (
          <>
            <StatusChip tone={stage.tone}>{stage.label}</StatusChip>
            <p className="mt-0.5 text-[11.5px] text-ink-soft">
              {group === 'draft'
                ? `Started ${fmtDateShort(row.createdAt)}`
                : row.sentAt
                  ? `Sent ${fmtDateShort(row.sentAt)} · valid to ${fmtDate(`${row.validUntil}T12:00:00+04:00`)}`
                  : `Valid to ${fmtDate(`${row.validUntil}T12:00:00+04:00`)}`}
            </p>
          </>
        )}
      </div>
      <p className="w-24 shrink-0 text-right text-[13.5px] font-bold text-ink">
        {eurFromMinor(owed ?? row.totalMinor)}
        {owed !== null && (
          <span className="block text-[11.5px] font-normal text-ink-soft">owed</span>
        )}
      </p>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        {actions.resend && (
          <>
            <button
              type="button"
              onClick={onWhatsApp}
              disabled={busy !== null}
              aria-disabled={!waReady || undefined}
              className={`${buttonClass('ghost', 'sm')} ${waReady ? '' : 'opacity-50'}`}
              aria-label={`WhatsApp: send quote ${row.ref} again and share the new link`}
            >
              WhatsApp
            </button>
            <button
              type="button"
              onClick={onResend}
              disabled={busy !== null}
              className={buttonClass('ghost', 'sm')}
              aria-label={`Send again: quote ${row.ref} by email`}
            >
              {sending ? 'Sending…' : 'Send again'}
            </button>
          </>
        )}
        {actions.balance && (
          <button
            type="button"
            onClick={onBalance}
            disabled={busy !== null}
            className={buttonClass('ghost', 'sm')}
            aria-label={`Send balance link for quote ${row.ref}`}
          >
            {busy === `balance:${row.id}` ? 'Sending…' : 'Send balance link'}
          </button>
        )}
        {group === 'expired' && (
          // The way back for an offer whose window closed: a fresh draft with a new validity window.
          <button
            type="button"
            onClick={onDuplicate}
            disabled={busy !== null}
            className={buttonClass('ghost', 'sm')}
            aria-label={`Duplicate quote ${row.ref} into a new draft`}
          >
            {busy === `dup:${row.id}` ? 'Copying…' : 'Duplicate'}
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          className={buttonClass('quiet', 'sm')}
          aria-label={`${group === 'draft' ? 'Finish' : 'Open'} quote ${row.ref} for ${row.customerName}`}
        >
          {group === 'draft' ? 'Finish' : 'Open'}
        </button>
      </div>
    </li>
  );
}
