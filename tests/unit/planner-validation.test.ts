import { describe, expect, it } from 'vitest';
import { plannerChatInputSchema, placeInsightsInputSchema } from '@/lib/validation/planner';

const msg = (content = 'plan my day') => ({ role: 'user' as const, content });

describe('plannerChatInputSchema message cap (P0 amplifier — lowered 40 → 12)', () => {
  it('accepts a normal conversation', () => {
    const r = plannerChatInputSchema.safeParse({ messages: [msg(), msg('a beach day')] });
    expect(r.success).toBe(true);
  });

  it('accepts exactly 12 messages (the cap)', () => {
    const r = plannerChatInputSchema.safeParse({ messages: Array.from({ length: 12 }, () => msg()) });
    expect(r.success).toBe(true);
  });

  it('rejects 13 messages — a huge transcript can no longer inflate the billed token count', () => {
    const r = plannerChatInputSchema.safeParse({ messages: Array.from({ length: 13 }, () => msg()) });
    expect(r.success).toBe(false);
  });

  it('still requires at least one message', () => {
    expect(plannerChatInputSchema.safeParse({ messages: [] }).success).toBe(false);
  });
});

describe('placeInsightsInputSchema bounds (≤ 12 places)', () => {
  const place = { name: 'Le Morne', category: 'Beach', region: 'South' };
  it('accepts up to 12 places', () => {
    expect(
      placeInsightsInputSchema.safeParse({ places: Array.from({ length: 12 }, () => place) }).success,
    ).toBe(true);
  });
  it('rejects 13 places', () => {
    expect(
      placeInsightsInputSchema.safeParse({ places: Array.from({ length: 13 }, () => place) }).success,
    ).toBe(false);
  });
});
