/**
 * Best-effort client-side error reporter. Sends a bounded, de-duplicated payload to
 * `/api/v1/client-errors`, which logs it server-side so browser crashes land in the same Cloudflare
 * log pipeline as server errors. Must NEVER throw — reporting an error can't be allowed to cause
 * another one — so every path is wrapped/swallowed.
 */
export interface ClientErrorReport {
  /** Where it came from, e.g. 'window.error' | 'unhandledrejection' | 'react.boundary'. */
  kind: string;
  message: string;
  stack?: string | undefined;
  source?: string | undefined;
  /** Next.js error boundary digest, when reporting from an error boundary. */
  digest?: string | undefined;
}

const MAX_REPORTS = 10; // per page load — stop a render loop from flooding the endpoint
let sent = 0;
const seen = new Set<string>();

export function reportClientError(report: ClientErrorReport): void {
  try {
    if (typeof window === 'undefined') return;
    if (sent >= MAX_REPORTS) return;

    const message = String(report.message ?? 'Unknown error').slice(0, 500);
    const key = `${report.kind}:${message}`;
    if (seen.has(key)) return; // de-dupe identical errors within a session
    seen.add(key);
    sent += 1;

    const body = JSON.stringify({
      kind: String(report.kind).slice(0, 40),
      message,
      stack: report.stack ? String(report.stack).slice(0, 4000) : undefined,
      source: report.source ? String(report.source).slice(0, 300) : undefined,
      digest: report.digest ? String(report.digest).slice(0, 100) : undefined,
      url: window.location.href.slice(0, 500),
      ua: navigator.userAgent.slice(0, 300),
    });

    void fetch('/api/v1/client-errors', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true, // still sends if the page is navigating away / unloading
    }).catch(() => {
      /* swallow — reporting is best-effort */
    });
  } catch {
    /* never let the reporter itself throw */
  }
}
