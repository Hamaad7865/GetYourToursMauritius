'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { parseApiJson } from '@/lib/http/fetch-json';
import { IconBell } from '@/components/ui/icons';

interface FeedNote {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

const POLL_MS = 60_000;

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Back-office notification bell: polls the signed-in staff user's DB feed (the
 * `admin_new_booking` rows the booking trigger writes for every staff profile) and lists the
 * latest alerts. Opening the panel marks everything read; clicking an alert jumps to the booking.
 */
export function AdminBell() {
  const router = useRouter();
  const { session } = useAuth();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<FeedNote[] | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const authHeaders = useCallback(
    (): Record<string, string> =>
      session ? { authorization: `Bearer ${session.access_token}` } : {},
    [session],
  );

  const refreshCount = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch('/api/v1/notifications/unread-count', { headers: authHeaders() });
      const body = await parseApiJson<{ count: number }>(res);
      if (body.ok) setUnread(body.data.count);
    } catch {
      /* transient — the next poll retries */
    }
  }, [session, authHeaders]);

  // Poll the badge (and refresh when the tab regains focus — the moment the owner looks).
  useEffect(() => {
    void refreshCount();
    const timer = setInterval(() => void refreshCount(), POLL_MS);
    const onFocus = () => void refreshCount();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshCount]);

  // Close on an outside click; Escape closes AND returns focus to the trigger (the widget
  // popovers set this precedent — a dropped focus strands keyboard users).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || !session) return;
    try {
      // Fetch enough to COVER the unread count (up to the API cap) before marking all read —
      // otherwise alerts #11+ get flipped read without ever being rendered.
      const pageSize = Math.min(Math.max(10, unread), 50);
      const res = await fetch(`/api/v1/notifications?page=1&pageSize=${pageSize}`, {
        headers: authHeaders(),
      });
      const body = await parseApiJson<FeedNote[]>(res);
      setNotes(body.ok ? body.data : []);
      // Opening the panel is "seeing" the alerts — clear the badge (best-effort).
      if (unread > 0) {
        await fetch('/api/v1/notifications/read-all', { method: 'POST', headers: authHeaders() });
        setUnread(0);
      }
    } catch {
      setNotes([]);
    }
  }

  function openNote(n: FeedNote) {
    const ref = n.data && typeof n.data.ref === 'string' ? n.data.ref : null;
    setOpen(false);
    if (ref) router.push(`/admin/bookings?q=${encodeURIComponent(ref)}`);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => void toggle()}
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-haspopup="true"
        aria-controls="admin-bell-panel"
        aria-expanded={open}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-muted transition-colors hover:border-[#C2CED1] hover:text-ink motion-reduce:transition-none"
      >
        <IconBell width={18} height={18} />
        {/* The count, not just a dot: how many is information. Coral-dark, so the white figure on it
            reads (5.97:1; the brand coral manages 2.89:1). */}
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-coral-dark px-1 text-[10.5px] font-bold text-white ring-2 ring-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          id="admin-bell-panel"
          className="absolute right-0 top-[calc(100%+8px)] z-40 w-[320px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-white shadow-[0_12px_30px_rgba(10,46,54,0.14)]"
        >
          <div className="flex min-h-[46px] items-center border-b border-line-soft px-4 text-[13.5px] font-bold text-ink">
            Notifications
          </div>
          {notes === null ? (
            <p className="px-4 py-5 text-center text-[13px] text-ink-soft">Loading…</p>
          ) : notes.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] text-ink-soft">No notifications yet</p>
          ) : (
            <ul className="max-h-80 overflow-auto [&>li:last-child>button]:border-b-0">
              {notes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => openNote(n)}
                    className={`w-full border-b border-line-soft px-4 py-[11px] text-left transition-colors hover:bg-[#FAFBFB] motion-reduce:transition-none ${
                      n.readAt ? '' : 'bg-teal-tint'
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={`text-[13px] text-ink ${n.readAt ? 'font-semibold' : 'font-bold'}`}
                      >
                        {n.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-ink-soft">
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">
                      {n.body}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
