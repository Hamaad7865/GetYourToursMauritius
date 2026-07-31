import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentOutcome,
  PaymentProvider,
  VerifyWebhookInput,
} from './types';
import { ProviderError } from '@/lib/services/errors';
import { log } from '@/lib/log';

export interface PeachConfig {
  /** OAuth client credentials (sandbox Dashboard → Settings → API keys). */
  clientId: string;
  clientSecret: string;
  merchantId: string;
  /** Channel/entity id — keys both the create-checkout body and the browser widget. */
  entityId: string;
  /**
   * HMAC-SHA256 secret Peach signs webhook notifications with. HMAC is ENABLED in production (Peach
   * activated it on 2026-06-25; the secret is set in the Pages env), so the signed fast-path is the
   * primary confirmation route. Still typed optional: dev/CI run the stub provider, and verifyWebhook
   * fails closed when it's absent (confirmation then relies on the status re-query / sync / cron).
   */
  webhookSecret?: string;
  /** Auth service base, e.g. https://sandbox-... (POST {authBaseUrl}/api/oauth/token). */
  authBaseUrl: string;
  /** Checkout API base, e.g. https://testsecure.peachpayments.com (POST {checkoutBaseUrl}/v2/checkout). */
  checkoutBaseUrl: string;
  /**
   * The publicly-reachable URL Peach calls with settlement notifications. Peach signs the HMAC over
   * this exact URL, so verifyWebhook needs it to recompute the signature. Sent as `notificationUrl`
   * on each checkout so it works without dashboard webhook config (e.g. a local tunnel). Set in
   * production alongside the HMAC secret; typed optional only so dev/CI (stub provider) build —
   * verifyWebhook fails closed without it.
   */
  webhookUrl?: string;
  environment: 'test' | 'live';
}

/**
 * Peach result-code prefixes for a successful authorisation/capture, per Peach's own published
 * classification (developer.peachpayments.com/docs/dashboard-response-codes):
 *   /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.[1][12]0)/
 *
 * This shipped as only `000.000.` + `000.100.1`, which meant the `000.3*` (two-step succeeded),
 * `000.6*` and `000.400.110`/`000.400.120` families fell through the chain in `outcomeFor` and were
 * recorded as FAILURES — a captured payment written to the ledger as a failed one, which left the
 * booking unconfirmed with the customer's money taken.
 */
const SUCCESS_CODE = /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.1[12]0)/;
/**
 * "Successfully processed, but flagged for manual review" (fraud suspicion, AVS mismatch, …):
 *   /^(000\.400\.0[^3]|000\.400\.100)/
 *
 * The money IS captured — Peach's own note is that these are charged but need verification before
 * fulfilment. So they settle like any other capture and are additionally flagged for a human via
 * `payments.settlement_review_at`; recording them as failures charged the customer for nothing.
 * `000.400.03*` is excluded by the `[^3]` — that family is REJECTED for risk, not captured.
 */
const REVIEW_CODE = /^(000\.400\.0[^3]|000\.400\.100)/;
/**
 * Still open / awaiting confirmation. `000.200` is the short-lived widget session (~30 min);
 * `800.400.5*` and `100.400.500` are the long-life-cycle families, which Peach documents as pending
 * confirmation from external systems and can stay unresolved for days — treating those as failed
 * both lost the payment and (before this sweep) latched the booking out of every recovery path.
 */
const PENDING_CODE = /^(000\.200|800\.400\.5|100\.400\.500)/;
/**
 * "Cancelled by user" — the customer closed or abandoned the widget. Peach CLOSES the session on this
 * code: it can never be paid, and re-mounting the widget with it fires `onCancelled` immediately.
 *
 * Deliberately this ONE code, not the whole 100.396.* family: its siblings cover timeouts and
 * `100.396.104 Uncertain status`, where the session may still be payable — treating those as dead
 * would let us mint a SECOND payable session and double-charge the card. Verified against the live
 * status endpoint for the booking that exposed the trap (2026-07-24).
 */
const CANCELLED_BY_USER_CODE = '100.396.101';

/** Module-scoped OAuth token cache (reused across requests within an edge isolate). */
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;
/**
 * The token request currently in flight, so concurrent callers share ONE round-trip instead of each
 * opening their own. Without this, `prewarm()` racing `createCheckout()` in the same request would
 * fetch the token twice — the exact opposite of the point.
 */
