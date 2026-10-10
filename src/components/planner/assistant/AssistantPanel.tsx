'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePreferences } from '@/components/site/PreferencesProvider';
import {
  IconCalendar,
  IconChevron,
  IconClock,
  IconMenu,
  IconMinus,
  IconPlus,
  IconShare,
  IconUsers,
  IconX,
  IconCheck,
} from '@/components/ui/icons';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { PlannerSession } from '../usePlannerSession';
import { fmtDur } from '../planner-constants';
import { RichText } from '../RichText';
import { ActivityCard } from '../ActivityCard';
import { TripProposalCard } from '../TripProposalCard';
import { TripDatePicker } from '../TripDatePicker';
import { useVoiceInput } from '../useVoiceInput';
import { PanelMenu, type MenuSection } from './PanelMenu';
import { focusStopCard, nameKey } from './focus-stop';
import { CarGlyph, IconList, IconMic, IconReply, IconSend } from './icons';

/** Openers for a first message. Mauritius days people actually ask for, not generic travel prompts. */
const SUGGESTIONS = [
  'A relaxed day in the south: two beaches and a waterfall',
  'Three days on the east coast with a catamaran cruise',
  'The best viewpoints in the west, back before sunset',
];
const FOLLOW_UPS = ['Add a beach', 'Add a viewpoint', 'Make it shorter'];

type Setup = 'dates' | 'party' | null;

/**
 * The assistant's left panel: where the visitor talks to ZilAi.
 *
 * Two states. Before anything is said it is an invitation — dates, travellers, a box to type in and
 * three ways to start. After that it is the conversation, and the plan itself lives on the canvas
 * beside it: the chat keeps the words, and every stop ZilAi names is a link to its card.
 */
