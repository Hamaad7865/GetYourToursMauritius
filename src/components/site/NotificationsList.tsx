'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from '@/components/site/LocaleLink';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import {
  formatCountdown,
  isHoldLive,
  matchesFilter,
  noteDeadline,
  noteSubject,
  type InboxFilter,
  type Note,
} from '@/lib/notifications/inbox';
import { CART_EVENT, heldHoldIds } from '@/lib/cart/useCart';
import { formatRelativeTime } from '@/lib/i18n/format';
import {
  IconArrowRight,
  IconBell,
  IconBookings,
  IconCalendar,
  IconChevronLeft,
  IconClock,
  IconInfo,
} from '@/components/ui/icons';

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Action needed' },
  { id: 'bookings', label: 'Bookings' },
];

/** A held place has under this long left: the countdown turns red. */
const HURRY_MS = 5 * 60 * 1000;

/** The clock the cards read: every second while a hold is counting down, otherwise every 30s (enough
 *  for "2 min ago"). */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Hold ids still held in the cart, kept current as the cart changes (this tab or another). */
function useHeldHoldIds(): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const sync = () => setIds(heldHoldIds());
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CART_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return ids;
}

/**
 * The Updates inbox, shared by the profile dropdown, the mobile menu and /account/notifications.
 *
 * Opening it is "seeing" the updates: anything unread is marked read straight away, so the badge on
 * the profile button clears as before. The ones that were unread when it opened stay grouped under
 * "New" (and dotted) for as long as it stays open.
 */
