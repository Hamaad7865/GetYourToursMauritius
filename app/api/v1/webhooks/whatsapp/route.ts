import { after } from 'next/server';
import { apiHandler } from '@/lib/http/handler';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { getServerEnv } from '@/lib/config/env';
import { TelegramNotificationProvider } from '@/lib/notifications/telegram';
import {
  handshakeChallenge,
  summarizeInboundMessages,
  verifyMetaSignature,
} from '@/lib/whatsapp/webhook';

export const runtime = 'edge';

/**
 * /api/v1/webhooks/whatsapp — Meta WhatsApp Cloud API webhook.
 *
 * This endpoint is what the Meta dashboard's "Callback URL" points at; registering/connecting a
 * WhatsApp number FAILS until it exists, because Meta verifies the URL first (GET handshake) and
 * then requires 200s on event delivery (POST).
 *
 * GET  — one-time verification: echo `hub.challenge` as PLAIN TEXT iff `hub.verify_token` equals
 *        WHATSAPP_WEBHOOK_VERIFY_TOKEN (the JSON envelope would fail Meta's exact-body check).
 * POST — signed events (`X-Hub-Signature-256` = hex HMAC-SHA256 of the raw body with the app
 *        secret). Inbound customer messages are forwarded to the owner's Telegram group in
 *        `after()` (ack-first, like the payments webhook): once a number is on the Cloud API its
 *        chats arrive HERE, so swallowing them would silently lose enquiries. Delivery statuses
 *        are acked without forwarding. The forward is best-effort — Meta does not redeliver after
 *        a 200 — so a Telegram outage costs a copy, never the ack.
 */
export const GET = apiHandler(async (req) => {
  const env = getServerEnv();
  const expectedToken = env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expectedToken) {
    // Loud, like the send-email hook: verifying in Meta before the env reached this deploy should
    // read as "not configured", not as a mysterious token mismatch.
    return jsonError(503, 'not_configured', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN is not set');
  }

  const params = new URL(req.url).searchParams;
  const challenge = await handshakeChallenge({
    mode: params.get('hub.mode'),
    token: params.get('hub.verify_token'),
    challenge: params.get('hub.challenge'),
    expectedToken,
  });
  if (challenge === null) {
    return jsonError(403, 'forbidden', 'Verify token mismatch');
  }
  return new Response(challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
});

export const POST = apiHandler(async (req) => {
  const env = getServerEnv();
  const appSecret = env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Fail closed: without the app secret a forged body is indistinguishable from Meta's.
    return jsonError(503, 'not_configured', 'WHATSAPP_APP_SECRET is not set');
  }

  const rawBody = await req.text();
  const verified = await verifyMetaSignature({
    appSecret,
    rawBody,
    header: req.headers.get('x-hub-signature-256'),
  });
  if (!verified) {
    return jsonError(401, 'unauthorized', 'Invalid webhook signature');
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Signed-but-unparseable: a retry would resend the same body, so ack and drop it.
    console.error('[whatsapp-webhook] signed body was not valid JSON');
  }

  const lines = summarizeInboundMessages(payload);
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_OWNER_CHAT_ID;
  if (lines.length > 0 && botToken && chatId) {
    try {
      after(async () => {
        try {
          await new TelegramNotificationProvider({ botToken }).send({
            id: 'whatsapp-inbound',
            channel: 'telegram',
            recipient: chatId,
            template: 'owner_whatsapp_inbound',
            payload: {},
            text: lines.join('\n'),
          });
        } catch (err) {
          console.error(
            '[whatsapp-webhook] telegram forward failed:',
            err instanceof Error ? err.message : err,
          );
        }
      });
    } catch (err) {
      console.error(
        '[whatsapp-webhook] could not schedule telegram forward:',
        err instanceof Error ? err.message : err,
      );
    }
  } else if (lines.length > 0) {
    // Messages arrived but no Telegram destination is configured — log them so they are at least
    // recoverable from the request logs instead of vanishing.
    console.error('[whatsapp-webhook] inbound message with no Telegram forward configured', {
      count: lines.length,
    });
  }

  return jsonOk({ received: true });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
