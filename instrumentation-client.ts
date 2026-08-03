import { reportClientError } from '@/lib/client-error-report';
import { CHUNK_RELOAD_FLAG, reloadOnceForStaleChunks } from '@/lib/stale-chunk-reload';

/**
 * Client instrumentation — runs once in the browser at startup (before hydration). Captures the two
 * classes of crash that React error boundaries DON'T see: uncaught runtime errors (event handlers,
 * timers, scripts) and unhandled promise rejections. React render errors are reported separately from
 * the error boundaries (app/global-error.tsx, app/(site)/error.tsx).
 */
// A successful load means the chunks we hold match the HTML we hold: clear the guard so a LATER
// deploy during this same session can still trigger its own single reload.
window.addEventListener('load', () => {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_FLAG);
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
