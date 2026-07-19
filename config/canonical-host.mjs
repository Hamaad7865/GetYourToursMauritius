/**
 * The single origin this app is allowed to serve on, and the only hosts exempt from being sent there.
 *
 * Extracted from next.config.mjs so it can be unit-tested: this pattern decides, for every request,
 * whether the visitor is redirected. Two earlier revisions of this rule shipped broken — once by
 * enumerating hostnames that later went stale (leaving the real origin unguarded while looking
 * correct), and once by an unwrapped alternation (below) — with nothing to catch either.
 *
 * ALLOW-LIST, not a block-list. A host we have never heard of — a retired domain, a bare Cloudflare
 * project origin, a future alias — is non-canonical BY CONSTRUCTION and gets redirected, without this
 * file needing to know its name.
 */

export const CANONICAL_HOST = 'bellemaretours.com';

/**
 * Hosts that must NOT be redirected:
 *  - the canonical origin itself;
 *  - local development;
 *  - hash-prefixed PREVIEW deployments, which are `<hash>.<project>.pages.dev` — TWO labels before
 *    `.pages.dev`, where a bare project origin has one. Previews must stay reachable to be testable;
 *    they get `X-Robots-Tag: noindex` in next.config's headers() so they never reach the index.
 *
 * The alternation MUST stay wrapped in `(?:…)`. Next matches a `has`/`missing` host by building
 * `new RegExp('^' + value + '$')`, and alternation binds looser than anchors, so an unwrapped
 * `^a|b|c$` parses as `(^a)|(b)|(c$)` — the middle branches then match ANYWHERE in the hostname and
 * `my-localhost-thing.example` is silently treated as exempt. See tests/unit/canonical-host.test.ts.
 *
 * The port group is kept even though Next appears to strip the port before matching, so the pattern
 * is correct either way.
 */
export const KEEP_HOST = String.raw`(?:bellemaretours\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?|[^.]+\.[^.]+\.pages\.dev)`;

/** `<hash>.<project>.pages.dev` — preview deployments only, never a bare project origin. */
export const PREVIEW_HOST = String.raw`[^.]+\.[^.]+\.pages\.dev`;

/** Exactly how Next compiles a `has`/`missing` host condition, so tests exercise the real semantics. */
export const hostMatcher = (pattern) => new RegExp(`^${pattern}$`);
