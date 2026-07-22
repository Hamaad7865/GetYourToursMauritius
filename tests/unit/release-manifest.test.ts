import { describe, expect, it } from 'vitest';
import { validateManifestShape } from '../../scripts/release/verify-manifest.mjs';

const VALID = {
  schemaVersion: 1,
  gitSha: 'a'.repeat(40),
  githubRunId: '123456',
  buildTimestamp: '2026-07-21T00:00:00.000Z',
  nodeVersion: 'v22.0.0',
  npmVersion: '10.0.0',
  packageLockSha256: 'b'.repeat(64),
  artifactSha256: 'c'.repeat(64),
};

describe('release/verify-manifest validateManifestShape', () => {
  it('accepts a well-formed manifest', () => {
    expect(validateManifestShape(VALID)).toEqual([]);
  });

  it('rejects a manifest missing required fields', () => {
    const rest = { ...VALID, gitSha: undefined };
    const errors = validateManifestShape(rest);
    expect(errors.some((e) => e.includes('gitSha'))).toBe(true);
  });

  it('rejects a non-hex gitSha', () => {
    const errors = validateManifestShape({ ...VALID, gitSha: 'not-a-sha!' });
    expect(errors.some((e) => e.includes('gitSha'))).toBe(true);
  });

  it('rejects a malformed artifactSha256', () => {
    const errors = validateManifestShape({ ...VALID, artifactSha256: 'too-short' });
    expect(errors.some((e) => e.includes('artifactSha256'))).toBe(true);
  });

  it('rejects a null manifest', () => {
    const errors = validateManifestShape(null);
    expect(errors.length).toBeGreaterThan(0);
  });
});
