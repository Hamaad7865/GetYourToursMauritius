import { z } from 'zod';

/**
 * A browser-side error report POSTed to /api/v1/client-errors. Every field is bounded so a malicious
 * or runaway client can't bloat the logs. The client reporter caps the same fields; this is the
 * authoritative server-side limit. Shared with the OpenAPI registry so the spec can't drift.
 */
export const clientErrorReportSchema = z.object({
  /** Origin of the report, e.g. 'window.error' | 'unhandledrejection' | 'react.boundary'. */
  kind: z.string().max(40),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  source: z.string().max(300).optional(),
  /** Next.js error-boundary digest, when reported from a boundary. */
  digest: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
  ua: z.string().max(300).optional(),
});
export type ClientErrorReportInput = z.infer<typeof clientErrorReportSchema>;
