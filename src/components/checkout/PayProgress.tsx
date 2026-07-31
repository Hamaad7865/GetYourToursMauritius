'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { percentFor, stageSpec, type PayStage } from '@/lib/checkout/pay-progress';

/** How often the ring is repainted. 100ms is smooth to the eye and cheap — this runs during a wait
 *  where the main thread is otherwise idle, waiting on the network. */
const TICK_MS = 100;

const STAGE_LABELS: Record<PayStage, string> = {
  booking: 'Confirming your booking',
  session: 'Opening a secure payment session',
  form: 'Loading the secure card form',
};

/**
 * The wait between "Pay" and a usable card form, made legible.
 *
 * Customers were watching a silent spinner for anywhere from 3 to 20+ seconds with no indication
 * that anything was happening — the failure mode that makes people click Pay twice. The percentage
 * comes from `pay-progress.ts`, which advances on REAL milestones and eases within each one, so a
 * slow provider decelerates the ring rather than freezing it.
 *
 * It reaches 100% only when `done` is set by the caller that can actually see the card form.
 */
export function PayProgress({
  stage,
  resumed = false,
  done = false,
  startPercent = 0,
  variant = 'overlay',
}: {
  /** Current milestone, or null to render nothing. */
  stage: PayStage | null;
  /** True when this stage continues a hand-off from the previous page (see savePayHandoff). */
  resumed?: boolean;
  /** Set by whoever can observe the end state — for the pay page, the card iframe having loaded. */
  done?: boolean;
  /** Position carried across a navigation, so the bar continues instead of restarting at zero. */
  startPercent?: number;
  variant?: 'overlay' | 'inline';
}) {
  const t = useT();
  const [percent, setPercent] = useState(startPercent);
  // Where this stage started, and the floor it must never drop below — together they guarantee the
  // ring only ever moves forward, including across a stage change or a resumed hand-off.
  const stageStart = useRef<number>(Date.now());
  const floor = useRef(startPercent);
  const lastStage = useRef<PayStage | null>(null);

  // `startPercent` is now read by the caller AFTER hydration (it comes from sessionStorage, which the
  // server cannot see — see EmbeddedCheckout), so it arrives as a PROP CHANGE rather than being
  // present at mount. Without this it would be captured once as 0 and the resumed position silently
  // lost. Monotonic by construction: the ring may only ever be pulled forward, never back.
  useEffect(() => {
    setPercent((p) => Math.max(p, startPercent));
    floor.current = Math.max(floor.current, startPercent);
  }, [startPercent]);

  useEffect(() => {
    if (!stage) return;
    if (lastStage.current !== stage) {
      lastStage.current = stage;
      stageStart.current = Date.now();
      floor.current = percent;
    }
  }, [stage, percent]);

  useEffect(() => {
    if (!stage || done) return;
    const spec = stageSpec(stage, resumed);
    const tick = () => setPercent(percentFor(spec, Date.now() - stageStart.current, floor.current));
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [stage, resumed, done]);

  // Completion is the one jump that is allowed to skip ahead: the card form is on screen, so 100% is
  // the literal truth. Held briefly so the customer sees it land rather than having it vanish at 87%.
  useEffect(() => {
    if (done) setPercent(100);
  }, [done]);

  if (!stage) return null;

  const shown = Math.round(percent);
  const label = done ? t('Ready') : t(STAGE_LABELS[stage]);

  const ring = (
    <div className="flex flex-col items-center gap-4">
      <ProgressRing percent={percent} value={shown} label={label} />
      <div className="text-center">
        <p className="text-sm font-bold text-ink">{label}</p>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          {t('Please don’t close this page or press back.')}
        </p>
      </div>
    </div>
  );

  if (variant === 'inline') {
    return <div className="flex w-full justify-center py-10">{ring}</div>;
  }

  return (
    <div
      // Covers the page so a second click can't start a second attempt mid-flight. Not marked as a
      // dialog: there is nothing to interact with and no focus to trap, and claiming a modal role
      // without managing focus is worse for screen readers than a plain live region.
      className="fixed inset-0 z-50 flex items-center justify-center bg-white/85 px-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-xs rounded-2xl border border-ink/10 bg-white p-7 shadow-[0_24px_60px_-30px_rgba(10,46,54,0.55)]">
        {ring}
      </div>
    </div>
  );
}

/** Circular determinate progress: an arc that fills to `percent`, with the number in the middle. */
function ProgressRing({
  percent,
  value,
  label,
}: {
  percent: number;
  value: number;
  label: string;
}) {
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, percent)) / 100);

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      // Screen readers announce the meaning, not just a bare number.
      aria-valuetext={`${value}% — ${label}`}
      className="relative h-24 w-24"
    >
      <svg viewBox="0 0 80 80" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="40" cy="40" r={radius} fill="none" strokeWidth="6" className="stroke-ink/10" />
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-teal transition-[stroke-dashoffset] duration-150 ease-linear"
        />
      </svg>
      {/* The rotating accent is decoration only — the arc above carries the information, so
          reduced-motion users lose nothing by it being switched off. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-1 animate-spin rounded-full border-2 border-transparent border-t-teal/30 motion-reduce:animate-none motion-reduce:border-t-transparent"
      />
      <span className="absolute inset-0 flex items-center justify-center font-display text-xl font-semibold text-ink">
        {value}%
      </span>
    </div>
  );
}
