import { describe, expect, it } from 'vitest';
import {
  hasVisitorTurn,
  isWorthSaving,
  parseSavedChats,
  planSignature,
  pruneToBudget,
  relativeSavedAt,
  savedChatKind,
  savedStopCount,
  snapshotTitle,
  upsertChat,
  type PlannerSnapshot,
  type SavedChat,
} from '@/lib/planner/chat-history';
import type { PlannerPlace } from '@/lib/validation/planner';

/* The shelf of saved conversations. It lives in the visitor's own browser, so the rules that matter
 * are: one slot per session (not one per keystroke), a bounded size, and a hand-edited or
 * older-shaped entry degrading quietly instead of taking the history down. */

const place = (id: string, name: string): PlannerPlace => ({
  id,
  name,
  category: 'Beach',
  region: 'South',
  lat: -20.4,
  lng: 57.7,
  durationMin: 60,
  closesAt: null,
  blurb: null,
  imageUrl: null,
});

const snapshot = (over: Partial<PlannerSnapshot> = {}): PlannerSnapshot => ({
  chat: [],
  stopIds: [],
  days: null,
  places: [],
  pickup: { id: 'belle-mare', name: 'Belle Mare', lat: -20.2, lng: 57.77 },
  dropoff: null,
  ...over,
});

const saved = (id: string, savedAt: number, over: Partial<PlannerSnapshot> = {}): SavedChat => ({
  id,
  savedAt,
  title: `chat ${id}`,
  snapshot: snapshot(over),
});

describe('snapshotTitle', () => {
  it('uses what the visitor actually asked', () => {
    expect(
      snapshotTitle(
        snapshot({
          chat: [
            { role: 'assistant', kind: 'text', text: 'Plan your day with me' },
            { role: 'user', kind: 'text', text: '  A relaxed day\n in the south ' },
          ],
        }),
      ),
    ).toBe('A relaxed day in the south');
  });

  it('truncates a long ask', () => {
    const title = snapshotTitle(
      snapshot({ chat: [{ role: 'user', kind: 'text', text: 'x'.repeat(200) }] }),
    );
    expect(title).toHaveLength(68);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to the shape of the plan when they only clicked around', () => {
    expect(
      snapshotTitle(
        snapshot({
          days: [
            { date: '2026-09-01', stopIds: [], dinnerId: null, activitySlug: null },
            { date: '2026-09-02', stopIds: [], dinnerId: null, activitySlug: null },
          ],
        }),
      ),
    ).toBe('2-day trip');
    expect(snapshotTitle(snapshot({ stopIds: ['p1'], places: [place('p1', 'Gris Gris')] }))).toBe(
      'Day out — Gris Gris',
    );
    expect(snapshotTitle(snapshot())).toBe('Planning session');
  });
});

describe('isWorthSaving', () => {
  it('saves once they have said something or planned something', () => {
    expect(isWorthSaving(snapshot())).toBe(false);
    expect(
      isWorthSaving(snapshot({ chat: [{ role: 'assistant', kind: 'text', text: 'hello' }] })),
    ).toBe(false);
    expect(isWorthSaving(snapshot({ chat: [{ role: 'user', kind: 'text', text: 'hi' }] }))).toBe(
      true,
    );
    expect(isWorthSaving(snapshot({ stopIds: ['p1'] }))).toBe(true);
    expect(
      isWorthSaving(
        snapshot({
          days: [{ date: '2026-09-01', stopIds: ['p1'], dinnerId: null, activitySlug: null }],
        }),
      ),
    ).toBe(true);
  });
});

