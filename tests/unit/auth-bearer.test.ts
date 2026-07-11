import { describe, expect, it } from 'vitest';
import { getBearerToken } from '@/lib/http/auth';

function req(authorization: string | null): Request {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : null),
    },
  } as Request;
}

describe('getBearerToken', () => {
  it('extracts a valid Bearer token', () => {
    expect(getBearerToken(req('Bearer valid-token'))).toBe('valid-token');
  });
  it('is case-insensitive on the scheme', () => {
    expect(getBearerToken(req('bearer my-token'))).toBe('my-token');
  });
  it('returns null when there is no header', () => {
    expect(getBearerToken(req(null))).toBeNull();
  });
  it('rejects a non-Bearer scheme', () => {
    expect(getBearerToken(req('Basic dXNlcjpwYXNz'))).toBeNull();
  });
  it('rejects "Bearer" with no token', () => {
    expect(getBearerToken(req('Bearer'))).toBeNull();
  });
  it('rejects a malformed header with extra junk (the bug): "Bearer token junk"', () => {
    expect(getBearerToken(req('Bearer token junk'))).toBeNull();
  });
  it('rejects any header with more than two space-separated parts', () => {
    expect(getBearerToken(req('Bearer abc def ghi'))).toBeNull();
  });
});
