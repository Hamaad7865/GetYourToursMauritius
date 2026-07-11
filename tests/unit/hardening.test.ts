import { describe, expect, it, vi } from 'vitest';
import { paginationQuerySchema } from '@/lib/validation/common';
import { createBookingInputSchema } from '@/lib/validation/booking';
import { capIp, clientIp, MAX_IP_LENGTH } from '@/lib/http/rate-limit';
import { errorToResponse } from '@/lib/http/envelope';
import { ConfigError, ValidationError } from '@/lib/services/errors';

describe('F21: pagination page is upper-bounded', () => {
  it('rejects an overflowing page', () => {
    expect(paginationQuerySchema.safeParse({ page: 200000000 }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: 100001 }).success).toBe(false);
  });
  it('accepts a normal page', () => {
    const parsed = paginationQuerySchema.parse({ page: 5, pageSize: 20 });
    expect(parsed.page).toBe(5);
  });
});

describe('F24: 5xx ServiceError messages are not leaked to the client', () => {
  it('hides the internal message of a ConfigError but keeps the code + correlation id', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = errorToResponse(new ConfigError('SUPABASE_JWT_SECRET is not configured'));
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: { errorId?: string } };
    };
    expect(res.status).toBe(500);
    expect(body.error.code).toBe('config_error');
    expect(JSON.stringify(body)).not.toContain('SUPABASE_JWT_SECRET');
    expect(body.error.details?.errorId).toBeTruthy();
    spy.mockRestore();
  });

  it('still surfaces a 4xx validation message verbatim', async () => {
    const res = errorToResponse(new ValidationError('email is invalid'));
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(400);
    expect(body.error.message).toBe('email is invalid');
  });
});

describe('P2: client IP is length-capped before it reaches the DB row', () => {
  it('truncates an over-long IP to MAX_IP_LENGTH', () => {
    const giant = '1.'.repeat(500);
    const capped = capIp(giant);
    expect(capped).toHaveLength(MAX_IP_LENGTH);
    expect(capped).toBe(giant.slice(0, MAX_IP_LENGTH));
  });

  it('passes a normal IP through unchanged and preserves null', () => {
    expect(capIp('203.0.113.7')).toBe('203.0.113.7');
    expect(capIp(null)).toBeNull();
  });

  it('caps a spoofed giant x-forwarded-for from the request headers', () => {
    const spoofed = 'a'.repeat(5000);
    const req = new Request('https://example.com', {
      headers: { 'x-forwarded-for': `${spoofed}, 10.0.0.1` },
    });
    expect(clientIp(req)?.length).toBe(MAX_IP_LENGTH);
  });
});

describe('P2: booking pickup coordinates reject Infinity/NaN and out-of-range', () => {
  const base = {
    occurrenceId: '00000000-0000-0000-0000-000000000000',
    party: { Adult: 1 },
    customer: { name: 'Ada', email: 'ada@example.com' },
  };

  it('accepts a valid Mauritius pickup', () => {
    expect(
      createBookingInputSchema.safeParse({ ...base, pickupLat: -20.16, pickupLng: 57.5 }).success,
    ).toBe(true);
  });

  it('rejects an Infinity pickupLat', () => {
    expect(
      createBookingInputSchema.safeParse({ ...base, pickupLat: Infinity, pickupLng: 57.5 }).success,
    ).toBe(false);
  });

  it('rejects a NaN itinerary coordinate', () => {
    expect(
      createBookingInputSchema.safeParse({
        ...base,
        itinerary: [{ title: 'Stop', lat: NaN, lng: 57.5 }],
      }).success,
    ).toBe(false);
  });
});
