'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  AdminError,
  AdminHeading,
  BTN_PRIMARY,
  INPUT_CLS,
  Panel,
  PANEL_BODY,
  ProgressBar,
  SELECT_CLS,
  StatusChip,
  buttonClass,
} from '@/components/admin/ui';
import { IconCheck, IconChevron, IconPlus, IconSearch, IconX } from '@/components/ui/icons';
import { mauDay } from '@/lib/admin/format';
import { quoteTodayUtc } from '@/lib/quotes/validity';
import {
  duplicateQuote,
  loadQuoteLineBriefs,
  loadQuotes,
  sendBalanceLink,
  sendQuote,
  type QuoteRow,
} from '@/lib/admin/quotes';
import { GuestAvatar } from '@/components/admin/GuestAvatar';
import { RollingNumber } from '@/components/admin/today/RollingNumber';
import { listNeighbours } from '@/components/admin/bookings/rules';
import { GeminiSpark } from '@/components/admin/quotes/AiSpark';
import { FreshLink } from '@/components/admin/quotes/FreshLink';
import { QuoteDrawer } from '@/components/admin/quotes/QuoteDrawer';
import { eurFromMinor, refusalMessage } from '@/components/admin/quotes/state';
import { balanceWhatsAppText, quoteWhatsAppText } from '@/components/admin/quotes/whatsapp';
import {
  SORT_LABELS,
  STAGE_HINTS,
  STAGE_SORTS,
  WORK_GROUPS,
  defaultQuoteStage,
  groupQuotes,
  lineSummaries,
  matchesQuoteSearch,
  paidLaterFlags,
  parseQuoteSort,
  parseQuoteStage,
  quotePrimary,
  quoteRowAmount,
  quoteRowNote,
  quoteStage,
  sortQuotes,
  stageCards,
  tripTile,
  type LineSummary,
  type PaidLaterFlag,
  type QuoteSort,
  type QuoteWorkGroup,
} from '@/components/admin/quotes/worklist';

/**
 * /admin/quotes — the worklist (the owner's mock-up, 16 Nov 2026, in the back office's own colours
 * and type). Five stage cards on top are the tabs: Waiting for payment, Balance to collect, Drafts to
 * finish, Expired unpaid, Done. One stage's list shows at a time, with its own search and order, and
 * each row says when the trip is, how long the quote can still be paid and what to do next. A row
 * opens the quote in a panel over the list (`QuoteDrawer`); Edit there leads to the full editor. The
 * stage, the order and the open quote are in the address (`?stage=`, `?sort=`, `?quote=`), so coming
 * back from the editor lands where the owner left. The rules are pure and tested (`worklist.ts`).
 *
 * ── SENDING FROM A ROW MINTS A NEW LINK ────────────────────────────────────────────────────────
 * "Send again" goes through the same route as the editor's Send: it emails the stored quote with a
 * NEW link, and the link the guest already holds stops working. The confirm says so. WhatsApp (in the
 * panel) is the same send, followed by a wa.me link carrying that new link — there is no WhatsApp
 * sending of our own, and no link to share without sending, because the raw token exists only in the
 * response.
 *
 * ── THE BALANCE LINK ───────────────────────────────────────────────────────────────────────────
 * Offered only where `quoteStage` finds a paid deposit booking with a balance genuinely owed
 * (`balanceIsOutstanding`). It emails a balance payment link; a balance link sent earlier stops
 * working, and the guest's original quote link is left alone.
 */

const DONE_PAGE = 25;

/** The dot on each stage card: the stage's colour, backed by its words. */
const STAGE_DOT: Record<QuoteWorkGroup, string> = {
  waiting: 'bg-gold',
  balance: 'bg-teal',
  draft: 'bg-ink-soft',
  expired: 'bg-coral',
  done: 'bg-teal-dark',
};

