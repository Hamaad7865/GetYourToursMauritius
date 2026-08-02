import { describe, expect, it } from 'vitest';
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  NOTICE_VERSION,
  consentModePayload,
  readConsent,
  serializeConsent,
  shouldShowNotice,
} from '@/lib/consent/notice';

const stored = (v: Record<string, unknown>) => JSON.stringify(v);

describe('shouldShowNotice', () => {
  it('shows when nothing is stored', () => {
    expect(shouldShowNotice(null)).toBe(true);
  });

  it('shows when the stored value is malformed', () => {
    expect(shouldShowNotice('not json')).toBe(true);
    expect(shouldShowNotice('{}')).toBe(true);
    expect(shouldShowNotice('null')).toBe(true);
    expect(shouldShowNotice('"a string"')).toBe(true);
  });

  it('hides when a choice was recorded at the current version', () => {
    expect(shouldShowNotice(stored({ version: NOTICE_VERSION, analytics: false }))).toBe(false);
  });

  it('re-prompts a visitor who only acknowledged the OLD notice-only bar', () => {
    // v1 promised "no tracking or ads". That agreement cannot carry over to analytics consent.
    expect(shouldShowNotice(stored({ acknowledged: true, version: 1, ts: 1 }))).toBe(true);
  });
});

describe('readConsent', () => {
  it('returns null when there is no choice at the current version', () => {
    expect(readConsent(null)).toBeNull();
    expect(readConsent('garbage')).toBeNull();
    expect(readConsent(stored({ acknowledged: true, version: 1 }))).toBeNull();
  });

  it('reads back what was written', () => {
    const choice = { analytics: true, marketing: false };
    expect(readConsent(serializeConsent(choice, 123))).toEqual(choice);
  });

  it('treats any non-true value as denied — absence of a yes is never consent', () => {
    expect(
      readConsent(stored({ version: NOTICE_VERSION, analytics: 'yes', marketing: 1 })),
    ).toEqual({ analytics: false, marketing: false });
    expect(readConsent(stored({ version: NOTICE_VERSION }))).toEqual(CONSENT_DENIED);
  });
});

describe('serializeConsent', () => {
  it('stamps the current version and the given timestamp', () => {
    expect(JSON.parse(serializeConsent(CONSENT_GRANTED, 123))).toEqual({
      version: NOTICE_VERSION,
      ts: 123,
      analytics: true,
      marketing: true,
    });
  });
});

describe('consentModePayload', () => {
  it('denies every opt-in signal before consent, but keeps the necessary ones granted', () => {
    expect(consentModePayload(CONSENT_DENIED)).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      personalization_storage: 'denied',
      functionality_storage: 'granted',
      security_storage: 'granted',
    });
  });

  it('grants everything on accept-all', () => {
    const p = consentModePayload(CONSENT_GRANTED);
    expect(Object.values(p).every((v) => v === 'granted')).toBe(true);
  });

  it('keeps analytics and marketing independent', () => {
    const analyticsOnly = consentModePayload({ analytics: true, marketing: false });
    expect(analyticsOnly.analytics_storage).toBe('granted');
    expect(analyticsOnly.ad_storage).toBe('denied');
    expect(analyticsOnly.ad_user_data).toBe('denied');
    expect(analyticsOnly.ad_personalization).toBe('denied');

    const marketingOnly = consentModePayload({ analytics: false, marketing: true });
    expect(marketingOnly.analytics_storage).toBe('denied');
    expect(marketingOnly.ad_storage).toBe('granted');
  });
});
