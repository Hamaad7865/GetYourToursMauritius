import { log } from '@/lib/log';

/** Required hook; nothing to initialise here, but its presence enables instrumentation. */
export function register(): void {}

/**
 * Catch-all for server-side errors across the App Router — route handlers, server component / RSC
 * renders, metadata generation, etc. Fires IN ADDITION to any error boundary, so even a render crash
 * the user sees as a friendly fallback still produces one structured log line here. This is the single
 * place that captures server errors that never reach the `apiHandler` (e.g. a page that throws on SSR).
 */
export function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
): void {
  log.error('request_error', {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    path: request?.path,
    method: request?.method,
    routerKind: context?.routerKind,
    routePath: context?.routePath,
    routeType: context?.routeType,
    renderSource: context?.renderSource,
  });
}
