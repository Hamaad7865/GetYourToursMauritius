import type {
  CheckoutSession,
  CreateCheckoutInput,
  PaymentEvent,
  PaymentOutcome,
  PaymentProvider,
  VerifyWebhookInput,
} from './types';
import { ProviderError } from '@/lib/services/errors';

export interface PeachConfig {
  /** OAuth client credentials (sandbox Dashboard → Settings → API keys). */
  clientId: string;
  clientSecret: string;
  merchantId: string;
  /** Channel/entity id — keys both the create-checkout body and the browser widget. */
  entityId: string;
  /**
   * HMAC-SHA256 secret Peach signs webhook notifications with. Optional: HMAC webhook security is
   * activated by Peach support (not a dashboard toggle), so it may not exist yet. When absent,
   * verifyWebhook fails closed (no confirmation) — confirmation then relies on the status re-query.
   */
  webhookSecret?: string;
  /** Auth service base, e.g. https://sandbox-... (POST {authBaseUrl}/api/oauth/token). */
  authBaseUrl: string;
  /** Checkout API base, e.g. https://testsecure.peachpayments.com (POST {checkoutBaseUrl}/v2/checkout). */
  checkoutBaseUrl: string;
  /**
   * The publicly-reachable URL Peach calls with settlement notifications. Peach signs the HMAC over
   * this exact URL, so verifyWebhook needs it to recompute the signature. Sent as `notificationUrl`
   * on each checkout so it works without dashboard webhook config (e.g. a local tunnel). Optional so
   * createCheckout can run before the webhook is wired, but verifyWebhook fails closed without it.
   */
  webhookUrl?: string;
  environment: 'test' | 'live';
}

/** Peach result-code prefix for a successful authorisation/capture. */
const SUCCESS_CODE = /^(000\.000\.|000\.100\.1)/;
/** Peach result-code prefix for a still-pending transaction. */
const PENDING_CODE = /^(000\.200)/;

/** Module-scoped OAuth token cache (reused across requests within an edge isolate). */
let tokenCache: { key: string; token: string; expiresAt: number } | null = null;

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

    const res = await fetch(`${trimSlash(this.config.checkoutBaseUrl)}/v2/checkout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: originOf(input.returnUrl),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new ProviderError(`Peach create-checkout failed (${res.status})`, await safeText(res));
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
      // Fail closed: HMAC isn't enabled yet (Peach activates it on request), so we can't verify.
      throw new ProviderError('Peach webhook HMAC secret not configured — cannot verify the signature');
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
      amountMinor: fields.amountMinor,
      raw: fields.raw,
    };
  }

  async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent> {
    const token = await this.accessToken();
    const res = await fetch(
      `${trimSlash(this.config.checkoutBaseUrl)}/v2/checkout/${encodeURIComponent(checkoutId)}/status`,
      { headers: { Authorization: `Bearer ${token}` } },
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
      amountMinor: Number.isFinite(amount) ? Math.round(amount * 100) : null,
      raw: data,
    };
  }

  /** Cached OAuth bearer token; refreshes shortly before expiry. */
  private async accessToken(): Promise<string> {
    const now = Date.now();
    if (tokenCache && tokenCache.key === this.config.clientId && tokenCache.expiresAt > now + 5_000) {
      return tokenCache.token;
    }
    const res = await fetch(`${trimSlash(this.config.authBaseUrl)}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        merchantId: this.config.merchantId,
      }),
    });
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
  if (SUCCESS_CODE.test(resultCode)) return paymentType === 'RF' ? 'refunded' : 'paid';
  if (PENDING_CODE.test(resultCode)) return 'pending';
  return 'failed';
}

interface WebhookFields {
  merchantTransactionId: string | null;
  resultCode: string | null;
  paymentType: string | null;
  amountMinor: number | null;
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