export function AssistantPanel({
  session,
  open,
  canvasOpen,
  onClose,
  onOpenPlan,
}: {
  session: PlannerSession;
  open: boolean;
  canvasOpen: boolean;
  onClose: () => void;
  onOpenPlan: () => void;
}) {
  const { t, language } = usePreferences();
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<MenuSection | null>(null);
  const [setup, setSetup] = useState<Setup>(null);
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const voice = useVoiceInput({
    lang: language === 'fr' ? 'fr-FR' : 'en-GB',
    value: draft,
    onChange: setDraft,
  });

  const { chat, typing, stops, isTrip, days, hasPlan } = session;
  const started = chat.length > 0 || typing;

  // Opening the panel puts the cursor where the visitor will type — but only on a device with a
  // real keyboard, or a phone would throw its on-screen keyboard over the invitation it just opened.
  useEffect(() => {
    if (!open) return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      const id = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 380);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && started) el.scrollTo({ top: el.scrollHeight });
  }, [chat, typing, started]);

  // The composer grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
    // A scrollbar only once the text really is taller than the box — otherwise it sits there as a
    // stray bar beside a one-line field.
    el.style.overflowY = el.scrollHeight > 132 ? 'auto' : 'hidden';
  }, [draft]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || typing) return;
      void session.sendChat(trimmed);
      setDraft('');
      setSetup(null);
    },
    [session, typing],
  );

  // A stop ZilAi names in its reply is a link to that stop's card.
  const stopByName = useMemo(() => new Map(stops.map((p) => [nameKey(p.name), p.id])), [stops]);
  const onName = useCallback(
    (name: string) => {
      const id = stopByName.get(nameKey(name));
      if (!id) return null;
      return () => {
        onOpenPlan();
        focusStopCard(id);
      };
    },
    [stopByName, onOpenPlan],
  );

  const lastSummary = chat.reduce((at, m, i) => (m.kind === 'summary' ? i : at), -1);

  const datesLabel =
    session.rangeFrom && session.rangeTo
      ? `${formatLocaleDate(new Date(`${session.rangeFrom}T00:00:00`), language, { day: 'numeric', month: 'short' })} – ${formatLocaleDate(new Date(`${session.rangeTo}T00:00:00`), language, { day: 'numeric', month: 'short' })}`
      : null;
  const partyLabel =
    session.party === 1 ? t('1 traveller') : t('{n} travellers', { n: session.party });

  const setupArea = setup && (
    <div className="zilai-view mt-3">
      {setup === 'dates' ? (
        <TripDatePicker
          compact
          from={session.rangeFrom}
          to={session.rangeTo}
          onChange={session.applyRange}
          minDate={session.minDate}
        />
      ) : (
        <div className="flex items-center justify-between rounded-[14px] border border-ink/15 bg-white px-4 py-3">
          <div>
            <div className="text-[14px] font-bold text-ink">{t('Travellers')}</div>
            <div className="text-[12.5px] text-ink-muted">
              {session.quote
                ? t('{vehicle} · one price for the vehicle', { vehicle: t(session.quote.vehicle) })
                : (session.quoteError ?? '')}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => session.setParty(Math.max(1, session.party - 1))}
              disabled={session.party <= 1}
              aria-label={t('Fewer travellers')}
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-ink/20 text-ink transition-colors hover:border-ink disabled:cursor-default disabled:opacity-30"
            >
              <IconMinus width={16} height={16} />
            </button>
            <span
              className="w-8 text-center text-[16px] font-bold tabular-nums text-ink"
              aria-live="polite"
            >
              {session.party}
            </span>
            <button
              type="button"
              onClick={() =>
                session.setParty(Math.min(session.pricing.maxParty, session.party + 1))
              }
              disabled={session.party >= session.pricing.maxParty}
              aria-label={t('More travellers')}
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-ink/20 text-ink transition-colors hover:border-ink disabled:cursor-default disabled:opacity-30"
            >
              <IconPlus width={16} height={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(draft);
      }}
      className="flex items-end gap-1.5 rounded-[22px] border-2 border-teal bg-white py-1.5 pl-4 pr-1.5 transition-shadow focus-within:shadow-[0_0_0_4px_rgb(var(--color-teal)/0.15)]"
    >
      <textarea
        ref={inputRef}
        rows={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(draft);
          }
        }}
        placeholder={started ? t('Ask for a change…') : t('Describe your day…')}
        aria-label={t('Message ZilAi')}
        className="max-h-[132px] min-h-[40px] min-w-0 flex-1 resize-none border-none bg-transparent py-2 text-[15px] leading-[1.45] text-ink outline-none placeholder:text-ink-muted"
      />
      {voice.supported && (
        <button
          type="button"
          onClick={voice.toggle}
          aria-pressed={voice.listening}
          aria-label={voice.listening ? t('Stop voice input') : t('Voice input')}
          className={`grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${
            voice.listening ? 'bg-coral/15 text-coral-dark' : 'text-ink-muted hover:text-teal-dark'
          }`}
        >
          <IconMic width={19} height={19} />
        </button>
      )}
      <button
        type="submit"
        disabled={!draft.trim() || typing}
        aria-label={t('Send message')}
        className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-teal-dark text-white transition-[background-color,transform] hover:bg-ink active:scale-95 disabled:cursor-default disabled:bg-ink/15 disabled:text-white"
      >
        <IconSend width={18} height={18} />
      </button>
    </form>
  );

  const disclaimer = (
    <p className="m-0 text-center text-[11.5px] leading-[1.5] text-ink-muted">
      {t('ZilAi is AI — it can be inaccurate. Don’t share personal data.')}{' '}
      <Link href="/terms" className="underline underline-offset-2 hover:text-teal-dark">
        {t('Terms')}
      </Link>
      {' · '}
      <Link href="/privacy" className="underline underline-offset-2 hover:text-teal-dark">
        {t('Privacy')}
      </Link>
      {' · '}
      <Link
        href="/ai-road-trip-planner#how-zilai-works"
        className="underline underline-offset-2 hover:text-teal-dark"
      >
        {t('How ZilAi works')}
      </Link>
    </p>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* ── header ── */}
      <header className="flex h-[60px] shrink-0 items-center gap-1 border-b border-ink/[0.08] pl-2 pr-2">
        <button
          type="button"
          onClick={() => setMenu('recents')}
          aria-label={t('Menu')}
          aria-haspopup="dialog"
          className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
        >
          <IconMenu width={20} height={20} />
        </button>
        <div className="flex min-w-0 items-center gap-2 pl-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- tiny static brand mark */}
          <img
            src="/icon.svg"
            alt=""
            width={26}
            height={26}
            className="h-[26px] w-[26px] rounded-lg"
          />
          <span className="truncate text-[16px] font-extrabold text-ink">ZilAi</span>
          {/* Gives way to "New chat" once a conversation exists — the header is 400px wide. */}
          {!started && (
            <span className="hidden truncate text-[13px] font-medium text-ink-muted min-[380px]:inline">
              {t('AI assistant')}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center">
          {started && (
            <button
              type="button"
              onClick={() => {
                session.newChat();
                setDraft('');
              }}
              className="flex h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[14px] font-semibold text-ink transition-colors hover:bg-ink/[0.06]"
            >
              <IconPlus width={17} height={17} />
              {t('New chat')}
            </button>
          )}
          {hasPlan && (
            <button
              type="button"
              onClick={() => void session.copyLink()}
              aria-label={session.shared ? t('Link copied') : t('Copy a link to this plan')}
              title={session.shared ? t('Link copied') : t('Copy a link to this plan')}
              className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
            >
              {session.shared ? (
                <IconCheck width={18} height={18} className="text-teal-dark" />
              ) : (
                <IconShare width={18} height={18} />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close ZilAi')}
            className="grid h-10 w-10 cursor-pointer place-items-center rounded-full text-ink transition-colors hover:bg-ink/[0.06]"
          >
            <IconX width={20} height={20} />
          </button>
        </div>
      </header>

      {started ? (
        <>
          {/* ── dates & travellers, folded away under the header ── */}
          <div className="shrink-0 border-b border-ink/[0.08] px-4 py-2">
            <button
              type="button"
              onClick={() => setSetup((s) => (s ? null : 'dates'))}
              aria-expanded={setup !== null}
              className="flex w-full cursor-pointer items-center gap-2 rounded-lg py-1.5 text-left text-[14px] font-semibold text-ink"
            >
              <IconCalendar width={17} height={17} className="shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {datesLabel ? `${datesLabel} · ${partyLabel}` : t('Dates & travellers')}
              </span>
              <IconChevron
                width={16}
                height={16}
                className={`shrink-0 text-ink-muted transition-transform duration-200 ${setup ? 'rotate-180' : ''}`}
              />
            </button>
            {setup && (
              <div className="zilai-view pb-2">
                <div className="mt-1 flex gap-2">
                  {(['dates', 'party'] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSetup(id)}
                      aria-pressed={setup === id}
                      className={`cursor-pointer rounded-full border px-3 py-1 text-[13px] font-semibold transition-colors ${
                        setup === id
                          ? 'border-ink text-ink shadow-[inset_0_0_0_1px_rgb(var(--color-ink))]'
                          : 'border-ink/20 text-ink-muted hover:border-ink/40'
                      }`}
                    >
                      {id === 'dates' ? t('Dates') : t('Travellers')}
                    </button>
                  ))}
                </div>
                {setupArea}
              </div>
            )}
          </div>

          {/* ── the conversation ── */}
          <div
            ref={bodyRef}
            className="zilai-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5"
          >
            {chat.map((m, i) => {
              if (m.kind === 'place') return null; // older saved chats; the canvas shows stops now
              if (m.kind === 'summary') {
                // Only the latest plan chip is live, and only while the plan is not already beside it.
                if (i !== lastSummary || !hasPlan) return null;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={onOpenPlan}
                    className={`zilai-msg flex cursor-pointer items-center gap-3 self-start rounded-2xl border border-ink/15 bg-white px-3.5 py-2.5 text-left transition-colors hover:border-teal ${
                      canvasOpen ? 'lg:hidden' : ''
                    }`}
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-tint text-teal-dark">
                      <IconList width={17} height={17} />
                    </span>
                    <span>
                      <span className="block text-[14px] font-bold text-ink">
                        {t('View your plan')}
                      </span>
                      <span className="block text-[12.5px] text-ink-muted">
                        {isTrip && days
                          ? t('{n} days', { n: days.length })
                          : t('{n} stops · {dur} driving', {
                              n: stops.length,
                              dur: fmtDur(session.route.totalMinutes),
                            })}
                      </span>
                    </span>
                  </button>
                );
              }
              if (m.kind === 'activity') {
                const activity = session.bmtCatalog.get(m.slug);
                if (!activity) return null;
                return (
                  <div key={i} className="zilai-msg max-w-full self-start">
                    <ActivityCard
                      activity={activity}
                      date={m.date}
                      seatsLeft={activity.seatsLeft}
                    />
                  </div>
                );
              }
              if (m.kind === 'trip-proposal') {
                if (dismissedProposals.has(m.proposal.from)) return null;
                return (
                  <div key={i} className="zilai-msg">
                    <TripProposalCard
                      proposal={m.proposal}
                      applied={session.appliedProposals.has(m.proposal.from)}
                      onAccept={session.acceptProposal}
                      onDismiss={() =>
                        setDismissedProposals((s) => new Set(s).add(m.proposal.from))
                      }
                    />
                  </div>
                );
              }
              return m.role === 'user' ? (
                <div
                  key={i}
                  className="zilai-msg max-w-[88%] self-end whitespace-pre-wrap rounded-[18px_18px_4px_18px] bg-ink/[0.07] px-4 py-2.5 text-[15px] leading-[1.5] text-ink"
                >
                  {m.text}
                </div>
              ) : (
                // ZilAi's words sit straight on the page — no bubble. It is the voice of the panel,
                // not a second speaker boxed in beside the visitor.
                <div key={i} className="zilai-msg text-[15px] leading-[1.6] text-ink">
                  <RichText text={m.text} onName={onName} preview={session.previewByName} />
                </div>
              );
            })}

            {typing && <Working />}

            {session.boost && !typing && (
              <div className="zilai-msg rounded-2xl bg-[#FFF6E5] px-4 py-3">
                <p className="m-0 text-[14px] leading-[1.5] text-[#6B4E0E]">
                  <strong>
                    {t('{place} closes at {time}.', {
                      place: session.boost.place,
                      time: session.boost.close,
                    })}
                  </strong>{' '}
                  {t('It’s late in your order — want me to move it earlier?')}
                </p>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={session.applyBoost}
                    className="cursor-pointer rounded-full bg-[#6B4E0E] px-3.5 py-1.5 text-[13px] font-bold text-white"
                  >
                    {t('Yes, reorder')}
                  </button>
                  <button
                    type="button"
                    onClick={session.dismissBoost}
                    className="cursor-pointer rounded-full border border-[#6B4E0E]/40 px-3.5 py-1.5 text-[13px] font-bold text-[#6B4E0E]"
                  >
                    {t('Keep as is')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── composer ── */}
          <div className="shrink-0 border-t border-ink/[0.08] px-4 pb-3 pt-3">
            {hasPlan && !typing && (
              <div className="mb-2.5 flex flex-wrap gap-2">
                {FOLLOW_UPS.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => send(t(label))}
                    className="cursor-pointer rounded-full border border-ink/20 px-3 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:border-teal hover:text-teal-dark"
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            )}
            {composer}
            <div className="mt-2">{disclaimer}</div>
          </div>
        </>
      ) : (
        /* ── the invitation ── */
        <div
          ref={bodyRef}
          className="zilai-scroll flex min-h-0 flex-1 flex-col overflow-y-auto bg-[linear-gradient(180deg,#fff_58%,rgb(var(--color-teal-tint))_100%)]"
        >
          <div className="my-auto px-6 py-8">
            <h2
              className="zilai-rise m-0 text-balance text-center text-[26px] font-extrabold leading-[1.15] tracking-[-0.02em] text-ink"
              style={{ '--i': 0 } as React.CSSProperties}
            >
              {t('Let’s plan your Mauritius trip')}
            </h2>
            <p
              className="zilai-rise mx-auto mb-0 mt-2.5 max-w-[30ch] text-center text-[15px] leading-[1.5] text-ink-muted"
              style={{ '--i': 1 } as React.CSSProperties}
            >
              {t('Real places and real drive times, at one price for your own car and driver.')}
            </p>

            <div
              className="zilai-rise mt-6 grid grid-cols-3 gap-2"
              style={{ '--i': 2 } as React.CSSProperties}
            >
              <SetupChip
                icon={<IconCalendar width={19} height={19} />}
                label={datesLabel ?? t('Dates')}
                active={setup === 'dates'}
                filled={Boolean(datesLabel)}
                onClick={() => setSetup((s) => (s === 'dates' ? null : 'dates'))}
              />
              <SetupChip
                icon={<IconUsers width={19} height={19} />}
                label={session.party === 2 ? t('Travellers') : partyLabel}
                active={setup === 'party'}
                filled={session.party !== 2}
                onClick={() => setSetup((s) => (s === 'party' ? null : 'party'))}
              />
              <SetupChip
                icon={<IconClock width={19} height={19} />}
                label={t('Recents')}
                active={false}
                filled={false}
                onClick={() => setMenu('recents')}
              />
            </div>
            {setupArea}

            <div className="zilai-rise mt-4" style={{ '--i': 3 } as React.CSSProperties}>
              {composer}
            </div>

            <div className="zilai-rise mt-6" style={{ '--i': 4 } as React.CSSProperties}>
              <h3 className="m-0 text-[15px] font-extrabold text-ink">{t('Ask anything')}</h3>
              <ul className="m-0 mt-1 list-none p-0">
                {SUGGESTIONS.map((s) => (
                  <li key={s} className="border-b border-ink/10 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => send(t(s))}
                      className="group flex w-full cursor-pointer items-start gap-3 py-3 text-left text-[15px] leading-[1.4] text-ink transition-colors hover:text-teal-dark"
                    >
                      <IconReply
                        width={18}
                        height={18}
                        className="mt-0.5 shrink-0 text-ink-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-teal"
                      />
                      {t(s)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="px-6 pb-4">{disclaimer}</div>
        </div>
      )}

      {menu && (
        <PanelMenu
          section={menu}
          chats={session.savedChats}
          currentId={session.sessionId}
          onSection={setMenu}
          onNewChat={() => {
            session.newChat();
            setDraft('');
            setMenu(null);
          }}
          onResume={(saved) => {
            session.resumeChat(saved);
            setMenu(null);
          }}
          onDelete={session.removeSavedChat}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function SetupChip({
  icon,
  label,
  active,
  filled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  /** The visitor has set a value here — the chip shows it rather than its name. */
  filled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl px-1.5 py-2 text-[13.5px] font-bold leading-tight transition-colors ${
        active
          ? 'bg-teal-tint text-teal-dark shadow-[inset_0_0_0_1.5px_rgb(var(--color-teal))]'
          : filled
            ? 'bg-teal-tint text-teal-dark'
            : 'bg-ink/[0.05] text-ink hover:bg-ink/[0.09]'
      }`}
    >
      {icon}
      <span className="max-w-full truncate">{label}</span>
    </button>
  );
}

/**
 * The wait. A planning turn takes tens of seconds (several searches, a route, then the writing), and
 * the model does not report which step it is on — so this says only what is true: ZilAi is working,
 * and, once the wait is long enough to wonder, why.
 */
function Working() {
  const { t } = usePreferences();
  const [long, setLong] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setLong(true), 9000);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="zilai-msg" role="status">
      <div className="text-[15px] font-semibold text-ink">
        {long
          ? t('Still on it — checking real places and drive times takes a moment.')
          : t('ZilAi is working on it…')}
      </div>
      <div className="relative mt-3 h-5 w-[190px] overflow-hidden" aria-hidden>
        <div className="zilai-road absolute inset-x-0 bottom-[3px] h-[2px]" />
        <div className="zilai-road-car absolute bottom-[4px] left-0 text-teal-dark">
          <CarGlyph size={26} />
        </div>
      </div>
    </div>
  );
}
