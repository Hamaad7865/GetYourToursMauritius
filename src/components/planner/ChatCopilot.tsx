'use client';

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PlannerPlace } from '@/lib/validation/planner';
import type { AddBlockReason } from '@/lib/planner/constraints';
import type { PlannerRouteCalc } from '@/lib/planner/route';
import type { PlannerQuote } from '@/lib/planner/pricing';
import type { ChatMsg, Boost } from './types';
import { fmtDur } from './planner-constants';
import { Thumb } from './Thumb';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';

const REPLY_CHIPS = ['Add a beach', 'Add a viewpoint', 'Make it shorter'];

function VerifiedCue() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1 rounded-[7px] bg-teal-tint px-[7px] py-[3px] text-[11px] font-bold text-teal">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M5 13l4 4L19 7" stroke="#0E8C92" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {t('Real place · open today')}
    </span>
  );
}

export function ChatCopilot({
  messages,
  typing,
  boost,
  hasBuilt,
  stops,
  placesById,
  stopIndex,
  route,
  quote,
  onSend,
  onApplyBoost,
  onDismissBoost,
  onClear,
  onBrowse,
  onQuote,
  onAddPlace,
  addReasonById,
}: {
  messages: ChatMsg[];
  typing: boolean;
  boost: Boost | null;
  hasBuilt: boolean;
  stops: PlannerPlace[];
  placesById: Map<string, PlannerPlace>;
  stopIndex: Map<string, number>;
  route: PlannerRouteCalc;
  quote: PlannerQuote | null;
  onSend: (text: string) => void;
  onApplyBoost: () => void;
  onDismissBoost: () => void;
  onClear: () => void;
  onBrowse: () => void;
  onQuote: () => void;
  onAddPlace: (id: string) => void;
  /** Why a suggested place can't be added right now (day full / too far), or null when it can. */
  addReasonById: (id: string) => AddBlockReason;
}) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, typing]);

  function submit(text: string) {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setDraft('');
  }

  function placeCard(id: string, why: string | undefined, key: number) {
    const p = placesById.get(id);
    if (!p) return null;
    const idx = stopIndex.get(id);
    const drive = idx != null ? route.segs[idx] : undefined;
    const added = idx != null;
    return (
      <div key={key} className="flex max-w-[86%] animate-float-in flex-col gap-[9px] self-start rounded-[4px_16px_16px_16px] border border-[#EAF2F1] bg-white p-2.5 shadow-[0_6px_18px_rgba(10,46,54,.07)]">
        <div className="flex gap-[11px]">
          <Thumb place={p} size={58} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[7px]">
              <strong className="text-[14.5px] text-ink">{p.name}</strong>
              <span className="rounded-md bg-[#F1F6F5] px-[7px] py-0.5 text-[11px] font-bold text-ink-muted">{p.category}</span>
            </div>
            <p className="m-0 mt-1 text-[12.5px] leading-[1.4] text-ink-muted">{why || p.blurb}</p>
            <div className="mt-[7px]">
              <VerifiedCue />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-dashed border-[#E7EFEE] pt-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-dark">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 16l1.5-4.5A2 2 0 0 1 8.4 10h7.2a2 2 0 0 1 1.9 1.5L19 16m-14 0v2.5a.5.5 0 0 0 .5.5H7a.5.5 0 0 0 .5-.5V16m11.5 0v2.5a.5.5 0 0 1-.5.5H17a.5.5 0 0 1-.5-.5V16M5 16h14" stroke="#0B5C63" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {drive ? t('{m} min · {km} km from last stop', { m: drive.minutes, km: drive.km }) : t('mapped')}
          </span>
          {added ? (
            <span className="text-xs font-bold text-teal">{t('✓ Added')}</span>
          ) : (
            (() => {
              const reason = addReasonById(id);
              if (reason)
                return (
                  <span className="text-xs font-bold text-ink-muted">{reason === 'full' ? t('Day full') : t('Too far')}</span>
                );
              return (
                <button type="button" onClick={() => onAddPlace(id)} className="cursor-pointer rounded-[9px] bg-coral px-[13px] py-[7px] text-[12.5px] font-bold text-white">
                  {t('+ Add')}
                </button>
              );
            })()
          )}
        </div>
      </div>
    );
  }

  function summaryCard(key: number) {
    return (
      <div key={key} className="max-w-[88%] animate-pop self-start rounded-[4px_16px_16px_16px] border border-[#D8ECEA] p-3.5 shadow-[0_10px_26px_rgba(14,140,146,.12)]" style={{ background: 'linear-gradient(160deg,#fff,#EAF7F5)' }}>
        <div className="mb-2.5 flex items-center gap-2">
          <span className="font-display text-[15px] font-semibold text-ink">{t('Your day, mapped')}</span>
          <span className="ml-auto">
            <VerifiedCue />
          </span>
        </div>
        <div className="mb-[11px] flex flex-col gap-1.5">
          {stops.map((p, i) => (
            <div key={p.id} className="flex items-center gap-[9px] text-[13px]">
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-coral text-[11px] font-extrabold text-white">{i + 1}</span>
              <span className="font-semibold text-ink">{p.name}</span>
              <span className="ml-auto text-[11.5px] text-ink-muted">{t('{d} here', { d: fmtDur(p.durationMin) })}</span>
            </div>
          ))}
        </div>
        <div className="mb-[11px] flex gap-3.5 border-y border-teal/15 py-[9px]">
          {([
            ['Stops', String(stops.length)],
            ['Driving', fmtDur(route.totalMinutes)],
            ['Distance', `${route.totalKm} km`],
            ['Est.', quote ? <Price eur={quote.totalEur} /> : '—'],
          ] as Array<[string, ReactNode]>).map(([k, v]) => (
            <div key={k}>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-ink-muted">{t(k)}</div>
              <div className={`text-[15px] font-extrabold ${k === 'Est.' ? 'font-display text-gold' : 'text-ink'} tabular-nums`}>{v}</div>
            </div>
          ))}
        </div>
        <button type="button" onClick={onQuote} className="w-full cursor-pointer rounded-[11px] py-[11px] text-sm font-bold text-white shadow-[0_8px_18px_rgba(14,140,146,.28)]" style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}>
          {t('Get my quote →')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#FBFDFC]">
      {/* header */}
      <div className="flex items-center gap-2.5 border-b border-[#EEF4F3] bg-white px-4 py-[13px]">
        <div className="relative h-[34px] w-[34px] shrink-0">
          <div className="grid h-[34px] w-[34px] place-items-center rounded-[11px]" style={{ background: 'linear-gradient(140deg,#13A0A6,#0B5C63)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3l1.6 3.8L17.5 8l-3.9 1.2L12 13l-1.6-3.8L6.5 8l3.9-1.2L12 3Z" fill="#fff" />
            </svg>
          </div>
          <span className="absolute -bottom-px -right-px h-2.5 w-2.5 rounded-full border-2 border-white bg-[#3FD07A]" />
        </div>
        <div className="leading-[1.2]">
          <div className="text-sm font-extrabold text-ink">ZilAi</div>
          <div className="text-[11.5px] font-semibold text-teal">{typing ? t('planning…') : t('Local expert · online')}</div>
        </div>
        {stops.length > 0 && (
          <button type="button" onClick={onClear} aria-label={t('Start over')} className="ml-auto cursor-pointer rounded-[9px] border border-[#EEF4F3] bg-white px-[11px] py-1.5 text-xs font-semibold text-ink-muted">
            {t('Reset')}
          </button>
        )}
      </div>

      {/* body */}
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto p-4">
        {messages.length === 0 && !typing ? (
          <div className="m-auto max-w-[300px] py-5 text-center">
            <div className="mx-auto mb-3.5 grid h-[54px] w-[54px] place-items-center rounded-2xl border border-[#E3EEEC]" style={{ background: 'linear-gradient(140deg,#EAF7F5,#fff)' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" fill="#F76C5E" />
                <circle cx={18} cy={17} r={1.6} fill="#C98A12" />
                <circle cx={5.5} cy={15.5} r={1.2} fill="#0E8C92" />
              </svg>
            </div>
            <p className="m-0 mb-1 font-display text-[17px] font-semibold text-ink">{t('Plan your day with me')}</p>
            <p className="m-0 text-[13.5px] leading-[1.5] text-ink-muted">
              {t('Describe it above, tap a starter, or browse places — I’ll build the route and keep the price live.')}
            </p>
            <button type="button" onClick={onBrowse} className="mt-3.5 cursor-pointer rounded-[11px] border border-[#E3EEEC] bg-white px-4 py-[9px] text-[13px] font-bold text-teal-dark">
              {t('Or browse places')}
            </button>
          </div>
        ) : null}

        {messages.map((m, i) => {
          if (m.kind === 'place') return placeCard(m.id, m.why, i);
          if (m.kind === 'summary') return summaryCard(i);
          const isU = m.role === 'user';
          return (
            <div
              key={i}
              className={`max-w-[84%] animate-float-in px-[13px] py-2.5 text-[13.5px] font-medium leading-[1.5] ${
                isU
                  ? 'self-end rounded-[16px_16px_4px_16px] bg-ink text-white shadow-[0_6px_16px_rgba(10,46,54,.16)]'
                  : 'self-start rounded-[4px_16px_16px_16px] border border-[#EAF2F1] bg-white text-ink shadow-[0_4px_14px_rgba(10,46,54,.05)]'
              }`}
            >
              {m.text}
            </div>
          );
        })}

        {typing && (
          <div className="flex gap-[5px] self-start rounded-[4px_16px_16px_16px] border border-[#EAF2F1] bg-white px-[15px] py-3 shadow-[0_4px_14px_rgba(10,46,54,.05)]">
            {[0, 1, 2].map((d) => (
              <span key={d} className="h-[7px] w-[7px] rounded-full bg-teal" style={{ animation: `blink 1.1s ${d * 0.16}s infinite ease-in-out` }} />
            ))}
          </div>
        )}
      </div>

      {/* boost */}
      {boost && (
        <div className="mx-3.5 mb-1.5 flex animate-float-in items-start gap-2.5 rounded-[13px] border border-[#F3DCA6] bg-[#FFF8EC] px-3 py-[11px]">
          <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-gold-light">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 9v4m0 3h.01M10.3 4l-7 12a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0Z" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div className="flex-1">
            <p className="m-0 mb-2 text-[12.5px] font-semibold leading-[1.45] text-[#7A5A12]">
              <strong>{t('{place} closes at {time}.', { place: boost.place, time: boost.close })}</strong>{' '}
              {t('It’s late in your order — want me to move it earlier?')}
            </p>
            <div className="flex gap-[7px]">
              <button type="button" onClick={onApplyBoost} className="cursor-pointer rounded-lg bg-gold px-3 py-1.5 text-xs font-bold text-white">
                {t('Yes, reorder')}
              </button>
              <button type="button" onClick={onDismissBoost} className="cursor-pointer rounded-lg border border-[#E7D3A0] bg-white px-3 py-1.5 text-xs font-bold text-[#7A5A12]">
                {t('Keep as is')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* input */}
      <div className="border-t border-[#EEF4F3] bg-white px-3.5 pb-3 pt-2.5">
        {hasBuilt && (
          <div className="mb-[9px] flex flex-wrap gap-[7px]">
            {REPLY_CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => onSend(c)} className="cursor-pointer rounded-full border border-[#E3EEEC] bg-teal-tint px-[11px] py-1.5 text-xs font-semibold text-teal-dark">
                {t(c)}
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(draft);
          }}
          className="flex items-center gap-2 rounded-[14px] border border-[#E6EFEE] bg-[#F4F8F7] py-[5px] pl-[13px] pr-[5px]"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('Message ZilAi…')}
            aria-label={t('Message ZilAi')}
            className="min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none"
          />
          <button type="button" aria-label={t('Voice input')} className="grid cursor-pointer place-items-center p-1.5">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" stroke="#51666B" strokeWidth={1.8} />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="#51666B" strokeWidth={1.8} strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="submit"
            aria-label={t('Send message')}
            className="grid h-[38px] w-[38px] shrink-0 cursor-pointer place-items-center rounded-[11px]"
            style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </form>

        {/* AI disclaimer — ZilAi is a generative assistant; estimates can be wrong and free text shouldn't
            carry personal data. Links to the policies + a plain-language "how it works" explainer. */}
        <p className="mt-2 px-0.5 text-center text-[10.5px] leading-[1.5] text-ink-muted">
          {t('ZilAi is AI — it can be inaccurate. Don’t share personal data.')}{' '}
          <Link href="/terms" className="underline hover:text-teal">
            {t('Terms')}
          </Link>
          {' · '}
          <Link href="/privacy" className="underline hover:text-teal">
            {t('Privacy')}
          </Link>
          {' · '}
          <Link href="/cookies" className="underline hover:text-teal">
            {t('Cookies')}
          </Link>
          {' · '}
          <Link href="/ai-road-trip-planner#how-zilai-works" className="underline hover:text-teal">
            {t('How ZilAi works')}
          </Link>
        </p>
      </div>
    </div>
  );
}
