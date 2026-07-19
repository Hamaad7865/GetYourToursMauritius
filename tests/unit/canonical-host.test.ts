import { describe, expect, it } from 'vitest';
// Plain .mjs because next.config.mjs shares it and cannot import TypeScript.
import {
  CANONICAL_HOST,
  KEEP_HOST,
  PREVIEW_HOST,
  hostMatcher,
} from '../../config/canonical-host.mjs';

/**
 * The canonical-host redirect decides, for EVERY request, whether the visitor is bounced to the one
 * allowed origin. Two earlier revisions shipped broken with nothing to catch them:
 *
 *  1. It enumerated non-canonical hostnames. One of those names was assumed rather than verified, so
 *     the list guarded a host that did not exist while the real origin served a full, crawlable copy
 *     of the site — and split cookies/localStorage, which is what breaks a cart across a payment
 *     return. The rule looked correct the whole time.
 *  2. The replacement allow-list used an unwrapped alternation. Next compiles a `has`/`missing` host
 *     as `new RegExp('^' + value + '$')`, and alternation binds looser than anchors, so `^a|b|c$`
 *     parses as `(^a)|(b)|(c$)` — the middle branches match anywhere in the hostname.
 *
 * These tests exercise the pattern through `hostMatcher`, which reproduces Next's wrapping exactly.
 */
const keep = hostMatcher(KEEP_HOST);
const isRedirected = (host: string) => !keep.test(host);

describe('canonical host allow-list', () => {
  it.each(['bellemaretours.com', 'localhost', 'localhost:3000', '127.0.0.1', '127.0.0.1:3000'])(
    'serves %s directly',
    (host) => {
      expect(isRedirected(host)).toBe(false);
    },
  );

  it('exempts a hash-prefixed preview deployment so it stays testable', () => {
    expect(isRedirected('abc123.someproject.pages.dev')).toBe(false);
  });

  it('redirects a BARE project origin (one label before pages.dev, not two)', () => {
    // This is the case that regressed: a bare project origin is a full duplicate of the site.
    expect(isRedirected('someproject.pages.dev')).toBe(true);
    expect(isRedirected('another-project.pages.dev')).toBe(true);
  });

  it('redirects any host it has never heard of — the point of an allow-list', () => {
    for (const host of ['www.bellemaretours.com', 'some-retired-domain.com', 'example.org']) {
      expect(isRedirected(host), host).toBe(true);
    }
  });

  it('is not fooled by a hostname that merely CONTAINS an exempt substring', () => {
    // Regression guard for the unwrapped-alternation bug: without `(?:…)` these matched and were
    // silently treated as canonical, so they were never redirected.
    for (const host of [
      'my-localhost-thing.example',
      'bellemaretours.com.evil.example',
      'evil.example-127.0.0.1.test',
      'notbellemaretours.com',
    ]) {
      expect(isRedirected(host), host).toBe(true);
    }
  });

  it('keeps the alternation wrapped, so the anchors apply to the whole pattern', () => {
    expect(KEEP_HOST.startsWith('(?:')).toBe(true);
    expect(KEEP_HOST.endsWith(')')).toBe(true);
  });

  it('redirects to a bare canonical host (no scheme, no trailing slash, no port)', () => {
    expect(CANONICAL_HOST).toBe('bellemaretours.com');
    expect(CANONICAL_HOST).not.toMatch(/^https?:|\/|:\d/);
  });
});

describe('preview-host pattern (drives X-Robots-Tag: noindex)', () => {
  const preview = hostMatcher(PREVIEW_HOST);

  it('matches a preview deployment but NOT the bare project origin', () => {
    expect(preview.test('abc123.someproject.pages.dev')).toBe(true);
    // The bare origin is already 308'd away, so it must not be the thing we merely noindex.
    expect(preview.test('someproject.pages.dev')).toBe(false);
  });

  it('does not match the canonical host', () => {
    expect(preview.test(CANONICAL_HOST)).toBe(false);
  });
});
