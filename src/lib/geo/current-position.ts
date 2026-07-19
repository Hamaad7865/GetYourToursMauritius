/**
 * A safe wrapper around the browser Geolocation API for the planner's pick-up detection.
 *
 * The raw API has three traps this exists to close:
 *  1. **A dismissed permission prompt fires NO callback at all** in several browsers — the promise
 *     would hang forever. Our own timer is the backstop, independent of the API's `timeout` option.
 *  2. It throws / never resolves in an insecure context (plain http), which is a config mistake, not
 *     a user decision — worth distinguishing so we never mistake it for "the user said no".
 *  3. Callbacks can fire twice (or after we've given up); every path is latched so a late fix can't
 *     resolve an already-settled promise.
 *
 * Never rejects. Every failure is a typed outcome, because the caller's correct response to ALL of
 * them is identical: silently keep the existing default pick-up.
 */

export type PositionFailure =
  | 'unsupported' // no navigator.geolocation (old/embedded browser)
  | 'insecure' // not a secure context — the API is unavailable by spec
  | 'denied' // the visitor declined (or a Permissions-Policy blocked it)
  | 'unavailable' // no fix obtainable (no GPS/wifi signal)
  | 'timeout'; // took too long, or the prompt was dismissed without an answer

export type PositionOutcome =
  | { ok: true; lat: number; lng: number; accuracyM: number }
  | { ok: false; reason: PositionFailure };

/** Default budget. Long enough for a cold GPS fix on mobile, short enough that a dismissed prompt
 *  doesn't leave the field looking stuck. */
const DEFAULT_TIMEOUT_MS = 8000;

export interface CurrentPositionOptions {
  timeoutMs?: number;
  /** Injectable for tests; defaults to the browser's geolocation. */
  geolocation?: Pick<Geolocation, 'getCurrentPosition'> | null;
  /** Injectable for tests; defaults to `window.isSecureContext`. */
  secureContext?: boolean;
}

/** Map a GeolocationPositionError code onto our reasons (the numeric codes are stable per spec). */
function reasonFromError(err: { code?: number }): PositionFailure {
  switch (err.code) {
    case 1:
      return 'denied'; // PERMISSION_DENIED
    case 2:
      return 'unavailable'; // POSITION_UNAVAILABLE
    case 3:
      return 'timeout'; // TIMEOUT
    default:
      return 'unavailable';
  }
}

/**
 * Resolve the visitor's current position, or a typed reason why not. Always settles within
 * `timeoutMs` even if the browser never calls back.
 */
export function getCurrentPosition(opts: CurrentPositionOptions = {}): Promise<PositionOutcome> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const geo =
    opts.geolocation !== undefined
      ? opts.geolocation
      : typeof navigator !== 'undefined'
        ? (navigator.geolocation ?? null)
        : null;
  const secure =
    opts.secureContext ??
    (typeof window !== 'undefined' ? window.isSecureContext !== false : false);

  if (!geo) return Promise.resolve({ ok: false, reason: 'unsupported' });
  // The API exists but is inert on plain http; calling it would hang or throw. Report it honestly so
  // a misconfigured deployment is distinguishable from a visitor declining.
  if (!secure) return Promise.resolve({ ok: false, reason: 'insecure' });

  return new Promise<PositionOutcome>((resolve) => {
    let settled = false;
    const finish = (outcome: PositionOutcome) => {
      if (settled) return; // a late/duplicate callback must never re-resolve
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    // Our own backstop: a DISMISSED prompt calls neither callback, so the API's own `timeout` never
    // fires either and the promise would hang for the life of the page.
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeoutMs);

    try {
      geo.getCurrentPosition(
        (pos) =>
          finish({
            ok: true,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
          }),
        (err) => finish({ ok: false, reason: reasonFromError(err) }),
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
      );
    } catch {
      // Some embedded webviews throw synchronously rather than calling the error callback.
      finish({ ok: false, reason: 'unsupported' });
    }
  });
}
