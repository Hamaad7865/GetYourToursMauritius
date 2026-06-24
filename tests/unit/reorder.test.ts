import { describe, expect, it } from 'vitest';
import { moveItem } from '@/lib/admin/reorder';

describe('moveItem — reorder an array element', () => {
  it('moves an item up one position', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item down one position', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 2)).toEqual(['a', 'c', 'b']);
  });

  it('treats an out-of-range target as a no-op (moving the first item up)', () => {
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('treats an out-of-range target as a no-op (moving the last item down)', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c']);
  });

  it('treats an out-of-range source as a no-op', () => {
    expect(moveItem(['a', 'b', 'c'], 5, 0)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveItem(input, 0, 2);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});
