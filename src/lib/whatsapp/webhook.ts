import { timingSafeEqual } from '@/lib/http/auth';

/**
 * Meta WhatsApp Cloud API webhook plumbing (the receiving half of the WhatsApp integration —
 * the sending half lives in src/lib/notifications/whatsapp.ts).
 *
 * Registering a number / connecting an existing WhatsApp in the Meta dashboard REQUIRES a live
 * webhook: Meta first GETs the callback URL with `hub.mode=subscribe&hub.verify_token=…&
 * hub.challenge=…` and only accepts the configuration when the response body is EXACTLY the
 * challenge string. After that, every event lands as a POST signed
 * `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw body)>`.
 */

/**
 * The GET verification handshake: returns the challenge to echo (200 text/plain) when this is a
 * `subscribe` request carrying our verify token, otherwise null (the route answers 403).
 */
export async function handshakeChallenge(args: {
  mode: string | null;
  token: string | null;
  challenge: string | null;
  expectedToken: string;
}): Promise<string | null> {
  if (args.mode !== 'subscribe' || !args.challenge) return null;
  const ok = await timingSafeEqual(args.token, args.expectedToken);
  return ok ? args.challenge : null;
}

/** Verifies Meta's `X-Hub-Signature-256` header over the RAW request body. */
export async function verifyMetaSignature(args: {
  appSecret: string;
  rawBody: string;
  header: string | null;
}): Promise<boolean> {
  const header = args.header ?? '';
  if (!header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length).toLowerCase();

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(args.appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(args.rawBody)));
  const expected = Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(provided, expected);
}

/** The subset of Meta's webhook POST body this endpoint consumes. */
interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          from?: string;
          type?: string;
          text?: { body?: string };
          [media: string]: unknown;
        }>;
      };
    }>;
  }>;
}

const MAX_BODY_CHARS = 500;

/**
 * Flattens a webhook POST body into one owner-readable line per INBOUND customer message, for
 * forwarding to the owner's Telegram group (once a number is connected to the Cloud API, inbound
 * chats reach the business through THIS webhook — dropping them silently would lose enquiries).
 * Delivery statuses (sent/delivered/read receipts) and unknown shapes yield no lines.
 */
export function summarizeInboundMessages(payload: unknown): string[] {
  const entries = (payload as MetaWebhookPayload | null)?.entry;
  if (!Array.isArray(entries)) return [];

  const lines: string[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== 'messages') continue;
      const value = change.value;
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const message of messages) {
        const from = typeof message?.from === 'string' ? message.from : 'unknown';
        const name =
          value?.contacts?.find((c) => c?.wa_id === message?.from)?.profile?.name ??
          value?.contacts?.[0]?.profile?.name ??
          'Unknown';
        const type = typeof message?.type === 'string' ? message.type : 'unknown';

        let body: string;
        if (type === 'text') {
          body = message?.text?.body ?? '';
        } else {
          // Media/interactive message: show the kind, plus its caption when one exists.
          const media = message?.[type] as { caption?: string } | undefined;
          const caption = typeof media?.caption === 'string' ? ` ${media.caption}` : '';
          body = `[${type}]${caption}`;
        }
        if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}…`;

        lines.push(`WhatsApp — ${name} (+${from}): ${body}`);
      }
    }
  }
  return lines;
}
