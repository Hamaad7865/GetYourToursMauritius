'use client';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

import { responsiveImage } from '@/lib/images/resize';
import { PHOTO_CARD } from '@/lib/images/presets';
import { useState } from 'react';
import type { PhotographyOccasion } from '@/lib/catalogue/photography';
import type { V3Package } from './packages-data';

/** One serialized tab of the v3 packages section — already translated on the server. */
export interface V3PackageTab {
  id: 'shoots' | 'weddings';
  label: string;
  /** "from €X" — the cheapest live from-price in the group, null when quote-only. */
  fromLine: string | null;
}

/**
 * The v3 "What are we celebrating?" section: Photoshoots / Weddings tabs (each with its group's
 * from-price), occasion chips that filter the shoots tab, and the design's package cards. Live
 * packages link to their /activities/<slug> page; WhatsApp enquiry cards open in a new tab.
 */
export function PhotoPackagesSection({
  eyebrow,
  headingLead,
  headingAccent,
  tabs,
  occasions,
  weddingIntro,
  packages,
  labels,
}: {
  eyebrow: string;
  headingLead: string;
  headingAccent: string;
  tabs: V3PackageTab[];
  occasions: { id: PhotographyOccasion | 'all'; label: string }[];
  weddingIntro: string;
  packages: V3Package[];
  labels: {
    mostBooked: string;
    from: string;
    priceOnRequest: string;
    checkDates: string;
  };
}) {
  const [tab, setTab] = useState<V3PackageTab['id']>('shoots');
  const [occasion, setOccasion] = useState<PhotographyOccasion | 'all'>('all');

  const visible = packages.filter(
    (p) =>
      p.group === tab &&
      (tab === 'weddings' || occasion === 'all' || p.occasions.includes(occasion)),
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal">{eyebrow}</p>
          <h2 className="text-balance text-[clamp(32px,4vw,50px)] font-bold leading-[1.05] tracking-[-0.03em] text-ink">
            {headingLead} <em className="not-italic text-teal">{headingAccent}</em>
          </h2>
        </div>
        <div
          role="tablist"
          aria-label={tabs.map((t) => t.label).join(' / ')}
          className="flex max-w-full gap-1 rounded-full border border-ink/10 bg-[#F5F7F7] p-[5px]"
        >
          {tabs.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(t.id)}
                className={`flex flex-wrap items-baseline justify-center gap-x-2 rounded-full px-5 py-3 transition ${
                  on
                    ? 'bg-white shadow-[0_1px_2px_rgba(10,46,54,0.08),0_6px_16px_-8px_rgba(10,46,54,0.28)]'
                    : ''
                }`}
              >
                <span className={`text-base font-bold ${on ? 'text-ink' : 'text-ink-muted'}`}>
                  {t.label}
                </span>
                {t.fromLine && (
                  <span
                    className={`text-[13px] font-semibold ${on ? 'text-teal-dark' : 'text-ink-muted'}`}
                  >
                    {t.fromLine}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'weddings' ? (
        <p className="max-w-[640px] text-base leading-relaxed text-ink-muted">{weddingIntro}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {occasions.map((o) => {
            const on = occasion === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => setOccasion(o.id)}
                aria-pressed={on}
                className={`rounded-full border-[1.5px] px-4 py-2.5 text-sm font-semibold transition ${
                  on
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/10 bg-white text-ink hover:border-ink/30'
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-5">
        {visible.map((p) => {
          const body = (
            <>
              <div className="relative h-[210px] bg-teal-tint">
                <img
                  {...responsiveImage(p.image, PHOTO_CARD)}
                  alt={p.imageAlt}
                  loading="lazy"
                  className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                />
                {p.bestSeller && (
                  <span className="absolute left-3.5 top-3.5 rounded-full bg-coral px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
                    {labels.mostBooked}
                  </span>
                )}
              </div>
              <div className="flex flex-1 cursor-pointer flex-col gap-3.5 p-[22px] text-left">
                {(p.durationLabel || p.peopleLabel) && (
                  <div className="flex items-center justify-between gap-3 text-[13px] font-semibold text-ink-muted">
                    <span>{p.durationLabel ?? ''}</span>
                    <span className="text-right">{p.peopleLabel ?? ''}</span>
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-[21px] font-bold leading-[1.2] tracking-[-0.015em] text-ink">
                    {p.title}
                  </h3>
                  {p.summary && (
                    <p className="line-clamp-3 text-sm leading-relaxed text-ink-muted">
                      {p.summary}
                    </p>
                  )}
                </div>
                {p.bullets.length > 0 && (
                  <ul className="flex flex-col gap-2 text-sm leading-snug text-ink">
                    {p.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-2.5">
                        <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-teal" />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-ink-muted">{labels.from}</span>
                    <span className="text-[26px] font-bold tracking-[-0.02em] text-ink">
                      {p.priceEur != null
                        ? `€${Math.round(p.priceEur).toLocaleString('en-GB')}`
                        : labels.priceOnRequest}
                    </span>
                  </div>
                  <span className="rounded-full bg-ink px-[18px] py-3 text-sm font-bold text-white transition group-hover:bg-teal">
                    {labels.checkDates}
                  </span>
                </div>
              </div>
            </>
          );
          const cls =
            'group flex flex-col overflow-hidden rounded-[18px] border border-ink/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05)] transition hover:-translate-y-1 hover:shadow-[0_18px_38px_-16px_rgba(10,46,54,0.4)] focus-visible:outline-teal-dark';
          return p.external ? (
            <a
              key={p.key}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              className={cls}
              aria-label={p.title}
            >
              {body}
            </a>
          ) : (
            <a key={p.key} href={p.href} className={cls}>
              {body}
            </a>
          );
        })}
      </div>
    </>
  );
}