const EMPTY: Record<QuoteWorkGroup, { title: string; text: string }> = {
  waiting: {
    title: 'Nothing waiting for payment',
    text: 'Every sent quote has been paid, has expired or was withdrawn.',
  },
  balance: { title: 'No balances to collect', text: 'Every deposit booking is paid in full.' },
  draft: { title: 'No drafts', text: 'Start one with New quote, or draft one from an enquiry.' },
  expired: { title: 'Nothing expired unpaid', text: 'No sent quote ran out before it was paid.' },
  done: { title: 'Nothing here yet', text: 'Paid, withdrawn and closed quotes collect here.' },
};

type Sent = {
  kind: 'quote' | 'balance';
  row: QuoteRow;
  url: string;
  /** Balance links only: false when the email failed and the link must be copied by hand. */
  emailed?: boolean;
};

function readParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URL(window.location.href).searchParams.get(name);
}

function writeParams(next: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(next)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, '', url);
}

export function QuoteWorklist({
  onOpen,
  onNew,
}: {
  /** Open a quote in the full editor. */
  onOpen: (id: string) => void;
  /** A new quote; `ai` opens it with the enquiry drafter showing. */
  onNew: (ai: boolean) => void;
}) {
  const [rows, setRows] = useState<QuoteRow[] | null>(null);
  const [summaries, setSummaries] = useState<Map<string, LineSummary>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [allDone, setAllDone] = useState(false);
  // The stage and order from the address; until the quotes arrive, no stage is chosen yet.
  const [stage, setStage] = useState<QuoteWorkGroup | null>(() =>
    parseQuoteStage(readParam('stage')),
  );
  const [sort, setSort] = useState<QuoteSort | null>(() => {
    const s = parseQuoteStage(readParam('stage'));
    return s ? parseQuoteSort(readParam('sort'), s) : null;
  });
  const [openId, setOpenId] = useState<string | null>(() => readParam('quote'));
  const tabsRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [quotes, briefs] = await Promise.all([
      loadQuotes(),
      // The trip date and "what" are a nicety: without them the row shows the guest's email.
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
  const todayMu = mauDay(new Date());
  // Stages, counts and "already paid" flags over every quote; the search narrows only the list.
  const groups = useMemo(() => groupQuotes(rows ?? [], today), [rows, today]);
  const cards = useMemo(() => stageCards(groups, today), [groups, today]);
  const paidLater = useMemo(() => paidLaterFlags(rows ?? [], today), [rows, today]);
  const sentEver = useMemo(() => (rows ?? []).filter((r) => r.sentAt).length, [rows]);
  const paidCount = useMemo(
    () => (rows ?? []).filter((r) => quoteStage(r, today).label === 'Paid').length,
    [rows, today],
  );

  // Once the quotes arrive, a stage the address did not name opens on the first with work in it.
  const current: QuoteWorkGroup = stage ?? (rows ? defaultQuoteStage(groups) : 'waiting');
  const order: QuoteSort = sort ?? STAGE_SORTS[current][0]!;

  const list = useMemo(() => {
    const matching = groups[current].filter((r) => matchesQuoteSearch(r, query));
    return sortQuotes(matching, order, {
      tripDate: (r) => summaries.get(r.id)?.firstDate ?? null,
      amount: (r) => quoteRowAmount(r, quoteStage(r, today)).minor ?? 0,
    });
  }, [groups, current, query, order, summaries, today]);
  const shown = current === 'done' && !allDone ? list.slice(0, DONE_PAGE) : list;

  // With a search typed, where else it matches (so an empty stage can point there).
  const elsewhere = useMemo(() => {
    if (!query.trim()) return [];
    return WORK_GROUPS.filter((g) => g.id !== current)
      .map((g) => ({
        id: g.id,
        title: g.title,
        n: groups[g.id].filter((r) => matchesQuoteSearch(r, query)).length,
      }))
      .filter((g) => g.n > 0);
  }, [groups, current, query]);

  const openRow = openId ? (rows?.find((r) => r.id === openId) ?? null) : null;
  const neighbours = listNeighbours(
    shown.map((r) => r.id),
    openId,
  );

  // On a phone the stages are a sideways rail: keep the chosen one in view (an address or the
  // default can pick a stage that starts off-screen). Only the rail scrolls, never the page.
  useEffect(() => {
    const rail = tabsRef.current;
    const tab = rail?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!rail || !tab || rail.scrollWidth <= rail.clientWidth) return;
    const box = rail.getBoundingClientRect();
    const card = tab.getBoundingClientRect();
    if (card.left < box.left || card.right > box.right) {
      rail.scrollLeft += card.left - box.left - 16;
    }
  }, [current, rows]);

  function selectStage(next: QuoteWorkGroup) {
    setStage(next);
    setSort(STAGE_SORTS[next][0]!);
    setAllDone(false);
    writeParams({ stage: next, sort: null });
  }

  function selectSort(next: QuoteSort) {
    setSort(next);
    writeParams({ sort: next === STAGE_SORTS[current][0] ? null : next });
  }

  function openPanel(id: string) {
    setOpenId(id);
    writeParams({ quote: id });
  }

  function closePanel() {
    const back = openId;
    setOpenId(null);
    writeParams({ quote: null });
    // Focus goes back to the row the panel was showing (Previous / Next may have moved it on).
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-quote-open="${back}"]`)?.focus();
    });
  }

  function openEditor(id: string) {
    // The panel stays named in the address, so closing the editor comes back to it.
    writeParams({ quote: id });
    onOpen(id);
  }

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(refusalMessage(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  function resend(row: QuoteRow) {
    if (
      !window.confirm(
        `Send quote ${row.ref} again to ${row.customerEmail}? This makes a NEW link, and the link the guest already has stops working.`,
      )
    ) {
      return;
    }
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
      openEditor(await duplicateQuote(row.id));
    });
  }

  // The stage cards are one tab list: arrows move and choose, Home / End jump.
  function onTabKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    const ids = WORK_GROUPS.map((g) => g.id);
    const at = ids.indexOf(current);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? ids.length - 1
          : e.key === 'ArrowRight' || e.key === 'ArrowDown'
            ? (at + 1) % ids.length
            : (at - 1 + ids.length) % ids.length;
    selectStage(ids[next]!);
    tabsRef.current?.querySelector<HTMLElement>(`[data-stage="${ids[next]}"]`)?.focus();
  }

  const paidPct = sentEver > 0 ? Math.round((paidCount / sentEver) * 100) : null;
  const stageTitle = WORK_GROUPS.find((g) => g.id === current)!.title;

  return (
    <div>
      <AdminHeading
        title="Quotes"
        subtitle={
          rows
            ? `${rows.length} quotes · ${paidCount} of ${sentEver} sent were paid${paidPct !== null ? ` (${paidPct}%)` : ''}`
            : 'Loading…'
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

      {/* The stages: five cards that are the tabs. */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Quote stages"
        onKeyDown={onTabKey}
        // A phone gets one swipeable row (two cards and the edge of a third) instead of three rows
        // of cut-off cards; the bottom padding keeps the chosen card's shadow inside the scroller.
        className="no-bar relative -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2.5 overflow-x-auto px-4 pb-4 sm:mx-0 sm:mb-3.5 sm:grid sm:grid-cols-3 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-5"
      >
        {cards.map((card) => {
          const on = card.id === current;
          return (
            <button
              key={card.id}
              type="button"
              role="tab"
              id={`quote-stage-${card.id}`}
              data-stage={card.id}
              aria-selected={on}
              aria-controls="quote-stage-list"
              tabIndex={on ? 0 : -1}
              onClick={() => selectStage(card.id)}
              className={`group flex w-[168px] min-w-0 shrink-0 snap-start flex-col items-start gap-1 rounded-2xl border px-3.5 py-3.5 text-left sm:w-auto sm:shrink sm:px-4 transition-[transform,box-shadow,background-color,border-color] duration-150 motion-reduce:transition-none ${PANEL_RING} ${
                on
                  ? 'border-ink bg-ink text-white shadow-[0_12px_28px_-10px_rgba(10,46,54,0.55)]'
                  : 'border-line bg-white text-ink hover:-translate-y-0.5 hover:border-[#C2CED1] hover:shadow-[0_8px_20px_-14px_rgba(10,46,54,0.45)] motion-reduce:hover:translate-y-0'
              }`}
            >
              <span className="flex w-full min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT[card.id]}`}
                />
                <span
                  className={`truncate text-[12px] font-semibold sm:text-[12.5px] ${on ? 'text-white/85' : 'text-ink-muted'}`}
                >
                  {card.label}
                </span>
              </span>
              <span className="text-[28px] font-bold leading-none tracking-[-0.02em] tabular-nums">
                {rows ? (
                  <RollingNumber key={card.count} value={String(card.count)} />
                ) : (
                  <span className="inline-block h-7 w-8 rounded bg-line-soft motion-safe:animate-pulse" />
                )}
              </span>
              <span
                className={`line-clamp-2 w-full text-[12px] sm:truncate ${on ? 'text-white/70' : 'text-ink-soft'}`}
              >
                {rows ? card.sub : ' '}
              </span>
            </button>
          );
        })}
      </div>

      {/* The chosen stage's list. */}
      <section
        id="quote-stage-list"
        role="tabpanel"
        aria-labelledby={`quote-stage-${current}`}
        className="overflow-hidden rounded-2xl border border-line bg-white"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-3.5 sm:px-5">
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="text-[17px] font-bold tracking-[-0.01em] text-ink">{stageTitle}</h2>
            <p className="text-[12.5px] text-ink-soft">
              {STAGE_HINTS[current]} · {SORT_LABELS[order].toLowerCase()} first
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft">
              <IconSearch width={15} height={15} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search quotes"
              placeholder="Name, ref, email or phone"
              className={`${INPUT_CLS} pl-8`}
            />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink-soft">
            Sort
            <select
              value={order}
              onChange={(e) => selectSort(e.target.value as QuoteSort)}
              className={`${SELECT_CLS} w-auto`}
            >
              {STAGE_SORTS[current].map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        {rows === null ? (
          <RowsSkeleton />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 border-t border-line-soft px-6 py-12 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-teal-tint text-teal-dark">
              {query.trim() ? (
                <IconSearch width={22} height={22} aria-hidden="true" />
              ) : (
                <IconCheck width={22} height={22} aria-hidden="true" />
              )}
            </span>
            <p className="text-[15px] font-bold text-ink">
              {query.trim() ? `No match in ${stageTitle}` : EMPTY[current].title}
            </p>
            <p className="max-w-sm text-[13px] text-ink-soft">
              {query.trim() ? 'Try a ref, a surname or part of the email.' : EMPTY[current].text}
            </p>
            {elsewhere.length > 0 && (
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                {elsewhere.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => selectStage(g.id)}
                    className={buttonClass('ghost', 'sm')}
                  >
                    {g.n} in {g.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              aria-hidden="true"
              className={`hidden border-t border-line-soft bg-[#FAFBFB] px-5 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft lg:grid ${ROW_GRID}`}
            >
              <span>Guest &amp; trip</span>
              <span>Trip</span>
              <span>{current === 'balance' ? 'Collected' : 'Status'}</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            <ul>
              {shown.map((row) => (
                <QuoteRowItem
                  key={row.id}
                  row={row}
                  today={today}
                  todayMu={todayMu}
                  summary={summaries.get(row.id)}
                  paidLater={paidLater.get(row.id)}
                  open={row.id === openId}
                  busy={busy}
                  onOpen={() => openPanel(row.id)}
                  onOpenQuote={openPanel}
                  onEdit={() => openEditor(row.id)}
                  onResend={() => resend(row)}
                  onBalance={() => sendBalance(row)}
                  onDuplicate={() => duplicate(row)}
                />
              ))}
            </ul>
            {current === 'done' && list.length > DONE_PAGE && (
              <div className="border-t border-line-soft px-4 py-2.5 sm:px-5">
                <button
                  type="button"
                  onClick={() => setAllDone((v) => !v)}
                  className={buttonClass('quiet', 'sm')}
                >
                  {allDone ? `Show the latest ${DONE_PAGE}` : `Show all ${list.length}`}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {openRow && (
        <QuoteDrawer
          row={openRow}
          paidLater={paidLater.get(openRow.id)}
          prevId={neighbours.prev}
          nextId={neighbours.next}
          position={neighbours.index >= 0 ? { index: neighbours.index, count: shown.length } : null}
          onNavigate={openPanel}
          onClose={closePanel}
          onEdit={openEditor}
          onChanged={load}
          today={today}
          todayMu={todayMu}
        />
      )}
    </div>
  );
}

const PANEL_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-dark';

/** The five columns on a wide screen; below that a row stacks. */
const ROW_GRID =
  'lg:grid-cols-[minmax(0,2.6fr)_64px_minmax(0,1.5fr)_120px_minmax(150px,auto)] lg:gap-5';

function whatText(summary: LineSummary): string {
  return summary.more > 0
    ? `${summary.first}, and ${summary.more} more item${summary.more === 1 ? '' : 's'}`
    : summary.first;
}

function QuoteRowItem({
  row,
  today,
  todayMu,
  summary,
  paidLater,
  open,
  busy,
  onOpen,
  onOpenQuote,
  onEdit,
  onResend,
  onBalance,
  onDuplicate,
}: {
  row: QuoteRow;
  today: string;
  todayMu: string;
  summary: LineSummary | undefined;
  /** This guest paid a later quote: probably a re-quote, so this one should be withdrawn. */
  paidLater: PaidLaterFlag | undefined;
  /** Shown in the panel right now. */
  open: boolean;
  busy: string | null;
  onOpen: () => void;
  onOpenQuote: (id: string) => void;
  onEdit: () => void;
  onResend: () => void;
  onBalance: () => void;
  onDuplicate: () => void;
}) {
  const stage = quoteStage(row, today);
  const trip = tripTile(summary?.firstDate, todayMu);
  const note = quoteRowNote(row, stage, trip, today, todayMu);
  const amount = quoteRowAmount(row, stage);
  const primary = quotePrimary(row, today);
  const total = row.booking?.totalMinor ?? row.totalMinor;

  const action =
    primary === 'resend'
      ? { label: busy === `send:${row.id}` ? 'Sending…' : 'Send again', run: onResend }
      : primary === 'balance'
        ? { label: busy === `balance:${row.id}` ? 'Sending…' : 'Send balance link', run: onBalance }
        : primary === 'finish'
          ? { label: 'Finish', run: onEdit }
          : primary === 'duplicate'
            ? { label: busy === `dup:${row.id}` ? 'Copying…' : 'Duplicate', run: onDuplicate }
            : null;

  return (
    <li
      className={`relative grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 border-t border-line-soft px-4 py-3.5 transition-colors motion-reduce:transition-none sm:px-5 ${ROW_GRID} ${
        open ? 'bg-teal-tint/40' : 'hover:bg-[#FAFBFB]'
      }`}
    >
      {/* Guest & trip. The name is the row's button: it stretches over the whole row. */}
      <div className="col-span-3 flex min-w-0 items-center gap-3 lg:col-span-1">
        <GuestAvatar name={row.customerName} />
        <div className="min-w-0">
          <p className="flex min-w-0 items-baseline gap-2">
            <button
              type="button"
              onClick={onOpen}
              data-quote-open={row.id}
              aria-label={`Open quote ${row.ref} for ${row.customerName}`}
              className="truncate text-left text-[14px] font-semibold text-ink outline-none after:absolute after:inset-0 after:content-[''] hover:text-teal-dark focus-visible:after:rounded-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-teal-dark"
            >
              {row.customerName}
            </button>
            <span className="shrink-0 font-mono text-[11px] font-semibold text-ink-soft">
              {row.ref}
            </span>
          </p>
          <p className="truncate text-[12.5px] text-ink-soft">
            {summary ? whatText(summary) : row.customerEmail}
          </p>
          {paidLater && (
            <p className="relative z-[1] mt-1 inline-flex max-w-full flex-wrap items-center gap-x-1 rounded-md bg-gold-tint px-2 py-0.5 text-[11.5px] font-semibold text-gold-dark">
              Guest already paid
              <button
                type="button"
                onClick={() => onOpenQuote(paidLater.id)}
                className="font-mono underline hover:no-underline"
                aria-label={`Open quote ${paidLater.ref}, which ${row.customerName} paid`}
              >
                {paidLater.ref}
              </button>
            </p>
          )}
        </div>
      </div>

      {/* Trip date. */}
      <div>
        {trip ? (
          <div
            className={`flex h-[52px] w-[60px] flex-col items-center justify-center rounded-xl ${
              trip.past ? 'bg-coral-tint text-coral-dark' : 'bg-ground text-ink'
            }`}
          >
            <span className="text-[19px] font-bold leading-none">{trip.day}</span>
            <span className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]">
              {trip.month}
            </span>
            {trip.past && <span className="sr-only">, the trip date has passed</span>}
          </div>
        ) : (
          <div className="flex h-[52px] w-[60px] items-center justify-center rounded-xl border border-dashed border-line text-center text-[10.5px] font-semibold leading-tight text-ink-soft">
            No date
          </div>
        )}
      </div>

      {/* Status, or what is collected on a balance. */}
      <div className="flex min-w-0 flex-col gap-1">
        {stage.group === 'balance' && stage.paidMinor !== null ? (
          <>
            <p className="flex justify-between gap-2 text-[12px]">
              <span className="font-semibold text-ink">
                {eurFromMinor(stage.paidMinor)} of {eurFromMinor(total)}
              </span>
              <span className="text-ink-soft">
                {Math.round((stage.paidMinor / Math.max(1, total)) * 100)}%
              </span>
            </p>
            <ProgressBar
              value={stage.paidMinor}
              max={total}
              tone={note.urgent ? 'coral' : 'teal'}
            />
          </>
        ) : (
          <StatusChip tone={stage.tone} className="self-start">
            {stage.label}
          </StatusChip>
        )}
        <span
          className={`text-[12px] ${note.urgent ? 'font-semibold text-coral-dark' : 'text-ink-soft'}`}
        >
          {note.text}
        </span>
      </div>

      {/* Amount. */}
      <div className="text-right">
        <p className="whitespace-nowrap text-[16px] font-bold tabular-nums tracking-[-0.01em] text-ink">
          {amount.minor === null ? '—' : eurFromMinor(amount.minor)}
        </p>
        <p className="text-[12px] text-ink-soft">{amount.sub}</p>
      </div>

      {/* The row's one action, and the way into the panel. */}
      <div className="relative z-[1] col-span-3 flex items-center justify-end gap-1.5 lg:col-span-1">
        {action && (
          <button
            type="button"
            onClick={action.run}
            disabled={busy !== null}
            className={buttonClass('ghost', 'sm')}
            aria-label={`${action.label}: quote ${row.ref}`}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          onClick={onOpen}
          tabIndex={-1}
          aria-hidden="true"
          className="grid h-[30px] w-[30px] place-items-center rounded-lg bg-ground text-ink-muted transition-colors hover:bg-line-soft hover:text-ink motion-reduce:transition-none"
        >
          <IconChevron width={15} height={15} />
        </button>
      </div>
    </li>
  );
}

function RowsSkeleton() {
  return (
    <ul aria-label="Loading quotes" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <li
          key={i}
          className="flex items-center gap-4 border-t border-line-soft px-4 py-4 sm:px-5"
          aria-hidden="true"
        >
          <span className="h-8 w-8 shrink-0 rounded-full bg-line-soft motion-safe:animate-pulse" />
          <span className="flex-1">
            <span className="block h-3.5 w-2/5 rounded bg-line-soft motion-safe:animate-pulse" />
            <span className="mt-2 block h-3 w-3/5 rounded bg-line-soft motion-safe:animate-pulse" />
          </span>
          <span className="hidden h-[52px] w-[60px] rounded-xl bg-line-soft motion-safe:animate-pulse sm:block" />
          <span className="h-4 w-16 rounded bg-line-soft motion-safe:animate-pulse" />
        </li>
      ))}
    </ul>
  );
}
