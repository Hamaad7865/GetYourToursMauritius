import { describe, expect, it } from 'vitest';
import { findBoost, frontLoadClosingStops } from '@/components/planner/closing-order';

const stop = (id: string, closesAt: string | null = null) => ({ id, name: id, closesAt });

describe('opening-hours nudge', () => {
  it('moves every closing stop forward in one go, earliest first, keeping the first stop', () => {
    const close = new Map([
      ['garden', '17:00'],
      ['museum', '16:00'],
    ]);
    expect(frontLoadClosingStops(['beach', 'market', 'garden', 'museum'], close)).toEqual([
      'beach',
      'museum',
      'garden',
      'market',
    ]);
  });

  it('puts closers first when the first stop itself closes', () => {
    const close = new Map([
      ['garden', '17:00'],
      ['museum', '16:00'],
    ]);
    expect(frontLoadClosingStops(['garden', 'beach', 'museum'], close)).toEqual([
      'museum',
      'garden',
      'beach',
    ]);
  });

  it('does not loop: after "Yes, reorder" with two closing stops, no stop is nudged again', () => {
    const stops = [stop('beach'), stop('market'), stop('garden', '17:00'), stop('museum', '16:00')];
    const handled = new Set<string>();
    const first = findBoost(stops, handled);
    expect(first?.id).toBe('museum');

    const closeById = new Map(stops.flatMap((s) => (s.closesAt ? [[s.id, s.closesAt]] : [])));
    for (const id of closeById.keys()) handled.add(id);
    const order = frontLoadClosingStops(
      stops.map((s) => s.id),
      closeById,
    );
    const byId = new Map(stops.map((s) => [s.id, s]));
    expect(
      findBoost(
        order.map((id) => byId.get(id)!),
        handled,
      ),
    ).toBeNull();
  });

  it('never nudges a stop the visitor chose to keep as is', () => {
    const stops = [stop('a'), stop('b'), stop('garden', '17:00')];
    expect(findBoost(stops, new Set(['garden']))).toBeNull();
    expect(findBoost(stops, new Set())?.id).toBe('garden');
  });
});
