import { getBrowserSupabase } from '@/lib/supabase/browser';
import type { SearchConsoleReport } from '@/lib/seo/search-console';

/**
 * Live fetch through the content-editor-gated API route (needs the server-only service-account
 * key). Never cached. Distinguishes "not connected yet" from a real failure so the panel can show
 * setup steps instead of an error.
 */
export class SearchConsoleNotConnected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchConsoleNotConnected';
  }
}

export async function loadSearchConsoleReport(days = 28): Promise<SearchConsoleReport> {
  const {
    data: { session },
  } = await getBrowserSupabase().auth.getSession();
  const res = await fetch(`/api/v1/seo/search-console?days=${days}`, {
    headers: session ? { authorization: `Bearer ${session.access_token}` } : {},
  });
  // Every /api/v1 route wraps its payload in the standard { ok, data } envelope (see
  // src/lib/http/envelope.ts) — the result is at body.data, not the top level.
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: SearchConsoleReport;
    error?: { code?: string; message?: string };
  } | null;
  if (res.status === 503 && body?.error?.code === 'not_configured') {
    throw new SearchConsoleNotConnected(body.error.message ?? 'Search Console is not connected.');
  }
  if (!res.ok || !body?.ok || !body.data) {
    throw new Error(body?.error?.message ?? 'Could not load Search Console data.');
  }
  return body.data;
}
