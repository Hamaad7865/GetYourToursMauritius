import { describe, expect, it, vi } from 'vitest';
import { paginationQuerySchema } from '@/lib/validation/common';
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
    const body = (await res.json()) as { error: { code: string; message: string; details?: { errorId?: string } } };
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
