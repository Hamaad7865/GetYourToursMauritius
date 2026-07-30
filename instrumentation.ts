import { log } from '@/lib/log';
import { recordError, describeThrown } from '@/lib/error-log';

/** Required hook; nothing to initialise here, but its presence enables instrumentation. */
export function register(): void {}

/**
 * Catch-all for server-side errors across the App Router — route handlers, server component / RSC
 * renders, metadata generation, etc. Fires IN ADDITION to any error boundary, so even a render crash
 * the user sees as a friendly fallback still produces one structured log line here. This is the single
 * place that captures server errors that never reach the `apiHandler` (e.g. a page that throws on SSR).
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string },
): Promise<void> {
  const { errorName, message, stack } = describeThrown(error);
  log.error('request_error', {
    name: errorName,
    message,
    stack,
    path: request?.path,
    method: request?.method,
    routerKind: context?.routerKind,
    routePath: context?.routePath,
    routeType: context?.routeType,
    renderSource: context?.renderSource,
  });
  // …and durably, so an SSR crash is still findable tomorrow. A page render that throws never reaches
  // apiHandler, so without this the whole non-API half of the app would be missing from error_logs.
  await recordError({
    source: 'ssr',
    event: 'request_error',
    message,
    errorName,
    stack,
    route: request?.path,
    method: request?.method,
    context: {
      routerKind: context?.routerKind,
      routePath: context?.routePath,
      routeType: context?.routeType,
      renderSource: context?.renderSource,
    },
  });
}
