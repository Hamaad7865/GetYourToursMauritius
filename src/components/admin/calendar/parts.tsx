'use client';

import type { CSSProperties, ReactNode } from 'react';
import { LINE_TYPES, type LineType } from '@/lib/admin/calendar-view';

/* Small shared pieces of the operations calendar: its icons (the prototype's own strokes, which the
 * shared icon set lacks), the type dot, the amber/red tags and the toast. */

export const ICON = {
  pin: 'M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  plane:
    'M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z',
  users: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  alert:
    'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  chevronDown: 'M6 9l6 6 6-6',
  close: 'M18 6L6 18M6 6l12 12',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
  phone:
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  message:
    'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  move: 'M8 2v4M16 2v4M3 10h18M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8M16 18h6M19 15l3 3-3 3',
  callOff: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
} as const;

export function Ic({
  d,
  size = 16,
  stroke = 2,
  className,
  style,
}: {
  d: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <path d={d} />
    </svg>
  );
}

export function TypeDot({ type, size = 8 }: { type: LineType; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, background: LINE_TYPES[type].dot }}
    />
  );
}

/** An amber "needs doing" tag, with the warning triangle. */
export function FlagTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[22px] items-center gap-[5px] rounded-md bg-[#fdf1de] px-2 text-[12px] font-semibold text-[#8f4c06]">
      <Ic d={ICON.alert} size={12} stroke={2.2} />
      {children}
    </span>
  );
}

export function CalledOffTag() {
  return (
    <span className="inline-flex h-[22px] items-center rounded-md bg-[#fdecea] px-2 text-[12px] font-semibold text-[#b42318]">
      Called off
    </span>
  );
}

export function QuoteTag() {
  return (
    <span className="inline-flex h-[22px] items-center rounded-md bg-[#eff3f3] px-2 text-[12px] font-semibold text-[#4a5a5d]">
      From quote
    </span>
  );
}

export interface ToastState {
  id: number;
  message: string;
  undo?: () => void;
  showDay?: () => void;
}

/** The dark confirmation toast, bottom centre, with Undo / Show day when there is something to do. */
export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[88px] left-1/2 z-[80] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2.5 rounded-xl bg-ink py-2.5 pl-[18px] pr-2.5 text-[13.5px] text-white shadow-[0_18px_40px_-12px_rgba(8,30,33,0.55)] lg:bottom-7"
    >
      <span className="min-w-0">{toast.message}</span>
      {toast.showDay && (
        <button
          type="button"
          onClick={() => {
            toast.showDay?.();
            onDismiss();
          }}
          className="h-[30px] shrink-0 rounded-lg px-3 text-[13px] font-semibold text-white hover:bg-white/10"
        >
          Show day
        </button>
      )}
      {toast.undo && (
        <button
          type="button"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
          className="h-[30px] shrink-0 rounded-lg bg-white/[0.12] px-3 text-[13px] font-bold text-[#7ee0d8] hover:bg-white/20"
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : '';
  return (first + last).toUpperCase();
}

/** "€1,240" — whole euros for figures; "€550.00" for a booking's own amount. */
export function euros(n: number, cents = false): string {
  return `€${n.toLocaleString('en-GB', {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })}`;
}
