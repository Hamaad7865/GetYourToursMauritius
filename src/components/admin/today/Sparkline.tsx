/*
 * The small trend line on Today's figure cards. Adapted from ObsidianUI's analytics dashboard
 * (components/analytics-dashboard/ui.tsx, `Sparkline`): the same quadratic smoothing through segment
 * midpoints and soft area fill, recoloured to the back office's tokens and with its reveal moved to
 * the shared `.bmt-spark-reveal` class (globals.css), which only moves for people who allow motion.
 *
 * MIT License
 *
 * Copyright (c) 2026 ObsidianUI
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
 * associated documentation files (the "Software"), to deal in the Software without restriction,
 * including without limitation the rights to use, copy, modify, merge, publish, distribute,
 * sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all copies or
 * substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
 * NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
 * OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
 * CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
'use client';

import { useId } from 'react';

/** Decorative only (aria-hidden): the card's own label, figure and line of text carry the meaning. */
export function Sparkline({
  data,
  tone = 'good',
  width = 132,
  height = 34,
  className = '',
}: {
  data: readonly number[];
  tone?: 'good' | 'bad';
  width?: number;
  height?: number;
  className?: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - 3 - ((v - min) / (max - min || 1)) * (height - 8),
  ]);
  // Quadratic smoothing through segment midpoints keeps the line soft without overshoot.
  let line = `M ${pts[0]![0]!.toFixed(1)} ${pts[0]![1]!.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const mx = (pts[i]![0]! + pts[i + 1]![0]!) / 2;
    const my = (pts[i]![1]! + pts[i + 1]![1]!) / 2;
    line += ` Q ${pts[i]![0]!.toFixed(1)} ${pts[i]![1]!.toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1]!;
  line += ` T ${last[0]!.toFixed(1)} ${last[1]!.toFixed(1)}`;
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
      className={`bmt-spark-reveal block w-full overflow-visible ${
        tone === 'good' ? 'text-teal' : 'text-coral'
      } ${className}`}
      style={{ height }}
    >
      <defs>
        <linearGradient id={`spark${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark${id})`} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r={2.8} fill="currentColor" />
    </svg>
  );
}
