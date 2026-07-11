import { describe, expect, it } from 'vitest';
import { addNote, capNotes, unreadCount, type Note } from '@/lib/notifications/inbox';

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