describe('planSignature', () => {
  it('is stable for the same plan and different for a changed one', () => {
    expect(planSignature(['a', 'b'], null)).toBe(planSignature(['a', 'b'], null));
    expect(planSignature(['a', 'b'], null)).not.toBe(planSignature(['b', 'a'], null));
    expect(planSignature(['a'], null)).not.toBe(planSignature(['a', 'b'], null));
  });

  it('is empty for an untouched planner, so nothing is saved for a bare visit', () => {
    expect(planSignature([], null)).toBe('');
    expect(
      planSignature([], [{ date: '2026-09-01', stopIds: [], dinnerId: null, activitySlug: null }]),
    ).toBe('');
  });

  it('notices a day gaining a stop, a dinner or a tour', () => {
    const empty = [{ date: '2026-09-01', stopIds: [], dinnerId: null, activitySlug: null }];
    const withStop = [{ ...empty[0]!, stopIds: ['p1'] }];
    const withDinner = [{ ...empty[0]!, dinnerId: 'd1' }];
    const withTour = [{ ...empty[0]!, activitySlug: 'catamaran-bbq' }];
    const sigs = [empty, withStop, withDinner, withTour].map((d) => planSignature([], d));
    expect(new Set(sigs).size).toBe(4);
  });

  it('separates the visitor speaking from the planner merely showing things', () => {
    expect(hasVisitorTurn(snapshot({ chat: [{ role: 'assistant', kind: 'summary' }] }))).toBe(
      false,
    );
    expect(hasVisitorTurn(snapshot({ chat: [{ role: 'user', kind: 'text', text: 'hi' }] }))).toBe(
      true,
    );
  });
});

describe('upsertChat', () => {
  it('keeps ONE slot per session, newest first', () => {
    const shelf = upsertChat([saved('a', 1), saved('b', 2)], saved('a', 3));
    expect(shelf.map((c) => c.id)).toEqual(['a', 'b']);
    expect(shelf[0]!.savedAt).toBe(3);
  });

  it('drops the oldest past the cap', () => {
    let shelf: SavedChat[] = [];
    for (let i = 0; i < 9; i += 1) shelf = upsertChat(shelf, saved(`s${i}`, i), 6);
    expect(shelf).toHaveLength(6);
    expect(shelf[0]!.id).toBe('s8');
    expect(shelf.some((c) => c.id === 's0')).toBe(false);
  });
});

describe('pruneToBudget', () => {
  it('drops the oldest until the shelf fits, always keeping the newest', () => {
    const fat = (id: string) =>
      saved(id, 1, {
        places: Array.from({ length: 40 }, (_, i) => place(`p${i}`, 'x'.repeat(80))),
      });
    const pruned = pruneToBudget([fat('a'), fat('b'), fat('c')], 12_000);
    expect(pruned[0]!.id).toBe('a');
    expect(pruned.length).toBeLessThan(3);
  });

  it('keeps a single oversized chat rather than losing the current one', () => {
    const huge = saved('a', 1, {
      places: Array.from({ length: 200 }, (_, i) => place(`p${i}`, 'y'.repeat(200))),
    });
    expect(pruneToBudget([huge], 100)).toHaveLength(1);
  });
});

