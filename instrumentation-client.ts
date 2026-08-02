import { reportClientError } from '@/lib/client-error-report';

/**
 * Client instrumentation — runs once in the browser at startup (before hydration). Captures the two
 * classes of crash that React error boundaries DON'T see: uncaught runtime errors (event handlers,
 * timers, scripts) and unhandled promise rejections. React render errors are reported separately from
 * the error boundaries (app/global-error.tsx, app/(site)/error.tsx).
 */
/**
 * A chunk that 404s or times out almost always means the visitor's tab is holding HTML from a build
 * we have since replaced: the filenames carry a content hash, so a deploy retires the exact URLs an
 * open tab is still waiting for. The page then sits half-loaded, and the customer's next click does
 * nothing. (Seen in error_logs on 2026-08-02, on a morning with several deploys.)
 *
 * One reload fetches the current HTML and the chunk names that go with it. Guarded by a sessionStorage
 * flag so a chunk that is genuinely missing — a broken deploy, an ad-blocker eating the request —
 * cannot put the browser in a refresh loop; the second failure is left alone and simply reported.
 */
const RELOAD_FLAG = 'gytm:chunk-reload';

function isChunkLoadFailure(message: string, error: unknown): boolean {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  // Safari/Firefox surface the same failure without the ChunkLoadError name.
  return /Loading chunk \S+ failed|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

function reloadOnceForStaleChunks(message: string, error: unknown): void {
  if (!isChunkLoadFailure(message, error)) return;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) return; // already tried — don't loop
    sessionStorage.setItem(RELOAD_FLAG, '1');
    // `true` is ignored by modern browsers but harmless; the point is a fresh document request.
    window.location.reload();
  } catch {
    /* storage disabled (private mode, embedded webview) — never reload without the guard */
  }
}

// A successful load means the chunks we hold match the HTML we hold: clear the guard so a LATER
// deploy during this same session can still trigger its own single reload.
window.addEventListener('load', () => {
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    /* storage disabled — nothing to clear */
  }
});

window.addEventListener('error', (event) => {
  reportClientError({
    kind: 'window.error',
    message: event.message || 'Uncaught error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
  });
  // Report FIRST, then recover: the reload discards this page, and the report is already on its way.
  reloadOnceForStaleChunks(event.message || '', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  reportClientError({
    kind: 'unhandledrejection',
    message,
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  // A failed `import()` rejects rather than throwing, so the stale-chunk case lands here as often as
  // it lands on window.error.
  reloadOnceForStaleChunks(message, reason);
});
