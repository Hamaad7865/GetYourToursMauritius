'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { RollingNumber } from '@/components/admin/today/RollingNumber';
import { Sparkline } from '@/components/admin/today/Sparkline';

export type MetricTone = 'teal' | 'gold' | 'blue' | 'violet';

/** The icon tile's tint and ink. Each pair is AA as text (the *-dark inks on their own tints). */
const TONE: Record<MetricTone, string> = {
  teal: 'bg-teal-tint text-teal-dark',
  gold: 'bg-gold-tint text-gold-dark',
  blue: 'bg-blue-tint text-blue-dark',
  violet: 'bg-violet-tint text-violet-dark',
};

/**
 * Today's cards share one soft lift and the staggered rise (`.bmt-rise`, globals.css; still for anyone
 * who asks for reduced motion). Pass `--i` in a style for the card's place in the entrance.
 */
export const TODAY_LIFT =
  'bmt-rise shadow-[0_1px_2px_rgba(10,46,54,0.04),0_8px_24px_-12px_rgba(10,46,54,0.10)]';

/** "0", "€0", "0 guests": a quiet figure is set in a muted weight, so an empty day does not shout. */
function isZero(value: string): boolean {
  return /^[€]?0([.,]0+)?$/.test(value.trim());
}

/**
 * One of Today's figures, in the manner of ObsidianUI's analytics dashboard: an icon and label, the
 * figure rolling into place, a change pill only where a real comparison exists, one line of context,
 * and a trend line only where a real series exists. A linked card is one link (the whole card).
 */
export function MetricCard({
  label,
  value,
  detail,
  href,
  icon,
  tone,
  delta,
  deltaAgainst,
  spark,
  index,
  className = '',
}: {
  label: string;
  value: string;
  detail?: string;
  href?: string | null;
  icon: ReactNode;
  tone: MetricTone;
  /** A rounded % change, or null/undefined for none. */
  delta?: number | null;
  /** What the change compares against, for screen readers ("the 7 days before"). */
  deltaAgainst?: string;
  /** The values behind the trend line, oldest first; nothing is drawn for fewer than two or all zero. */
  spark?: readonly number[] | null;
  /** Its place in the row, for the staggered entrance. */
  index: number;
  className?: string;
}) {
  const up = (delta ?? 0) >= 0;
  const showSpark = Boolean(spark && spark.length >= 2 && spark.some((v) => v !== 0));
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-semibold text-ink-muted">
        <span
          aria-hidden="true"
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${TONE[tone]}`}
        >
          {icon}
        </span>
        <span className="min-w-0 leading-tight">{label}</span>
      </span>
      <span className="mt-3 flex items-end justify-between gap-2">
        <RollingNumber
          key={value}
          value={value}
          className={`text-[28px] font-bold tracking-[-0.025em] ${
            isZero(value) ? 'text-ink-soft' : 'text-ink'
          }`}
        />
        {delta !== null && delta !== undefined && (
          <span
            className={`mb-1 inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full pl-1.5 pr-2 text-[12px] font-semibold ${
              up ? 'bg-teal-tint text-teal-dark' : 'bg-coral-tint text-coral-dark'
            }`}
          >
            <svg
              viewBox="0 0 12 12"
              width={11}
              height={11}
              aria-hidden="true"
              className={up ? '' : 'rotate-180'}
            >
              <path
                d="M6 2.5v7M2.8 5.6 6 2.5l3.2 3.1"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="sr-only">{up ? 'Up' : 'Down'}</span>
            {Math.abs(delta)}%
            {deltaAgainst && <span className="sr-only"> against {deltaAgainst}</span>}
          </span>
        )}
      </span>
      {detail && <span className="mt-1 text-[12px] leading-snug text-ink-soft">{detail}</span>}
      {showSpark && (
        <span className="mt-auto block pt-3">
          <Sparkline data={spark!} tone={up ? 'good' : 'bad'} />
        </span>
      )}
    </>
  );
  const cls = `${TODAY_LIFT} flex min-w-0 flex-col rounded-xl border border-line bg-white px-4 pb-3.5 pt-3.5 ${className}`;
  const style = { '--i': index } as CSSProperties;
  return href ? (
    <Link
      href={href}
      style={style}
      className={`${cls} transition-[border-color,box-shadow] hover:border-[#C2CED1] hover:shadow-[0_1px_2px_rgba(10,46,54,0.05),0_12px_28px_-12px_rgba(10,46,54,0.18)] motion-reduce:transition-none`}
    >
      {body}
    </Link>
  ) : (
    <div style={style} className={cls}>
      {body}
    </div>
  );
}
