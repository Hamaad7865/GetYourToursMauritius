import { describe, expect, it } from 'vitest';
import { mintQuoteToken, hashQuoteToken, quoteTokenMatches } from '@/lib/quotes/token';

/**
 * The public quote link is the ONLY thing standing between a guest and a payable quote — there is no
 * account behind it. So the raw token must never be derivable from the database: we store the
 * SHA-256 hash and compare, and a missing hash must fail closed rather than wave everyone through.
 */
describe('quote link token', () => {
  it('mints a token that matches its own hash', async () => {
    const token = mintQuoteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await quoteTokenMatches(token, await hashQuoteToken(token))).toBe(true);
  });

  it('rejects a different token', async () => {
    const hash = await hashQuoteToken(mintQuoteToken());
    expect(await quoteTokenMatches(mintQuoteToken(), hash)).toBe(false);
  });

  it('rejects an absent stored hash rather than treating it as a match', async () => {
    expect(await quoteTokenMatches(mintQuoteToken(), null)).toBe(false);
  });
});
