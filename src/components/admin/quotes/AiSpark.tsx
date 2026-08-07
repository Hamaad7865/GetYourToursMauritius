'use client';

import { useId } from 'react';

/**
 * The assistant's mark and its launcher, in GEMINI's own livery.
 *
 * The model behind "Draft from an enquiry" IS Gemini, so the entry point is drawn as Gemini's —
 * the four-point spark in Google's blue → purple → rose → amber gradient, on a quiet circular
 * button that blooms on hover exactly like the one in Gmail's toolbar. Staff recognise it
 * instantly, which is the whole point of borrowing a mark rather than inventing one.
 *
 * Scope: this is the ADMIN back office. Nothing here is customer-facing, so the app never presents
 * itself as Google to a guest — the brand teal still owns every customer surface and the rest of
 * this screen.
 */

/** Google's Gemini gradient, in order round the spark. */
const SPARK_STOPS = [
  { offset: '0%', color: '#4285F4' }, // blue
  { offset: '38%', color: '#9B72CB' }, // purple
  { offset: '72%', color: '#D96570' }, // rose
  { offset: '100%', color: '#F9AB00' }, // amber
];

/**
 * The four-point spark. Each `<svg>` mints its OWN gradient id (`useId`, stripped to id-safe
 * characters — React's raw value contains colons): two sparks on one screen sharing an id would
 * leave the second one filled by the first one's gradient, or unfilled entirely.
 */
export function GeminiSpark({ size = 18, className }: { size?: number; className?: string }) {
  const gradientId = `gemini-spark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          {SPARK_STOPS.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      {/* A four-fold symmetric star: concave quarter-arcs between four points. Rotating it 90°
          (the hover twinkle) therefore lands back on itself — the motion reads, the shape never
          appears to have moved. */}
      <path
        fill={`url(#${gradientId})`}
        d="M12 0c0 6.627-5.373 12-12 12 6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12C17.373 12 12 6.627 12 0z"
      />
    </svg>
  );
}

/**
 * The launcher: a quiet circular button that blooms — halo, lift, and a 90° twinkle of the spark —
 * on hover, with the label as a tooltip beneath it.
 *
 * The tooltip is decoration, not the accessible name: it is `aria-hidden` and the button carries the
 * same words as `aria-label`, so a screen reader hears the label once rather than twice. It appears
 * on keyboard focus as well as hover (`group-focus-within`), because a control whose only
 * explanation requires a mouse explains nothing to a keyboard user.
 */
export function AiSparkButton({
  label,
  expanded,
  onClick,
}: {
  /** What the button does, e.g. "Draft from an enquiry". The tooltip AND the accessible name. */
  label: string;
  /** Whether the panel it controls is open — announced via `aria-expanded`. */
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-expanded={expanded}
        className="ai-spark-btn relative grid h-10 w-10 place-items-center rounded-full border border-ink/10 bg-white"
      >
        <span className="ai-spark-halo" aria-hidden="true" />
        <GeminiSpark size={20} className="ai-spark-icon relative" />
      </button>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-[11.5px] font-semibold text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
