import { describe, expect, it } from 'vitest';
import { cleanName, metadataName, welcomeName } from '@/lib/auth/display-name';

/**
 * The welcome toast's name.
 *
 * The bug this pins: the toast read `user_metadata.full_name` — written once at registration,
 * never again — and truncated it to its first word. Someone who signed up as "Sheik" and later set
 * their name to "Amelia Boodoo" in /account was still greeted "Signed in as Sheik.", while the
 * header two lines above rendered "Amelia Boodoo" from `profiles.full_name`. The profile name wins
 * now, whole.
 */
describe('welcomeName', () => {
  it('greets by the current profile name, in full, not the signup one', () => {
    const user = { user_metadata: { full_name: 'Sheik' } };
    expect(welcomeName('Amelia Boodoo', user)).toBe('Amelia Boodoo');
  });

  it('keeps the surname — the old toast stopped at the first word', () => {
    expect(welcomeName('Amelia Boodoo', null)).not.toBe('Amelia');
  });

  it('falls back to the signup name when the profile has none', () => {
    // A profile row with a null name, or a read that failed — loadProfile resolves null for both.
    const user = { user_metadata: { full_name: 'Sheik Boodoo' } };
    expect(welcomeName(null, user)).toBe('Sheik Boodoo');
  });

  it('reads the OAuth `name` claim when there is no full_name', () => {
    expect(welcomeName(null, { user_metadata: { name: 'Jean Dupont' } })).toBe('Jean Dupont');
  });

  it('returns null when neither side has a name, so the toast greets generically', () => {
    expect(welcomeName(null, { user_metadata: {} })).toBeNull();
    expect(welcomeName(null, null)).toBeNull();
    expect(welcomeName(undefined, undefined)).toBeNull();
  });

  it('treats a blank or whitespace-only profile name as no name at all', () => {
    const user = { user_metadata: { full_name: 'Sheik' } };
    expect(welcomeName('   ', user)).toBe('Sheik');
    expect(welcomeName('', user)).toBe('Sheik');
  });

  it('ignores a non-string metadata name rather than rendering [object Object]', () => {
    expect(welcomeName(null, { user_metadata: { full_name: { first: 'Sheik' } } })).toBeNull();
  });
});

describe('cleanName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(cleanName('  Amelia   Boodoo ')).toBe('Amelia Boodoo');
  });

  it('rejects empty and whitespace-only names', () => {
    expect(cleanName('')).toBeNull();
    expect(cleanName('\t \n')).toBeNull();
    expect(cleanName(null)).toBeNull();
    expect(cleanName(undefined)).toBeNull();
  });
});

describe('metadataName', () => {
  it('prefers full_name over name when both are present', () => {
    expect(metadataName({ user_metadata: { full_name: 'Full Name', name: 'Other' } })).toBe(
      'Full Name',
    );
  });

  it('survives a missing or null metadata bag', () => {
    expect(metadataName({})).toBeNull();
    expect(metadataName({ user_metadata: null })).toBeNull();
    expect(metadataName(null)).toBeNull();
  });
});
