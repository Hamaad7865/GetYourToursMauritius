import { afterEach, describe, expect, it, vi } from 'vitest';
import { followRedirectChain } from '../../scripts/release/verify-dns.mjs';

type MockResponse = { status: number; headers?: Record<string, string> };

function mockFetchSequence(responses: MockResponse[]): string[] {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const next = responses.shift();
    if (!next) throw new Error(`no more mocked responses (requested ${url})`);
    return {
      status: next.status,
      headers: { get: (name: string) => next.headers?.[name.toLowerCase()] ?? null },
    };
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('release/verify-dns followRedirectChain', () => {
  it('returns the final response when there is no redirect', async () => {
    mockFetchSequence([{ status: 200 }]);
    const result = await followRedirectChain('https://bellemaretours.com/');
    expect(result.finalStatus).toBe(200);
    expect(result.chain).toEqual(['https://bellemaretours.com/']);
  });

  it('follows a single redirect hop to the final URL', async () => {
    mockFetchSequence([
      { status: 308, headers: { location: 'https://bellemaretours.com/' } },
      { status: 200 },
    ]);
    const result = await followRedirectChain('https://www.bellemaretours.com/');
    expect(result.finalUrl).toBe('https://bellemaretours.com/');
    expect(result.chain).toEqual([
      'https://www.bellemaretours.com/',
      'https://bellemaretours.com/',
    ]);
  });

  it('throws on a redirect loop', async () => {
    mockFetchSequence([
      { status: 308, headers: { location: 'https://b.example.com/' } },
      { status: 308, headers: { location: 'https://a.example.com/' } },
    ]);
    await expect(followRedirectChain('https://a.example.com/')).rejects.toThrow(/loop/i);
  });

  it('throws when a redirect status has no Location header', async () => {
    mockFetchSequence([{ status: 302, headers: {} }]);
    await expect(followRedirectChain('https://a.example.com/')).rejects.toThrow(/Location/);
  });

  it('throws when the chain exceeds the max redirect count', async () => {
    const responses = Array.from({ length: 12 }, (_, i) => ({
      status: 308,
      headers: { location: `https://hop-${i + 1}.example.com/` },
    }));
    mockFetchSequence(responses);
    await expect(
      followRedirectChain('https://hop-0.example.com/', { maxRedirects: 10 }),
    ).rejects.toThrow(/exceeded/);
  });
});
