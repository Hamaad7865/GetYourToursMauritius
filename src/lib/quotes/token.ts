/** Edge-safe (Web Crypto only) minting + constant-time verification of the public quote link token. */

export function mintQuoteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashQuoteToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare. A null/absent stored hash is never a match — fail closed. */
export async function quoteTokenMatches(
  token: string,
  storedHash: string | null,
): Promise<boolean> {
  if (!storedHash || !/^[0-9a-f]{64}$/.test(token)) return false;
  const actual = await hashQuoteToken(token);
  if (actual.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1)
    diff |= actual.charCodeAt(i) ^ storedHash.charCodeAt(i);
  return diff === 0;
}
