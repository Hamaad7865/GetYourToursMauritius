import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { GET } from '../../app/api/v1/tours/route';

const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

async function mintToken(sub = 'user-1'): Promise<string> {
  return new SignJWT({ email: 'traveller@example.com', role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET));
}

describe('GET /api/v1/tours', () => {
  it('returns 401 without a Bearer token', async () => {
    const res = await GET(new Request('http://localhost/api/v1/tours'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for a token signed with the wrong secret', async () => {
    const badToken = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('a-different-secret-that-is-long-enough-xxxx'));
    const res = await GET(
      new Request('http://localhost/api/v1/tours', {
        headers: { authorization: `Bearer ${badToken}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns a paginated success envelope with a valid token', async () => {
    const token = await mintToken();
    const res = await GET(
      new Request('http://localhost/api/v1/tours?pageSize=1', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.meta).toMatchObject({ page: 1, pageSize: 1 });
    expect(body.meta.total).toBeGreaterThanOrEqual(1);
  });

  it('filters by category', async () => {
    const token = await mintToken();
    const res = await GET(
      new Request('http://localhost/api/v1/tours?category=Island%20tours', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    for (const tour of body.data) {
      expect(tour.category).toBe('Island tours');
    }
  });

  it('rejects invalid query parameters with 400', async () => {
    const token = await mintToken();
    const res = await GET(
      new Request('http://localhost/api/v1/tours?category=NotACategory', {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('validation_error');
  });
});
