'use client';
import { useEffect, useState, useCallback } from 'react';

export type NoteType = 'secured' | 'expiring' | 'expired' | 'unavailable' | 'error';
export interface Note {
  id: string;
  type: NoteType;
  /** The text as pushed. The Updates panel words a note from its `type` (so it reads in the visitor's
   *  language); this is the fallback body, and the only text an older note carries. */
  message: string;
  createdAt: number;
  read: boolean;
  /** The trip it is about (the activity's title), shown in bold. */
  subject?: string;
  /** ms epoch the held places lapse — drives the countdown. */
  expiresAt?: number;
  /** The server holds a `secured` note is about. "Pay now" shows only while one is still held in the
   *  cart: paying, removing the line or a release all drop it, and a stale timer must not read as
   *  "you still owe". */
  holdIds?: string[];
  /** Where its action goes: the cart for a live hold, the activity page to book again. */
  href?: string;
}

/** The optional detail a caller can attach to a note. */
export type NoteExtra = Pick<Note, 'subject' | 'expiresAt' | 'holdIds' | 'href'>;

/** How long a checkout hold lasts — the deadline of an older `secured` note that carries none. */
export const HOLD_MS = 30 * 60 * 1000;

const KEY = 'gytm:inbox';
const EVENT = 'gytm:inbox';
const CAP = 20;

export function addNote(notes: Note[], n: Note): Note[] {
  if (notes.some((x) => x.id === n.id)) return notes;
  return [n, ...notes];
}
export function capNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt).slice(0, CAP);
}
export function unreadCount(notes: Note[]): number {
  return notes.filter((n) => !n.read).length;
}

function read(): Note[] {
  if (typeof window === 'undefined') return [];
  try {
    return capNotes(JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Note[]);
  } catch {
    return [];
  }
}
function write(notes: Note[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(capNotes(notes)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* private mode — ignore */
  }
}

/** Imperative push (callable outside React, e.g. from the cart reconcile). De-dupes by id. */
export function pushNotification(
  type: NoteType,
  message: string,
  id?: string,
  extra?: NoteExtra,
): void {
  if (typeof window === 'undefined') return;
  const n: Note = {
    id: id ?? `${type}:${message}:${Date.now()}`,
    type,
    message,
    createdAt: Date.now(),
    read: false,
    ...extra,
  };
  write(addNote(read(), n));
}

export function useInbox() {
  const [notes, setNotes] = useState<Note[]>([]);
  useEffect(() => {
    const sync = () => setNotes(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const markAllRead = useCallback(() => write(read().map((n) => ({ ...n, read: true }))), []);
  const clear = useCallback(() => write([]), []);
  return { notes, unread: unreadCount(notes), markAllRead, clear };
}

// ── Reading a note for the Updates panel (pure, unit-tested) ─────────────────────────────────────

/** The English tails useCart used to bake into a message, before notes carried a `subject`. */
const LEGACY_TAILS = [' — your held spot expired', ' — no longer available'];

/** The trip a note is about: its own `subject`, or the title an older note baked into its message. */
export function noteSubject(n: Note): string | null {
  if (n.subject?.trim()) return n.subject.trim();
  for (const tail of LEGACY_TAILS) {
    if (n.message.endsWith(tail)) {
      const title = n.message.slice(0, -tail.length).trim();
      return title || null;
    }
  }
  return null;
}

/** When a hold note's places lapse; an older note without one ran on the standard 30 minutes. */
export function noteDeadline(n: Note): number | null {
  if (n.type !== 'secured' && n.type !== 'expiring') return null;
  if (typeof n.expiresAt === 'number' && Number.isFinite(n.expiresAt)) return n.expiresAt;
  return n.createdAt + HOLD_MS;
}

/**
 * Whether a hold note still asks the guest to pay: its deadline is ahead AND one of its holds is still
 * held in the cart. An older note with no hold ids counts as live only while the cart holds anything.
 */
export function isHoldLive(n: Note, now: number, heldHoldIds: ReadonlySet<string>): boolean {
  const deadline = noteDeadline(n);
  if (deadline == null || deadline <= now) return false;
  if (n.holdIds && n.holdIds.length > 0) return n.holdIds.some((id) => heldHoldIds.has(id));
  return heldHoldIds.size > 0;
}

export type InboxFilter = 'all' | 'action' | 'bookings';

/** "Action needed" = a hold still waiting on payment. "Bookings" = every note about a trip, which with
 *  today's note types is everything except connection errors. */
export function matchesFilter(n: Note, filter: InboxFilter, live: boolean): boolean {
  if (filter === 'action') return live;
  if (filter === 'bookings') return n.type !== 'error';
  return true;
}

/** "28:04" — the time left on a hold in whole seconds, never negative; hours only when there are any. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${sec}`
    : `${String(m).padStart(2, '0')}:${sec}`;
}
