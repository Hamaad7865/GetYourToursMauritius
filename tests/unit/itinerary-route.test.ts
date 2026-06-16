import { describe, expect, it } from 'vitest';
import { withIds, addStop, removeStop, moveStop, type BuilderStop } from '@/lib/itinerary/route';

const A: BuilderStop = { id: 'def-0', title: 'Port Louis' };
const B: BuilderStop = { id: 'def-1', title: 'Pamplemousses' };
const C: BuilderStop = { id: 'opt-0', title: 'Fort Adelaide' };

describe('itinerary route reducer', () => {
  it('assigns stable prefixed ids', () => {
    const ids = withIds([{ title: 'X' }, { title: 'Y' }], 'def').map((s) => s.id);
    expect(ids).toEqual(['def-0', 'def-1']);
  });

  it('adds a stop at the end, ignoring duplicates and respecting the cap', () => {
    expect(addStop([A], C, 8)).toEqual([A, C]);
    expect(addStop([A, C], C, 8)).toEqual([A, C]); // already present → no-op
    expect(addStop([A, B], C, 2)).toEqual([A, B]); // at cap → no-op
  });

  it('removes by id', () => {
    expect(removeStop([A, B, C], 'def-1')).toEqual([A, C]);
  });

  it('moves a stop up/down within bounds', () => {
    expect(moveStop([A, B, C], 'def-1', -1)).toEqual([B, A, C]);
    expect(moveStop([A, B, C], 'def-1', 1)).toEqual([A, C, B]);
    expect(moveStop([A, B, C], 'def-0', -1)).toEqual([A, B, C]); // first up → no-op
    expect(moveStop([A, B, C], 'opt-0', 1)).toEqual([A, B, C]); // last down → no-op
  });
});