let tokenInFlight: { key: string; promise: Promise<string> } | null = null;

/** Hard timeout for every outbound Peach call. Without it a slow / unreachable Peach hangs the edge
 *  worker until Cloudflare gives up and returns a 502 Bad Gateway (an HTML page the client can't parse).
 *  With it the call fails fast as a ProviderError → a clean JSON 5xx the UI can show. */
const PEACH_TIMEOUT_MS = 12_000;

/** Above this, a Peach call is logged as a warning rather than info — it's the difference between
 *  "normal" and "the customer is staring at a spinner". Peach's own create-checkout has a heavy tail
 *  (measured 2026-07-25: median ~0.84s, but roughly 1 call in 12 takes 5-10s on an already-warm
 *  connection), so this is the line between the two populations, not an error threshold. */
const PEACH_SLOW_MS = 3_000;

/** fetch() with an AbortController timeout, normalising a timeout/network failure into a ProviderError
 *  (so it surfaces as our JSON envelope, never as a worker hang → CDN 502).
 *
 *  Every call is TIMED and logged. When a customer reports "the payment form took ages", the answer
 *  has to come from production rather than be reconstructed afterwards from the provider's own
 *  timestamps — which is what the 2026-07-24 investigation had to do, and it could only attribute the
 *  wait to "somewhere inside the Peach leg". `op` keeps the line greppable without logging URLs
 *  (which carry checkout ids). */
