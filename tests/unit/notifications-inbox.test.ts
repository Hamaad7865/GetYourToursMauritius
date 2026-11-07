import { describe, expect, it } from 'vitest';
import {
  addNote,
  capNotes,
  formatCountdown,
  HOLD_MS,
  isHoldLive,
  matchesFilter,
  noteDeadline,
  noteSubject,
  unreadCount,
  type Note,
} from '@/lib/notifications/inbox';
import { formatRelativeTime } from '@/lib/i18n/format';

const note = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  type: 'expired',
  message: 'X expired',
  createdAt: 1,
  read: false,
  ...over,
});

describe('inbox helpers', () => {
  it('addNote prepends newest-first and dedupes by id', () => {
    const a = addNote([note({ id: 'n1' })], note({ id: 'n2', createdAt: 2 }));
    expect(a.map((n) => n.id)).toEqual(['n2', 'n1']);
    const b = addNote(a, note({ id: 'n2', createdAt: 2 }));
    expect(b).toHaveLength(2);
  });
  it('capNotes keeps only the newest 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => note({ id: `n${i}`, createdAt: i }));
    expect(capNotes(many)).toHaveLength(20);
  });
  it('unreadCount counts unread only', () => {
    expect(unreadCount([note({ read: false }), note({ id: 'n2', read: true })])).toBe(1);
  });
});

describe('noteSubject', () => {
  it('prefers the subject the note carries', () => {
    expect(noteSubject(note({ subject: '  Ile aux Cerfs  ', message: 'whatever' }))).toBe(
      'Ile aux Cerfs',
    );
  });
  it('reads the trip name an older note baked into its message', () => {
    expect(noteSubject(note({ message: 'Catamaran day — your held spot expired' }))).toBe(
      'Catamaran day',
    );
    expect(
      noteSubject(note({ type: 'unavailable', message: 'Dolphin swim — no longer available' })),
    ).toBe('Dolphin swim');
  });
  it('returns null when there is no trip name to find', () => {
    expect(noteSubject(note({ type: 'error', message: 'Could not reach the server' }))).toBeNull();
    expect(noteSubject(note({ message: ' — your held spot expired' }))).toBeNull();
    expect(noteSubject(note({ subject: '   ', message: 'plain text' }))).toBeNull();
  });
});

describe('noteDeadline', () => {
  it('uses the expiry a hold note carries', () => {
    expect(noteDeadline(note({ type: 'secured', expiresAt: 5000 }))).toBe(5000);
  });
  it('falls back to the standard 30-minute hold for an older note', () => {
    expect(noteDeadline(note({ type: 'expiring', createdAt: 1000 }))).toBe(1000 + HOLD_MS);
  });
  it('has no deadline for notes that are not about a hold', () => {
    for (const type of ['expired', 'unavailable', 'error'] as const) {
      expect(noteDeadline(note({ type, expiresAt: 5000 }))).toBeNull();
    }
  });
});

describe('isHoldLive', () => {
  const now = 10_000;
  const held = new Set(['h1']);

  it('is live while the deadline is ahead and one of its holds is still in the cart', () => {
    expect(
      isHoldLive(note({ type: 'secured', expiresAt: now + 1, holdIds: ['h1'] }), now, held),
    ).toBe(true);
  });
  it('is not live once the deadline passes', () => {
    expect(isHoldLive(note({ type: 'secured', expiresAt: now, holdIds: ['h1'] }), now, held)).toBe(
      false,
    );
  });
  it('is not live once its holds have left the cart (paid, removed or released)', () => {
    expect(
      isHoldLive(note({ type: 'secured', expiresAt: now + 60_000, holdIds: ['h9'] }), now, held),
    ).toBe(false);
  });
  it('treats an older note with no hold ids as live only while the cart holds anything', () => {
    const legacy = note({ type: 'secured', createdAt: now - 1000 });
    expect(isHoldLive(legacy, now, held)).toBe(true);
    expect(isHoldLive(legacy, now, new Set())).toBe(false);
  });
  it('is never live for notes that are not about a hold', () => {
    expect(isHoldLive(note({ type: 'expired', expiresAt: now + 60_000 }), now, held)).toBe(false);
  });
});

describe('matchesFilter', () => {
  it('"all" shows everything', () => {
    expect(matchesFilter(note({ type: 'error' }), 'all', false)).toBe(true);
  });
  it('"action" shows only holds still waiting on payment', () => {
    expect(matchesFilter(note({ type: 'secured' }), 'action', true)).toBe(true);
    expect(matchesFilter(note({ type: 'secured' }), 'action', false)).toBe(false);
  });
  it('"bookings" shows every trip note but not connection errors', () => {
    expect(matchesFilter(note({ type: 'expired' }), 'bookings', false)).toBe(true);
    expect(matchesFilter(note({ type: 'error' }), 'bookings', false)).toBe(false);
  });
});

describe('formatCountdown', () => {
  it('reads minutes and seconds', () => {
    expect(formatCountdown(28 * 60_000 + 4_000)).toBe('28:04');
    expect(formatCountdown(59_999)).toBe('00:59');
  });
  it('adds hours only when there are any', () => {
    expect(formatCountdown(3_909_000)).toBe('1:05:09');
  });
  it('never goes negative', () => {
    expect(formatCountdown(-5_000)).toBe('00:00');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);

  it('reads a few seconds ago as now, with a capital first letter', () => {
    const out = formatRelativeTime(now - 10_000, now, 'en');
    expect(out).toMatch(/^[A-Z]/);
    expect(out.toLowerCase()).toContain('now');
  });
  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now, 'en')).toMatch(/5/);
    expect(formatRelativeTime(now - 3 * 3_600_000, now, 'en')).toMatch(/3/);
    expect(formatRelativeTime(now - 2 * 86_400_000, now, 'en')).toMatch(/2/);
  });
  it('shows a date once it is more than a week old', () => {
    expect(formatRelativeTime(now - 10 * 86_400_000, now, 'en')).toMatch(/28 Oct/);
  });
  it('speaks French for French visitors', () => {
    expect(formatRelativeTime(now - 5 * 60_000, now, 'fr').toLowerCase()).toContain('il y a');
  });
});
