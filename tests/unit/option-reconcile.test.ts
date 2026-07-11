import { describe, expect, it } from 'vitest';
import { planOptionReconcile } from '@/lib/admin/activity-write';

describe('planOptionReconcile — FK-safe option editing', () => {
  it('updates matched options in place, inserts new, flags dropped for removal', () => {
    const { toUpsert, removedIds } = planOptionReconcile(
      ['A', 'B', 'C'],
      [
        { id: 'A', name: 'Shared', prices: [] }, // existing → update in place (keeps id A)
        { name: 'Private', prices: [] }, // no id → insert
        { id: 'C', name: 'VIP', prices: [] }, // existing → update in place
      ],
    );
    expect(
      toUpsert.map((u) => ({ id: u.option.id ?? null, isNew: u.isNew, position: u.position })),
    ).toEqual([
      { id: 'A', isNew: false, position: 0 },
      { id: null, isNew: true, position: 1 },
      { id: 'C', isNew: false, position: 2 },
    ]);
    expect(removedIds).toEqual(['B']); // B was dropped from the form
  });

  it('treats an id that no longer exists as a new insert, not an update', () => {
    const { toUpsert, removedIds } = planOptionReconcile(
      ['A'],
      [{ id: 'ghost', name: 'X', prices: [] }],
    );
    expect(toUpsert[0]!.isNew).toBe(true);
    expect(removedIds).toEqual(['A']);
  });

  it('ignores blank-named options and removes all existing when the form clears them', () => {
    const { toUpsert, removedIds } = planOptionReconcile(['A', 'B'], [{ name: '   ', prices: [] }]);
    expect(toUpsert).toEqual([]);
    expect(removedIds).toEqual(['A', 'B']);
  });
});