async function fetchPeach(url: string, init: RequestInit, op: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PEACH_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const ms = Date.now() - startedAt;
    const fields = { op, ms, status: res.status };
    if (ms >= PEACH_SLOW_MS) log.warn('peach_call_slow', fields);
    else log.info('peach_call', fields);
    return res;
  } catch (error) {
    const ms = Date.now() - startedAt;
    const timedOut = error instanceof Error && error.name === 'AbortError';
    log.error('peach_call_failed', { op, ms, timedOut, timeoutMs: PEACH_TIMEOUT_MS });
    throw new ProviderError(
      timedOut
        ? `Peach request timed out after ${PEACH_TIMEOUT_MS}ms`
        : 'Peach request failed (network)',
      { url, timedOut },
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Peach Payments **Checkout** provider (embedded widget). Edge-safe: fetch for the API,
 * Web Crypto (HMAC-SHA256) for webhook verification — no Node built-ins.
 *
 * Flow: OAuth token (clientId/secret/merchantId) → POST /v2/checkout (→ checkoutId) → the browser
 * mounts the widget with that checkoutId. Settlement is confirmed ONLY via the verified webhook.
 */
export class PeachPaymentProvider implements PaymentProvider {
  readonly name = 'peach';

  constructor(private readonly config: PeachConfig) {}

  async createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession> {
    const token = await this.accessToken();
    const body: Record<string, unknown> = {
      authentication: { entityId: this.config.entityId },
      merchantTransactionId: input.bookingRef,
      amount: input.amount.toFixed(2),
      currency: input.currency,
      paymentType: 'DB',
      // Unique per request — Peach rejects a duplicate nonce, which doubles as idempotency.
      nonce: crypto.randomUUID(),
      shopperResultUrl: input.returnUrl,
    };
    if (this.config.webhookUrl) body.notificationUrl = this.config.webhookUrl;

    const res = await fetchPeach(
      `${trimSlash(this.config.checkoutBaseUrl)}/v2/checkout`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Origin: originOf(input.returnUrl),
        },
        body: JSON.stringify(body),
      },
      'create_checkout',
    );
    if (!res.ok) {
      // Capture Peach's rejection reason in the logs (no secrets — entityId is the public widget key,
      // the rest is request metadata + Peach's own error body) so a create-checkout 4xx is diagnosable.
      const detail = await safeText(res);
      log.error('peach_create_checkout_failed', {
        status: res.status,
        body: detail,
        amount: body.amount,
        currency: body.currency,
        entityId: this.config.entityId,
        environment: this.config.environment,
        checkoutBaseUrl: this.config.checkoutBaseUrl,
      });
      throw new ProviderError(`Peach create-checkout failed (${res.status})`, detail);
    }
    const data = (await res.json()) as { checkoutId?: string; result?: { code?: string } };
    if (!data.checkoutId) {
      throw new ProviderError('Peach create-checkout returned no checkoutId', data);
    }
    return { id: data.checkoutId, checkoutId: data.checkoutId, provider: this.name };
  }

  async verifyWebhook(input: VerifyWebhookInput): Promise<PaymentEvent> {
    const headers = input.headers ?? {};
    const timestamp = headers['x-webhook-timestamp'];
    const webhookId = headers['x-webhook-id'] ?? '';
    const signature = headers['x-webhook-signature'] ?? input.signature ?? '';
    if (!timestamp || !signature) {
      throw new ProviderError('Missing Peach webhook signature headers');
    }
    if (!this.config.webhookUrl) {
      // Fail closed: without the signed URL we cannot recompute the HMAC.
      throw new ProviderError('PEACH_WEBHOOK_URL is not configured — cannot verify the signature');
    }
    if (!this.config.webhookSecret) {
      // Fail closed: no HMAC secret in this env (dev/CI, or a prod misconfig). HMAC is enabled in
      // production, so reaching here on the live site means PEACH_WEBHOOK_SECRET is unset/not redeployed.
      throw new ProviderError(
        'Peach webhook HMAC secret not configured — cannot verify the signature',
      );
    }

    // Peach signs `${timestamp}.${webhookId}.${url}.${payload}` with HMAC-SHA256 (hex).
    const message = `${timestamp}.${webhookId}.${this.config.webhookUrl}.${input.rawBody}`;
    const expected = await hmacSha256Hex(this.config.webhookSecret, message);
    if (!timingSafeEqualHex(expected, signature)) {
      throw new ProviderError('Invalid Peach webhook signature');
    }

    const fields = extractWebhookFields(input.rawBody, headers['content-type'] ?? '');
    const outcome = outcomeFor(fields.resultCode, fields.paymentType);
    return {
      outcome,
      bookingRef: fields.merchantTransactionId,
      providerReference: fields.transactionId ?? fields.checkoutId,
      providerCheckoutId: fields.checkoutId,
      needsReview: needsManualReview(fields.resultCode),
      amountMinor: fields.amountMinor,
      currency: fields.currency,
      raw: fields.raw,
    };
  }

  async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    const token = await this.accessToken();
    const res = await fetchPeach(
      `${trimSlash(this.config.checkoutBaseUrl)}/v2/checkout/${encodeURIComponent(checkoutId)}/status`,
      { headers: { Authorization: `Bearer ${token}` } },
      'checkout_status',
    );
    if (!res.ok) {
      throw new ProviderError(`Peach status query failed (${res.status})`, await safeText(res));
    }
    // The status payload is flat with dotted keys (result.code, card.bin, …) plus merchantTransactionId,
    // amount, currency, id, paymentType.
    const data = (await res.json()) as Record<string, unknown>;
    const str = (k: string): string | null => {
      const v = data[k];
      return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
    };
    const amountStr = str('amount');
    const amount = amountStr != null ? Number.parseFloat(amountStr) : NaN;
    return {
      outcome: outcomeFor(str('result.code'), str('paymentType')),
      bookingRef: str('merchantTransactionId'),
      providerReference: str('id') ?? checkoutId,
      // The session we asked about — which is the one the money was taken on, whatever else the
      // booking has since minted. reconcilePaymentEvent uses it to credit the right payment row.
      providerCheckoutId: checkoutId,
      needsReview: needsManualReview(str('result.code')),
      amountMinor: Number.isFinite(amount) ? Math.round(amount * 100) : null,
      currency: str('currency'),
      checkoutTerminal: str('result.code') === CANCELLED_BY_USER_CODE,
      raw: data,
    };
  }

  /**
   * Start the OAuth round-trip NOW, without waiting for its result.
   *
   * The token is a prerequisite of create-checkout but depends on nothing else in the request, and it
   * lives on a THIRD host (the auth base) whose DNS/TCP/TLS a cold isolate has to set up from scratch
   * — measured at 1.0–1.8s. Kicking it off alongside the DB work that has to happen first means the
   * customer waits for the slower of the two rather than their sum. Fire-and-forget on purpose: the
   * token is cached, so `createCheckout` picks it up (or joins the same in-flight promise), and any
   * failure surfaces there, where it can be handled properly.
   */
  prewarm(): void {
    void this.accessToken().catch(() => {
      // Swallowed here only — createCheckout re-requests and reports the real failure.
    });
  }

  /** Cached OAuth bearer token; refreshes shortly before expiry. */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (
      tokenCache &&
      tokenCache.key === this.config.clientId &&
      tokenCache.expiresAt > now + 5_000
    ) {
      return tokenCache.token;
    }
    // Someone (usually prewarm) already asked — wait on their round-trip rather than opening a second.
    if (tokenInFlight && tokenInFlight.key === this.config.clientId) {
      return tokenInFlight.promise;
    }
    const promise = this.fetchAccessToken();
    tokenInFlight = { key: this.config.clientId, promise };
    void promise
      .catch(() => {
        // Handled by whoever awaits `promise`; this chain exists only to clear the slot.
      })
      .finally(() => {
        if (tokenInFlight?.promise === promise) tokenInFlight = null;
      });
    return promise;
  }

  private async fetchAccessToken(): Promise<string> {
    const now = Date.now();
    const res = await fetchPeach(
      `${trimSlash(this.config.authBaseUrl)}/api/oauth/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
          merchantId: this.config.merchantId,
        }),
      },
      'oauth_token',
    );
    if (!res.ok) {
      throw new ProviderError(`Peach auth failed (${res.status})`, await safeText(res));
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: string | number };
    if (!data.access_token) {
      throw new ProviderError('Peach auth returned no access_token', data);
    }
    const ttlSec = Number(data.expires_in);
    const ttlMs = Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1_000 : 60_000;
    tokenCache = { key: this.config.clientId, token: data.access_token, expiresAt: now + ttlMs };
    return data.access_token;
  }
}

/** Map a Peach result code (+ payment type) to our normalised outcome. */
export function outcomeFor(resultCode: string | null, paymentType: string | null): PaymentOutcome {
  if (!resultCode) return 'unknown';
  // A review-flagged code is a CAPTURE that a human must vet — settle it, then flag it (see
  // needsManualReview). Filing it as 'failed' took the money and gave the customer nothing.
  if (SUCCESS_CODE.test(resultCode) || REVIEW_CODE.test(resultCode)) {
    return paymentType === 'RF' ? 'refunded' : 'paid';
  }
  if (PENDING_CODE.test(resultCode)) return 'pending';
  return 'failed';
}

/** True when Peach captured the money but wants a human to vet the transaction before fulfilment. */
export function needsManualReview(resultCode: string | null): boolean {
  return resultCode != null && REVIEW_CODE.test(resultCode);
}

interface WebhookFields {
  merchantTransactionId: string | null;
  resultCode: string | null;
  paymentType: string | null;
  amountMinor: number | null;
  currency: string | null;
  transactionId: string | null;
  checkoutId: string | null;
  raw: unknown;
}

/**
 * Parse a Peach webhook body. Settlement notifications arrive as `application/x-www-form-urlencoded`
 * with dotted keys (`result.code`); the initial config webhook is JSON with nested objects. Handle
 * both and read the fields we care about.
 */
export function extractWebhookFields(rawBody: string, contentType: string): WebhookFields {
  const isForm = contentType.includes('x-www-form-urlencoded');
  let get: (path: string) => string | null;
  let raw: unknown;

  if (isForm) {
    const params = new URLSearchParams(rawBody);
    raw = Object.fromEntries(params.entries());
    get = (path) => params.get(path);
  } else {
    let json: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed && typeof parsed === 'object') json = parsed as Record<string, unknown>;
    } catch {
      json = {};
    }
    raw = json;
    get = (path) => {
      let node: unknown = json;
      for (const key of path.split('.')) {
        if (node && typeof node === 'object' && key in (node as Record<string, unknown>)) {
          node = (node as Record<string, unknown>)[key];
        } else {
          return null;
        }
      }
      return typeof node === 'string' || typeof node === 'number' ? String(node) : null;
    };
  }

  const amountRaw = get('amount');
  const amount = amountRaw != null ? Number.parseFloat(amountRaw) : NaN;
  return {
    merchantTransactionId: get('merchantTransactionId'),
    resultCode: get('result.code'),
    paymentType: get('paymentType'),
    amountMinor: Number.isFinite(amount) ? Math.round(amount * 100) : null,
    currency: get('currency'),
    transactionId: get('id'),
    checkoutId: get('checkoutId'),
    raw,
  };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two hex strings (avoids leaking position of first mismatch). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
