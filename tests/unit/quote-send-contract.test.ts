import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiPaths } from '@/lib/openapi/registry';

/**
 * THE PUBLISHED CONTRACT FOR POST /api/v1/admin/quotes/send, PINNED AGAINST THE HANDLER.
 *
 * This exists because the contract has now drifted from that handler TWICE. openapi.json described the
 * 409 as "Withdrawn, already accepted, or carrying a catalogue line" long after the catalogue refusal
 * had been deleted from the route: the capacity-hold path made a quote of scheduled activities
 * sendable, the handler says so in capitals, and the contract kept publishing a refusal that no code
 * can produce any more. Nothing went red, because a description is prose and prose is not executed.
 *
 * Two assertions, and they are deliberately different in kind — the first alone is what let the drift
 * happen:
 *
 *  1. THE 409 DESCRIPTION IS PINNED. On its own this is only a change-detector: it fires when someone
 *     edits registry.ts, which is not the event that broke the contract. It is here so that the
 *     census below has somewhere to send you, and so the enumeration is written down once.
 *  2. A CENSUS OF THE HANDLER'S REFUSAL SITES. This is the assertion that fires on the event that
 *     actually causes the drift — a refusal being added to or removed from the route — because it
 *     counts `throw new <ServiceError>` in the route's own source. Deleting the catalogue
 *     ConflictError would have taken `ConflictError` from 4 to 3 and turned this red, with the diff
 *     naming the class, on the commit that made the published 409 a lie.
 *
 * It is a tripwire, not a proof: it cannot tell that a refusal was REWORDED into a different meaning,
 * and extracting a throw into a helper will fail it for a reason that is not a contract change. Both
 * of those want the same answer from whoever sees it — re-read the responses in registry.ts against
 * the handler, then re-run `npm run openapi:write`.
 */

const ROUTE = join(process.cwd(), 'app', 'api', 'v1', 'admin', 'quotes', 'send', 'route.ts');

/**
 * The route's source with every comment removed.
 *
 * Nothing in the route's comments matches the needle TODAY, so this changes no number as it stands —
 * it is here because of a defect this codebase has actually shipped: a guard that passed on a string
 * that appeared in a code comment. This particular file is a standing invitation to that mistake. Its
 * header is a long prose account of which refusals it makes and which it deliberately no longer
 * makes, so a single narrative line quoting `throw new ConflictError(` would silently keep the census
 * whole across the deletion of the last real one.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');
}

/** How many times the route constructs each ServiceError subclass, keyed by class name. */
function refusalSites(source: string): Record<string, number> {
  const census: Record<string, number> = {};
  for (const match of code(source).matchAll(/throw new (\w*Error)\(/g)) {
    // The capture group cannot be absent when the pattern matched; the guard is for the compiler.
    const name = match[1];
    if (!name) continue;
    census[name] = (census[name] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(census).sort(([a], [b]) => a.localeCompare(b)));
}

describe('POST /admin/quotes/send: the published contract vs the handler', () => {
  it('publishes a 409 naming only conflicts the handler still raises', () => {
    const responses = apiPaths['/admin/quotes/send']?.post?.responses as
      | Record<string, { description?: string }>
      | undefined;
    expect(responses?.['409']?.description).toBe(
      'Withdrawn or expired, already accepted, or accepted while it was being sent',
    );
  });

  it('the handler still raises exactly the refusals the contract was written against', () => {
    // ConflictError x3 — and they are the three 409s named above: already accepted (converted_at set
    // or status 'accepted'), a status that is neither draft nor sent (withdrawn, expired), and the
    // guarded UPDATE coming back with zero rows because the guest accepted mid-send. ValidationError
    // x3 are three of the 400s (no lines, a negative total, a zero total); the fourth 400, the lapsed
    // validity window, is thrown inside assertQuoteStillValid and so is invisible to a census of this
    // file. ForbiddenError is the staff gate, NotFoundError the unknown quote, ConfigError the unset
    // site URL, ProviderError the mail outage.
    // The four bare `Error`s are the read/write failures (profile, quote, lines, update); they carry
    // no ServiceError status and so surface as the documented 500, alongside ProviderError's.
    expect(refusalSites(readFileSync(ROUTE, 'utf8'))).toEqual({
      ConfigError: 1,
      ConflictError: 3,
      Error: 4,
      ForbiddenError: 1,
      NotFoundError: 1,
      ProviderError: 1,
      ValidationError: 3,
    });
  });
});
