import { getServerEnv } from '@/lib/config/env';
import { ProviderError } from '@/lib/services/errors';
import {
  SEARCH_CONSOLE_SCOPE,
  getServiceAccountToken,
  parseServiceAccount,
} from '@/lib/google/service-account';

/**
 * Google **Search Console** Search Analytics reader — the one input that turns SEO work from
 * guesswork into evidence: which pages Google actually shows, for which queries, and where.
 *
 * Auth is the same service-account OAuth2 flow the Route Optimization client uses, at the
 * read-only `webmasters.readonly` scope. That means NO customer data and no write access — the
 * worst a leaked token could do is read our own public search stats.
 *
 * Configuration (all owner-side, all optional — the panel simply reports "not connected" without
 * them, and nothing else on the page is affected):
 *   • GSC_SERVICE_ACCOUNT_JSON — the service-account key JSON. Falls back to the existing
 *     GOOGLE_SERVICE_ACCOUNT_JSON so one account can serve both, if it's granted access.
 *   • GSC_SITE_URL — the Search Console property, e.g. `sc-domain:bellemaretours.com`. That exact
 *     string matters: the property is a DOMAIN property, so the `https://…/` URL-prefix form is a
 *     DIFFERENT property and returns 403.
 * The service account's email must also be added as a user on that property in Search Console —
 * the API has no other way to grant it access.
 */

const API_BASE = 'https://searchconsole.googleapis.com/webmasters/v3/sites';

/** Search Console has a ~2-3 day processing lag; asking for today just returns empty rows. */
const LAG_DAYS = 3;
const DEFAULT_WINDOW_DAYS = 28;

export interface SearchMetrics {
  clicks: number;
  impressions: number;
  /** 0–1 as Google reports it. */
  ctr: number;
  /** Average position; lower is better. */
  position: number;
}

export interface SearchRow extends SearchMetrics {
  /** The page path (page dimension) or the search term (query dimension). */
  key: string;
}

export interface SearchConsoleReport {
  /** The window actually queried, ISO yyyy-mm-dd. */
  startDate: string;
  endDate: string;
  totals: SearchMetrics;
  topPages: SearchRow[];
  topQueries: SearchRow[];
}

/** Not an error — the owner simply has not connected it yet. */
export class NotConnectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotConnectedError';
  }
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The reporting window: `days` long, ending `LAG_DAYS` before `today`. Exported for the unit test —
 * an off-by-one here silently reports a window with no data in it.
 */
export function reportWindow(today: Date, days: number = DEFAULT_WINDOW_DAYS) {
  const end = new Date(today.getTime() - LAG_DAYS * 86_400_000);
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

interface ApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/** Normalise one API row. Absent numbers mean zero; `keys` is absent on the totals query. */
function toRow(row: ApiRow, stripOrigin: string | null): SearchRow {
  const raw = row.keys?.[0] ?? '';
  // Page keys come back as absolute URLs; the admin lists paths everywhere else.
  const key =
    stripOrigin && raw.startsWith(stripOrigin) ? raw.slice(stripOrigin.length) || '/' : raw;
  return {
    key,
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

export function sumMetrics(rows: SearchRow[]): SearchMetrics {
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    // Position must be weighted by impressions — a plain mean lets a page with three impressions
    // at #2 cancel out one with three thousand at #40.
    position:
      impressions > 0 ? rows.reduce((n, r) => n + r.position * r.impressions, 0) / impressions : 0,
  };
}

async function queryDimension(
  siteUrl: string,
  token: string,
  body: Record<string, unknown>,
): Promise<ApiRow[]> {
  const res = await fetch(`${API_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    throw new NotConnectedError(
      'Search Console returned 403 — add the service account as a user on the property, and check GSC_SITE_URL matches it exactly (a domain property is "sc-domain:example.com").',
    );
  }
  if (!res.ok) throw new ProviderError(`Search Console HTTP ${res.status}`);
  const data = (await res.json()) as { rows?: ApiRow[] };
  return data.rows ?? [];
}

/**
 * The last `days` of search performance. Throws NotConnectedError when unconfigured or unauthorised
 * (the caller renders setup instructions), ProviderError on a genuine upstream failure.
 */
export async function fetchSearchConsoleReport(
  today: Date,
  days: number = DEFAULT_WINDOW_DAYS,
  limit = 25,
): Promise<SearchConsoleReport> {
  const env = getServerEnv();
  const sa = parseServiceAccount(env.GSC_SERVICE_ACCOUNT_JSON ?? env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!sa) {
    throw new NotConnectedError(
      'No Google service account is configured (GSC_SERVICE_ACCOUNT_JSON).',
    );
  }
  const siteUrl = env.GSC_SITE_URL;
  if (!siteUrl) {
    throw new NotConnectedError(
      'GSC_SITE_URL is not set — it must be the Search Console property, e.g. sc-domain:bellemaretours.com.',
    );
  }

  const { startDate, endDate } = reportWindow(today, days);
  const token = await getServiceAccountToken(sa, SEARCH_CONSOLE_SCOPE);
  const origin = env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ?? null;

  const [pageRows, queryRows] = await Promise.all([
    queryDimension(siteUrl, token, { startDate, endDate, dimensions: ['page'], rowLimit: limit }),
    queryDimension(siteUrl, token, { startDate, endDate, dimensions: ['query'], rowLimit: limit }),
  ]);

  const topPages = pageRows.map((r) => toRow(r, origin));
  return {
    startDate,
    endDate,
    // Totalled from the page rows rather than a third API call. Capped at `limit` rows, so on a
    // site with more than `limit` performing pages this is a "top pages" total, not a site total —
    // the panel labels it accordingly.
    totals: sumMetrics(topPages),
    topPages,
    topQueries: queryRows.map((r) => toRow(r, null)),
  };
}
