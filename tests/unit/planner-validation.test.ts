import { describe, expect, it } from 'vitest';
import {
  plannerChatInputSchema,
  placeInsightsInputSchema,
  plannerOptimizeInputSchema,
} from '@/lib/validation/planner';

const msg = (content = 'plan my day') => ({ role: 'user' as const, content });

describe('plannerChatInputSchema message cap (P0 amplifier — lowered 40 → 12)', () => {
  it('accepts a normal conversation', () => {
    const r = plannerChatInputSchema.safeParse({ messages: [msg(), msg('a beach day')] });
    expect(r.success).toBe(true);
  });

  it('accepts exactly 12 messages (the cap)', () => {
    const r = plannerChatInputSchema.safeParse({
      messages: Array.from({ length: 12 }, () => msg()),
    });
    expect(r.success).toBe(true);
  });

  it('rejects 13 messages — a huge transcript can no longer inflate the billed token count', () => {
    const r = plannerChatInputSchema.safeParse({
      messages: Array.from({ length: 13 }, () => msg()),
    });
    expect(r.success).toBe(false);
  });

  it('still requires at least one message', () => {
    expect(plannerChatInputSchema.safeParse({ messages: [] }).success).toBe(false);
  });
});

describe('plannerChatInputSchema trip context (range mode)', () => {
  const place = {
    id: 'pl-1',
    name: 'Le Morne',
    category: 'Beach',
    region: 'South',
    lat: -20.45,
    lng: 57.31,
    durationMin: 90,
    closesAt: null,
    blurb: null,
    imageUrl: null,
  };
  const tripDay = (date: string) => ({ date, places: [place] });
  const trip = {
    from: '2026-09-01',
    to: '2026-09-05',
    days: ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map(tripDay),
    activeDate: '2026-09-01',
  };

  it('accepts a 5-day trip with dinner + activity anchors', () => {
    const r = plannerChatInputSchema.safeParse({
      messages: [msg()],
      trip: {
        ...trip,
        days: [
          { ...tripDay('2026-09-01'), dinner: place, activitySlug: 'catamaran-ile-aux-cerfs' },
          ...trip.days.slice(1),
        ],
      },
    });
    expect(r.success).toBe(true);
  });

  it('stays optional — a single-day request without trip still parses', () => {
    expect(plannerChatInputSchema.safeParse({ messages: [msg()] }).success).toBe(true);
  });

  it('rejects an 8-day trip (hard cap keeps the billed context bounded)', () => {
    const days = Array.from({ length: 8 }, (_, i) => tripDay(`2026-09-0${i + 1}`));
    const r = plannerChatInputSchema.safeParse({
      messages: [msg()],
      trip: { ...trip, days },
    });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed date and a junk activity slug', () => {
    expect(
      plannerChatInputSchema.safeParse({
        messages: [msg()],
        trip: { ...trip, days: [tripDay('01-09-2026')] },
      }).success,
    ).toBe(false);
    expect(
      plannerChatInputSchema.safeParse({
        messages: [msg()],
        trip: { ...trip, days: [{ ...tripDay('2026-09-01'), activitySlug: 'NOT a slug!' }] },
      }).success,
    ).toBe(false);
  });

  it('rejects a day with more than 12 places', () => {
    const r = plannerChatInputSchema.safeParse({
      messages: [msg()],
      trip: {
        ...trip,
        days: [{ date: '2026-09-01', places: Array.from({ length: 13 }, () => place) }],
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('placeInsightsInputSchema bounds (≤ 12 places)', () => {
  const place = { name: 'Le Morne', category: 'Beach', region: 'South' };
  it('accepts up to 12 places', () => {
    expect(
      placeInsightsInputSchema.safeParse({ places: Array.from({ length: 12 }, () => place) })
        .success,
    ).toBe(true);
  });
  it('rejects 13 places', () => {
    expect(
      placeInsightsInputSchema.safeParse({ places: Array.from({ length: 13 }, () => place) })
        .success,
    ).toBe(false);
  });
});

describe('plannerOptimizeInputSchema coordinate bounds (finite + range)', () => {
  const pickup = { lat: -20.1, lng: 57.5 };
  const stop = { lat: -20.0, lng: 57.6 };

  it('accepts in-range Mauritius coordinates', () => {
    expect(plannerOptimizeInputSchema.safeParse({ pickup, stops: [stop] }).success).toBe(true);
  });

  it('rejects an Infinity latitude (no NaN/Infinity slips through to the billed API)', () => {
    expect(
      plannerOptimizeInputSchema.safeParse({
        pickup: { lat: Infinity, lng: 57.5 },
        stops: [stop],
      }).success,
    ).toBe(false);
  });

  it('rejects a NaN longitude', () => {
    expect(
      plannerOptimizeInputSchema.safeParse({ pickup, stops: [{ lat: -20, lng: NaN }] }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range latitude (> 90)', () => {
    expect(
      plannerOptimizeInputSchema.safeParse({ pickup: { lat: 91, lng: 0 }, stops: [stop] }).success,
    ).toBe(false);
  });

  it('rejects an out-of-range longitude (< -180)', () => {
    expect(
      plannerOptimizeInputSchema.safeParse({ pickup, stops: [{ lat: 0, lng: -181 }] }).success,
    ).toBe(false);
  });
});
