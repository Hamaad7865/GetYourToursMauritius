/**
 * Saved planner conversations, so a visitor can pick an old chat back up.
 *
 * Everything lives in the visitor's own `localStorage`: the planner is public and unauthenticated,
 * a plan is worth nothing to anyone else, and a server-side store would mean an account, a table and
 * an RLS policy for what is really a browser convenience. The URL already carries the *plan*
 * (`?from&to&dN…`); this carries the *conversation* plus the resolved places, which the URL can't —
 * a restored day whose Google places aren't in the catalogue renders as an empty map.
 *
 * The pure functions here (serialize, upsert, prune, title) hold the logic and are unit-tested; the
 * three storage wrappers at the bottom are thin and fail silently, because Safari private mode,
 * disabled storage and a full quota must never take the planner down with them.
 */
import type { ChatMsg } from './chat';
import type { TripDayPlan } from './trip';
import type { PlannerPlace } from '@/lib/validation/planner';

/** Where the planner stores its saved chats. Versioned: a shape change starts a clean shelf rather
 *  than trying to migrate a visitor's browser. */
export const HISTORY_KEY = 'bmt:planner:chats:v1';
/** How many conversations we keep. Enough to find "the one from yesterday", small enough to browse. */
export const MAX_SAVED_CHATS = 6;
/** Total budget for the shelf. localStorage is ~5 MB per origin and shared with the rest of the site,
 *  so the planner takes a small, predictable slice of it. */
export const MAX_HISTORY_BYTES = 400_000;

/** Everything needed to put a visitor back where they left off. */
export interface PlannerSnapshot {
  chat: ChatMsg[];
  /** Single-day mode's ordered stops (empty in trip mode). */
  stopIds: string[];
  /** Trip mode's days, or null for the classic single day. */
  days: TripDayPlan[] | null;
  /** Every place the chat, day or trip refers to — the map can't draw a stop it can't resolve. */
  places: PlannerPlace[];
  pickup: { id: string; name: string; lat: number; lng: number };
  dropoff: { id: string; name: string; lat: number; lng: number } | null;
}

export interface SavedChat {
  id: string;
  /** Epoch ms, stamped by the caller (keeps this module free of clock reads). */
  savedAt: number;
  title: string;
  snapshot: PlannerSnapshot;
}

/** The first thing the visitor actually asked, which is what makes one saved chat recognisable from
 *  another. Falls back to the shape of the plan when they only clicked around. */
export function snapshotTitle(snapshot: PlannerSnapshot): string {
  const asked = snapshot.chat.find((m) => m.kind === 'text' && m.role === 'user');
  if (asked && asked.kind === 'text') {
    const text = asked.text.trim().replace(/\s+/g, ' ');
    if (text) return text.length > 68 ? `${text.slice(0, 67)}…` : text;
  }
  if (snapshot.days?.length) return `${snapshot.days.length}-day trip`;
  const first = snapshot.places.find((p) => p.id === snapshot.stopIds[0]);
  if (first) return `Day out — ${first.name}`;
  return 'Planning session';
}

/** True when a snapshot holds enough to be worth saving (and worth showing in the list). */
export function isWorthSaving(snapshot: PlannerSnapshot): boolean {
  return hasVisitorTurn(snapshot) || planSignature(snapshot.stopIds, snapshot.days) !== '';
}

/** Whether the visitor has actually said something, as opposed to only being shown things. */
export function hasVisitorTurn(snapshot: PlannerSnapshot): boolean {
  return snapshot.chat.some((m) => m.kind === 'text' && m.role === 'user');
}

/**
 * A stable fingerprint of the plan, used to tell "they changed something" from "they only opened a
 * shared link". Without it every reload of a `?stops=…` URL mints another chatless entry, and the
 * shelf fills with copies of one plan while the real conversations fall off the end.
 */
export function planSignature(stopIds: string[], days: TripDayPlan[] | null): string {
  if (days) {
    return days
      .filter((d) => d.stopIds.length || d.dinnerId || d.activitySlug)
      .map((d) => `${d.date}:${d.stopIds.join(',')}:${d.dinnerId ?? ''}:${d.activitySlug ?? ''}`)
      .join('|');
  }
  return stopIds.join(',');
}

/** Put `entry` at the head of the shelf, replacing any earlier save of the SAME session (the current
 *  chat is saved over and over as it grows — it must occupy one slot, not fill the shelf). */
export function upsertChat(
  list: SavedChat[],
  entry: SavedChat,
  max: number = MAX_SAVED_CHATS,
): SavedChat[] {
  return [entry, ...list.filter((c) => c.id !== entry.id)].slice(0, max);
}

/** Drop the oldest entries until the serialized shelf fits the byte budget. The newest is always
 *  kept — a single oversized chat is still the one the visitor is having right now. */
export function pruneToBudget(
  list: SavedChat[],
  maxBytes: number = MAX_HISTORY_BYTES,
): SavedChat[] {
  const kept = [...list];
  while (kept.length > 1 && JSON.stringify(kept).length > maxBytes) kept.pop();
  return kept;
}

/** Parse the stored shelf defensively: anything hand-edited, truncated or written by an older build
 *  is discarded entry by entry rather than throwing the whole history away. */
export function parseSavedChats(raw: string | null): SavedChat[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: SavedChat[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Partial<SavedChat>;
    const s = c.snapshot as Partial<PlannerSnapshot> | undefined;
    if (typeof c.id !== 'string' || typeof c.savedAt !== 'number' || !s) continue;
    if (!Array.isArray(s.chat) || !Array.isArray(s.places) || !Array.isArray(s.stopIds)) continue;
    if (!s.pickup || typeof s.pickup !== 'object') continue;
    out.push({
      id: c.id,
      savedAt: c.savedAt,
      title: typeof c.title === 'string' && c.title ? c.title : 'Planning session',
      snapshot: {
        chat: s.chat as ChatMsg[],
        stopIds: s.stopIds as string[],
        days: Array.isArray(s.days) ? (s.days as TripDayPlan[]) : null,
        places: s.places as PlannerPlace[],
        pickup: s.pickup as PlannerSnapshot['pickup'],
        dropoff: (s.dropoff as PlannerSnapshot['dropoff']) ?? null,
      },
    });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}

/** "Just now" / "2h ago" / "Tue 12 Aug" — a saved chat is found by when it happened. */
export function relativeSavedAt(savedAt: number, now: number): string {
  const mins = Math.round((now - savedAt) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ── storage (browser only; every path fails silently) ───────────────────────────────────────────

export function loadSavedChats(): SavedChat[] {
  if (typeof window === 'undefined') return [];
  try {
    return parseSavedChats(window.localStorage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

/** Save (or re-save) one session. Returns the shelf as stored, so the caller can render it. */
export function persistChat(entry: SavedChat): SavedChat[] {
  if (typeof window === 'undefined') return [];
  const next = pruneToBudget(upsertChat(loadSavedChats(), entry));
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* quota or disabled storage — the session simply isn't remembered */
  }
  return next;
}

export function deleteSavedChat(id: string): SavedChat[] {
  if (typeof window === 'undefined') return [];
  const next = loadSavedChats().filter((c) => c.id !== id);
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* nothing more we can do; the list the caller renders is still correct */
  }
  return next;
}
