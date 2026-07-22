import { describe, expect, it } from 'vitest';
import { parseArgs, isPlausibleGitSha, redactSecrets, retry } from '../../scripts/release/lib.mjs';

describe('release/lib parseArgs', () => {
  it('parses --flag value, --flag=value and boolean flags', () => {
    expect(parseArgs(['--sha', 'abc123', '--out=file.json', '--verbose'])).toEqual({
      sha: 'abc123',
      out: 'file.json',
      verbose: true,
    });
  });

  it('treats a flag followed by another flag as boolean', () => {
    expect(parseArgs(['--dry-run', '--sha', 'x'])).toEqual({ 'dry-run': true, sha: 'x' });
  });
});

describe('release/lib isPlausibleGitSha', () => {
  it('accepts a full 40-char hex SHA', () => {
    expect(isPlausibleGitSha('a'.repeat(40))).toBe(true);
  });
  it('accepts a short hex SHA (>=7 chars)', () => {
    expect(isPlausibleGitSha('abc1234')).toBe(true);
  });
  it('rejects non-hex or too-short values', () => {
    expect(isPlausibleGitSha('not-a-sha')).toBe(false);
    expect(isPlausibleGitSha('abc12')).toBe(false);
    expect(isPlausibleGitSha(undefined)).toBe(false);
    expect(isPlausibleGitSha('')).toBe(false);
  });
});

describe('release/lib redactSecrets', () => {
  it('replaces a known-secret env value found in text', () => {
    const env = {
      CLOUDFLARE_API_TOKEN: 'super-secret-token-value',
    } as unknown as NodeJS.ProcessEnv;
    const text = `request failed, token was super-secret-token-value in header`;
    expect(redactSecrets(text, env)).toBe(
      'request failed, token was [REDACTED:CLOUDFLARE_API_TOKEN] in header',
    );
  });

  it('leaves text unchanged when no secret env vars are set', () => {
    expect(redactSecrets('nothing sensitive here', {} as NodeJS.ProcessEnv)).toBe(
      'nothing sensitive here',
    );
  });
});

describe('release/lib retry', () => {
  it('returns the result on first success', async () => {
    const result = await retry(async () => 'ok', { attempts: 3, delayMs: 1 });
    expect(result).toBe('ok');
  });

  it('retries until success within the attempt budget', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('not yet');
        return 'ok';
      },
      { attempts: 5, delayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });

  it('throws the last error after exhausting all attempts', async () => {
    await expect(
      retry(
        async () => {
          throw new Error('always fails');
        },
        { attempts: 2, delayMs: 1 },
      ),
    ).rejects.toThrow('always fails');
  });
});
