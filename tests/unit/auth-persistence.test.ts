import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAuthPersistence,
  rememberAwareStorage,
  setAuthPersistence,
} from '@/lib/supabase/browser';

/**
 * "Keep me signed in" (the sign-in dialog checkbox). Ticked — the default, and what every account
 * had before the checkbox existed — puts the Supabase session in localStorage so it survives a
 * browser restart. Unticked puts it in sessionStorage, which dies with the tab: the point of the
 * option on a shared or hotel computer.
 *
 * The env is `node`, so both stores are stubbed onto a fake `window`.
 */
const SESSION_KEY = 'gytm:auth';
const REMEMBER_KEY = 'gytm:auth:remember';

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

let local: Storage;
let session: Storage;

beforeEach(() => {
  local = fakeStorage();
  session = fakeStorage();
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('auth persistence flag', () => {
  it('defaults to remembering, so adding the checkbox signs nobody out', () => {
    expect(getAuthPersistence()).toBe(true);
    expect(local.getItem(REMEMBER_KEY)).toBeNull();
  });

  it('records only the opt-out, and clears it again when re-ticked', () => {
    setAuthPersistence(false);
    expect(local.getItem(REMEMBER_KEY)).toBe('0');
    expect(getAuthPersistence()).toBe(false);

    setAuthPersistence(true);
    expect(local.getItem(REMEMBER_KEY)).toBeNull();
    expect(getAuthPersistence()).toBe(true);
  });

  it('survives storage being unavailable (private mode)', () => {
    vi.stubGlobal('window', {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
      get sessionStorage(): Storage {
        throw new Error('blocked');
      },
    });
    expect(() => setAuthPersistence(false)).not.toThrow();
    expect(getAuthPersistence()).toBe(true);
    expect(rememberAwareStorage.getItem(SESSION_KEY)).toBeNull();
    expect(() => rememberAwareStorage.setItem(SESSION_KEY, 'tok')).not.toThrow();
  });
});

describe('remember-aware session storage', () => {
  it('writes the session to localStorage while remembering', () => {
    rememberAwareStorage.setItem(SESSION_KEY, 'tok');
    expect(local.getItem(SESSION_KEY)).toBe('tok');
    expect(session.getItem(SESSION_KEY)).toBeNull();
    expect(rememberAwareStorage.getItem(SESSION_KEY)).toBe('tok');
  });

  it('writes to sessionStorage — and NOT localStorage — when not remembering', () => {
    setAuthPersistence(false);
    rememberAwareStorage.setItem(SESSION_KEY, 'tok');
    expect(session.getItem(SESSION_KEY)).toBe('tok');
    expect(local.getItem(SESSION_KEY)).toBeNull();
  });

  it('evicts an earlier remembered session from localStorage on a not-remembered sign-in', () => {
    // The security promise of the checkbox: nothing recoverable after the browser closes.
    rememberAwareStorage.setItem(SESSION_KEY, 'old');
    setAuthPersistence(false);
    rememberAwareStorage.setItem(SESSION_KEY, 'new');
    expect(local.getItem(SESSION_KEY)).toBeNull();
    expect(session.getItem(SESSION_KEY)).toBe('new');
  });

  it('keeps an existing session readable when the flag flips without a completed sign-in', () => {
    // Untick the box, then fail the submit: the old session must not vanish under the user.
    rememberAwareStorage.setItem(SESSION_KEY, 'tok');
    setAuthPersistence(false);
    expect(rememberAwareStorage.getItem(SESSION_KEY)).toBe('tok');
  });

  it('clears both stores on sign-out, whichever one held the session', () => {
    rememberAwareStorage.setItem(SESSION_KEY, 'remembered');
    setAuthPersistence(false);
    rememberAwareStorage.setItem(SESSION_KEY, 'not-remembered');
    rememberAwareStorage.removeItem(SESSION_KEY);
    expect(local.getItem(SESSION_KEY)).toBeNull();
    expect(session.getItem(SESSION_KEY)).toBeNull();
    expect(rememberAwareStorage.getItem(SESSION_KEY)).toBeNull();
  });
});
