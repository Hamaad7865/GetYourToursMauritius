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