describe('parseSavedChats', () => {
  it('round-trips what we wrote, newest first', () => {
    const raw = JSON.stringify([saved('a', 10), saved('b', 30)]);
    expect(parseSavedChats(raw).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('survives junk instead of losing the whole history', () => {
    expect(parseSavedChats(null)).toEqual([]);
    expect(parseSavedChats('not json')).toEqual([]);
    expect(parseSavedChats('{"not":"an array"}')).toEqual([]);
    const mixed = JSON.stringify([
      null,
      { id: 'no-snapshot', savedAt: 1 },
      { id: 'bad-shape', savedAt: 1, snapshot: { chat: 'nope' } },
      saved('good', 5),
    ]);
    expect(parseSavedChats(mixed).map((c) => c.id)).toEqual(['good']);
  });

  it('defaults a missing title and a missing days field', () => {
    const raw = JSON.stringify([{ ...saved('a', 1), title: '' }]);
    const [entry] = parseSavedChats(raw);
    expect(entry!.title).toBe('Planning session');
    expect(entry!.snapshot.days).toBeNull();
  });
});

describe('relativeSavedAt', () => {
  const now = Date.UTC(2026, 7, 8, 12, 0, 0);
  it('reads as when it happened', () => {
    expect(relativeSavedAt(now - 20_000, now)).toBe('Just now');
    expect(relativeSavedAt(now - 25 * 60_000, now)).toBe('25m ago');
    expect(relativeSavedAt(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relativeSavedAt(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(relativeSavedAt(now - 30 * 86_400_000, now)).toMatch(/Jul/);
  });
});

describe('the assistant’s additions to a saved chat', () => {
  const day = { date: '2026-09-01', stopIds: ['a', 'b'], dinnerId: null, activitySlug: null };

  it('opens a chat saved before hearts, card text and day titles existed', () => {
    // The storage key was deliberately NOT versioned for these fields — which only holds if an
    // older entry, with none of them, still parses and comes back with usable empties.
    const old = {
      id: 'old',
      savedAt: 5,
      title: 'Old chat',
      snapshot: snapshot({ stopIds: ['a'] }),
    };
    const [parsed] = parseSavedChats(JSON.stringify([old]));
    expect(parsed!.snapshot.pinnedIds).toEqual([]);
    expect(parsed!.snapshot.notes).toEqual({});
    expect(parsed!.snapshot.dayTitles).toEqual({});
    expect(parsed!.snapshot.prompt).toBe('');
    expect(parsed!.snapshot.view).toBe('list');
  });

  it('round-trips them when they are there', () => {
    const entry = {
      id: 'new',
      savedAt: 9,
      title: 'South day',
      snapshot: snapshot({
        stopIds: ['a'],
        pinnedIds: ['a'],
        notes: { a: { why: 'Calm water.', tip: 'Best early.' } },
        dayTitles: { single: 'Wild south' },
        prompt: 'a south day',
        view: 'compare',
      }),
    };
    const [parsed] = parseSavedChats(JSON.stringify([entry]));
    expect(parsed!.snapshot).toMatchObject({
      pinnedIds: ['a'],
      notes: { a: { why: 'Calm water.', tip: 'Best early.' } },
      dayTitles: { single: 'Wild south' },
      prompt: 'a south day',
      view: 'compare',
    });
  });

  it('discards damaged values field by field instead of throwing the chat away', () => {
    const damaged = {
      id: 'bad',
      savedAt: 3,
      title: 'x',
      snapshot: {
        ...snapshot({ stopIds: ['a'] }),
        pinnedIds: ['a', 7, null],
        notes: ['not', 'an', 'object'],
        dayTitles: { single: 'Kept', other: 42 },
        prompt: 12,
        view: 'sideways',
      },
    };
    const [parsed] = parseSavedChats(JSON.stringify([damaged]));
    expect(parsed!.snapshot.pinnedIds).toEqual(['a']);
    expect(parsed!.snapshot.notes).toEqual({});
    expect(parsed!.snapshot.dayTitles).toEqual({ single: 'Kept' });
    expect(parsed!.snapshot.prompt).toBe('');
    expect(parsed!.snapshot.view).toBe('list');
  });

  it('sorts a saved chat into the menu’s filters by what it holds', () => {
    expect(savedChatKind(snapshot())).toBe('chat');
    expect(savedChatKind(snapshot({ stopIds: ['a'] }))).toBe('itinerary');
    expect(savedChatKind(snapshot({ stopIds: ['a'], view: 'compare' }))).toBe('comparison');
    // A comparison of nothing is still just a chat.
    expect(savedChatKind(snapshot({ view: 'compare' }))).toBe('chat');
    expect(savedChatKind(snapshot({ days: [day] }))).toBe('itinerary');
  });

  it('counts a trip’s stops across all its days', () => {
    expect(savedStopCount(snapshot({ stopIds: ['a', 'b', 'c'] }))).toBe(3);
    expect(
      savedStopCount(snapshot({ days: [day, { ...day, date: '2026-09-02', stopIds: ['c'] }] })),
    ).toBe(3);
  });
});
