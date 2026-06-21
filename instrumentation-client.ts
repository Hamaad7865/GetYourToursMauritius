import { reportClientError } from '@/lib/client-error-report';

/**
 * Client instrumentation — runs once in the browser at startup (before hydration). Captures the two
 * classes of crash that React error boundaries DON'T see: uncaught runtime errors (event handlers,
 * timers, scripts) and unhandled promise rejections. React render errors are reported separately from
 * the error boundaries (app/global-error.tsx, app/(site)/error.tsx).
 */
window.addEventListener('error', (event) => {
  reportClientError({
    kind: 'window.error',
    message: event.message || 'Uncaught error',
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportClientError({
    kind: 'unhandledrejection',
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});
