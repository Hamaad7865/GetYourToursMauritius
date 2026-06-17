import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, generateKeyPair, type KeyLike } from 'jose';
import { verifyAccessToken } from '@/lib/http/auth';
import { resetServerEnvCache } from '@/lib/config/env';

// The verifier resolves keys through jose's createRemoteJWKSet (which, on Node, fetches over
// https — not global fetch). Replace it with a resolver that returns a locally-held public
// key, so we can exercise the real ES256 verification without a network round-trip.
const held = vi.hoisted(() => ({ publicKey: null as KeyLike | null }));
vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: () => async () => {
      if (!held.publicKey) throw new Error('no test key set');
      return held.publicKey;
    },
  };
});

/**
 * Exercises the asymmetric (ES256 / JWKS) branch of verifyAccessToken — the path real
 * Supabase access tokens take now that the project signs with an ECC key.
 */
describe('verifyAccessToken — asymmetric (JWKS) path', () => {
  let signingKey: KeyLike;

  beforeEach(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://jwks-test.supabase.co';
    resetServerEnvCache();
    const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
    signingKey = privateKey;
    held.publicKey = publicKey;
  });

  afterEach(() => {
    resetServerEnvCache();
  });

  function token(key: KeyLike) {
    return new SignJWT({ email: 'traveller@example.com', role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: 'kid-1' })
      .setSubject('user-abc')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
  }

  it('verifies an ES256 token and extracts the user', async () => {
    const user = await verifyAccessToken(await token(signingKey));
    expect(user).toEqual({ id: 'user-abc', email: 'traveller@example.com', role: 'authenticated' });
  });

  it('rejects a token signed by a different key', async () => {
    const { privateKey: otherKey } = await generateKeyPair('ES256', { extractable: true });
    await expect(verifyAccessToken(await token(otherKey))).rejects.toThrow();
  });

  it('rejects a malformed token', async () => {
    await expect(verifyAccessToken('not-a-jwt')).rejects.toThrow();
  });
});

/**
 * The legacy HS256 (symmetric) path is the forgery risk from a leaked shared secret, so it is
 * disabled unless ACCEPT_LEGACY_HS256 is explicitly on.
 */
describe('verifyAccessToken — legacy HS256 gate', () => {
  const SECRET =
    process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';

  function hsToken() {
    return new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('hs-user')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
  }

  afterEach(() => {
    process.env.ACCEPT_LEGACY_HS256 = 'true'; // restore the suite default
    resetServerEnvCache();
  });

  it('rejects an HS256 token when the legacy path is off', async () => {
    process.env.ACCEPT_LEGACY_HS256 = 'false';
    resetServerEnvCache();
    await expect(verifyAccessToken(await hsToken())).rejects.toThrow();
  });

  it('accepts a valid HS256 token when ACCEPT_LEGACY_HS256=true', async () => {
    process.env.ACCEPT_LEGACY_HS256 = 'true';
    resetServerEnvCache();
    const user = await verifyAccessToken(await hsToken());
    expect(user.id).toBe('hs-user');
  });
});