export function UpdatesInbox({
  notes,
  unread,
  markAllRead,
  onBack,
  onClear,
  onNavigate,
  seeAllHref,
  showTitle = true,
  variant = 'popover',
}: {
  notes: Note[];
  unread: number;
  markAllRead: () => void;
  /** Popover only: back to the account menu. */
  onBack?: () => void;
  /** Full page only: empty the inbox. */
  onClear?: () => void;
  /** A card's link was followed — the popover/menu closes. */
  onNavigate?: () => void;
  /** The "See all updates" footer link. */
  seeAllHref?: string;
  showTitle?: boolean;
  variant?: 'popover' | 'page';
}) {
  const t = useT();
  const [filter, setFilter] = useState<InboxFilter>('all');

  // Unread when first seen during this visit. Collected during render, so a note marked read by the
  // effect below (or that only arrives after the first render, as on the full page) stays "New".
  const fresh = useRef(new Set<string>());
  for (const n of notes) if (!n.read) fresh.current.add(n.id);
  useEffect(() => {
    if (unread > 0) markAllRead();
  }, [unread, markAllRead]);

  const counting = notes.some((n) => {
    const deadline = noteDeadline(n);
    return deadline != null && deadline > Date.now();
  });
  const now = useNow(counting ? 1000 : 30_000);
  const held = useHeldHoldIds();

  const rows = notes.map((n) => ({
    n,
    live: isHoldLive(n, now, held),
    isNew: fresh.current.has(n.id),
  }));
  const visible = rows.filter((r) => matchesFilter(r.n, filter, r.live));
  const newRows = visible.filter((r) => r.isNew);
  const earlierRows = visible.filter((r) => !r.isNew);
  const newCount = rows.filter((r) => r.isNew).length;
  const popover = variant === 'popover';

  return (
    <div className="text-ink">
      {(showTitle || onBack || onClear || newCount > 0) && (
        <div className="flex items-center justify-between gap-2 px-1.5 pb-2.5 pt-1">
          <div className="flex min-w-0 items-center gap-1">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label={t('Back')}
                className="-ml-1 grid h-8 w-8 place-items-center rounded-full hover:bg-ink/5"
              >
                <IconChevronLeft width={18} height={18} />
              </button>
            )}
            {showTitle && <h2 className="text-[15px] font-bold">{t('Updates')}</h2>}
            {newCount > 0 && (
              <span className="ml-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-coral px-1.5 text-[11px] font-extrabold leading-none text-ink">
                {newCount}
                <span className="sr-only"> {t('new')}</span>
              </span>
            )}
          </div>
          {onClear && notes.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-[12.5px] font-bold text-teal-dark hover:text-ink"
            >
              {t('Clear all')}
            </button>
          )}
        </div>
      )}

      {notes.length === 0 ? (
        <EmptyInbox />
      ) : (
        <>
          <div role="group" aria-label={t('Show')} className="flex flex-wrap gap-1.5 px-1.5 pb-2">
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition ${
                    active
                      ? 'border-ink bg-ink text-white'
                      : 'border-ink/15 text-ink hover:border-ink/30'
                  }`}
                >
                  {t(f.label)}
                </button>
              );
            })}
          </div>

          <div
            className={popover ? 'max-h-[min(26rem,60vh)] overflow-y-auto overscroll-contain' : ''}
          >
            {visible.length === 0 ? (
              <p className="px-3 py-8 text-center text-[13px] text-ink-muted">
                {filter === 'action'
                  ? t('Nothing needs you right now.')
                  : t('No booking updates yet.')}
              </p>
            ) : (
              <>
                {newRows.length > 0 && (
                  <Group label={t('New')}>
                    {newRows.map((r) => (
                      <UpdateCard
                        key={r.n.id}
                        n={r.n}
                        live={r.live}
                        isNew
                        now={now}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </Group>
                )}
                {earlierRows.length > 0 && (
                  <Group label={t('Earlier')}>
                    {earlierRows.map((r) => (
                      <UpdateCard
                        key={r.n.id}
                        n={r.n}
                        live={r.live}
                        isNew={false}
                        now={now}
                        onNavigate={onNavigate}
                      />
                    ))}
                  </Group>
                )}
              </>
            )}
          </div>
        </>
      )}

      {seeAllHref && (
        <Link
          href={seeAllHref}
          onClick={onNavigate}
          className="mt-1 flex items-center justify-center gap-1.5 border-t border-ink/10 pb-1.5 pt-3 text-[13px] font-bold text-ink hover:text-teal-dark"
        >
          {t('See all updates')} <IconArrowRight width={15} height={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pb-2">
      <h3 className="px-1.5 pb-1.5 pt-2 text-[10.5px] font-bold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </section>
  );
}

function EmptyInbox() {
  const t = useT();
  return (
    <div className="px-4 py-8 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-teal-tint text-teal-dark">
        <IconBell width={20} height={20} />
      </span>
      <p className="mt-3 text-sm font-bold">{t('No updates yet')}</p>
      <p className="mx-auto mt-1 max-w-[16rem] text-[12.5px] leading-relaxed text-ink-muted">
        {t('We’ll let you know here when we hold places for you, and if a hold runs out.')}
      </p>
    </div>
  );
}

/** Title + body, worded from the note's type so it reads in the visitor's language. */
function useNoteCopy(n: Note, live: boolean, subject: string | null) {
  const t = useT();
  switch (n.type) {
    case 'secured':
    case 'expiring':
      return {
        title: n.type === 'secured' ? t('Spots secured') : t('Hold ending soon'),
        body: live
          ? t('Your places are held. Pay before the timer runs out to confirm the booking.')
          : t('Your places were held for 30 minutes.'),
      };
    case 'expired':
      return {
        title: t('Held spot expired'),
        body: subject
          ? t('payment wasn’t completed in time.')
          : t('A held spot expired before payment was completed.'),
      };
    case 'unavailable':
      return {
        title: t('No longer available'),
        // Without a trip name the pushed message is the whole story (already translated at push).
        body: subject ? t('it sold out or is no longer on sale.') : n.message,
      };
    default:
      return {
        title: t('Couldn’t reach the server'),
        body: t('Your cart is safe. Check your connection and try again.'),
      };
  }
}

function UpdateCard({
  n,
  live,
  isNew,
  now,
  onNavigate,
}: {
  n: Note;
  live: boolean;
  isNew: boolean;
  now: number;
  onNavigate?: () => void;
}) {
  const t = useT();
  const { language } = usePreferences();
  const subject = noteSubject(n);
  const copy = useNoteCopy(n, live, subject);
  const deadline = noteDeadline(n);
  const left = deadline != null ? deadline - now : 0;
  const isHold = n.type === 'secured' || n.type === 'expiring';

  return (
    <li
      className={`relative flex gap-3 rounded-2xl border p-3 pl-3.5 ${
        isNew ? 'border-teal/15 bg-teal-tint' : 'border-transparent hover:bg-ink/[0.03]'
      }`}
    >
      {isNew && (
        <span
          aria-hidden
          className="absolute left-1 top-[19px] h-1.5 w-1.5 rounded-full bg-coral"
        />
      )}
      <NoteIcon type={n.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[13.5px] font-bold leading-snug">{copy.title}</p>
          <time
            dateTime={new Date(n.createdAt).toISOString()}
            className="shrink-0 text-[11px] text-ink-muted"
          >
            {formatRelativeTime(n.createdAt, now, language)}
          </time>
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-ink/75">
          {subject && (
            <>
              {/* An activity title — DB content, never translated. */}
              <span className="font-bold text-ink">{subject}</span> ·{' '}
            </>
          )}
          {copy.body}
        </p>

        {isHold &&
          (live ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-bold tabular-nums ${
                  left < HURRY_MS ? 'bg-coral/10 text-coral-dark' : 'bg-gold-light/20 text-ink'
                }`}
              >
                <IconClock width={13} height={13} aria-hidden />
                {t('{time} left', { time: formatCountdown(left) })}
              </span>
              <Link
                href={n.href ?? '/cart'}
                onClick={onNavigate}
                className="inline-flex items-center rounded-full bg-teal-dark px-3.5 py-1.5 text-[12px] font-bold text-white transition hover:bg-ink"
              >
                {t('Pay now')}
              </Link>
            </div>
          ) : (
            <p className="mt-1.5 text-[11.5px] font-semibold text-ink-muted">{t('Hold ended')}</p>
          ))}

        {(n.type === 'expired' || n.type === 'unavailable') && (
          <Link
            href={n.href ?? '/activities'}
            onClick={onNavigate}
            className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-bold text-teal-dark hover:text-ink"
          >
            {n.type === 'expired' ? t('Book again') : t('Find another date')}
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </li>
  );
}

function NoteIcon({ type }: { type: Note['type'] }) {
  const base = 'grid h-9 w-9 shrink-0 place-items-center rounded-xl';
  if (type === 'secured' || type === 'expiring') {
    return (
      <span aria-hidden className={`${base} bg-teal-dark text-white`}>
        <IconBookings width={18} height={18} />
      </span>
    );
  }
  if (type === 'expired') {
    return (
      <span aria-hidden className={`${base} bg-ink/5 text-ink-muted`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
          <path d="M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (type === 'unavailable') {
    return (
      <span aria-hidden className={`${base} bg-coral/10 text-coral-dark`}>
        <IconCalendar width={18} height={18} />
      </span>
    );
  }
  return (
    <span aria-hidden className={`${base} bg-gold-light/20 text-ink`}>
      <IconInfo width={18} height={18} />
    </span>
  );
}
