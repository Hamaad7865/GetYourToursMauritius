import { describe, expect, it } from 'vitest';
import {
  handshakeChallenge,
  summarizeInboundMessages,
  verifyMetaSignature,
} from '@/lib/whatsapp/webhook';

/**
 * Meta WhatsApp Cloud API webhook plumbing — the receiving half of the (revived) WhatsApp
 * integration. GET is Meta's one-time verification handshake (echo hub.challenge when the verify
 * token matches); POST bodies are signed `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app
 * secret, raw body)>`.
 */

const APP_SECRET = 'meta-app-secret-for-tests';

async function metaSign(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(mac)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('handshakeChallenge (GET hub.challenge echo)', () => {
  it('returns the challenge for a subscribe request with the matching token', async () => {
    await expect(
      handshakeChallenge({
        mode: 'subscribe',
        token: 'my-verify-token',
        challenge: '1158201444',
        expectedToken: 'my-verify-token',
      }),
    ).resolves.toBe('1158201444');
  });

  it('returns null for a wrong token, wrong mode, or missing challenge', async () => {
    await expect(
      handshakeChallenge({
        mode: 'subscribe',
        token: 'WRONG',
        challenge: '1158201444',
        expectedToken: 'my-verify-token',
      }),
    ).resolves.toBeNull();
    await expect(
      handshakeChallenge({
        mode: 'unsubscribe',
        token: 'my-verify-token',
        challenge: '1158201444',
        expectedToken: 'my-verify-token',
      }),
    ).resolves.toBeNull();
    await expect(
      handshakeChallenge({
        mode: 'subscribe',
        token: 'my-verify-token',
        challenge: null,
        expectedToken: 'my-verify-token',
      }),
    ).resolves.toBeNull();
  });
});

describe('verifyMetaSignature (X-Hub-Signature-256)', () => {
  it('accepts a correctly signed body', async () => {
    const body = '{"object":"whatsapp_business_account"}';
    const hex = await metaSign(APP_SECRET, body);
    await expect(
      verifyMetaSignature({ appSecret: APP_SECRET, rawBody: body, header: `sha256=${hex}` }),
    ).resolves.toBe(true);
  });

  it('accepts an uppercase hex digest (case-insensitive compare)', async () => {
    const body = '{"a":1}';
    const hex = await metaSign(APP_SECRET, body);
    await expect(
      verifyMetaSignature({
        appSecret: APP_SECRET,
        rawBody: body,
        header: `sha256=${hex.toUpperCase()}`,
      }),
    ).resolves.toBe(true);
  });

  it('rejects a tampered body, a wrong secret, and a missing/malformed header', async () => {
    const body = '{"a":1}';
    const hex = await metaSign(APP_SECRET, body);
    await expect(
      verifyMetaSignature({ appSecret: APP_SECRET, rawBody: '{"a":2}', header: `sha256=${hex}` }),
    ).resolves.toBe(false);
    await expect(
      verifyMetaSignature({ appSecret: 'other-secret', rawBody: body, header: `sha256=${hex}` }),
    ).resolves.toBe(false);
    await expect(
      verifyMetaSignature({ appSecret: APP_SECRET, rawBody: body, header: null }),
    ).resolves.toBe(false);
    await expect(
      verifyMetaSignature({ appSecret: APP_SECRET, rawBody: body, header: hex }),
    ).resolves.toBe(false);
  });
});

describe('summarizeInboundMessages', () => {
  const inbound = (messages: unknown[], contacts?: unknown[]) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '23057729919', phone_number_id: 'PNI' },
              contacts: contacts ?? [{ profile: { name: 'John Traveller' }, wa_id: '33612345678' }],
              messages,
            },
          },
        ],
      },
    ],
  });

  it('produces one owner-readable line per inbound text message', () => {
    const lines = summarizeInboundMessages(
      inbound([
        {
          from: '33612345678',
          id: 'wamid.A',
          timestamp: '1789000000',
          type: 'text',
          text: { body: 'Hi, is the catamaran free on Saturday?' },
        },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('John Traveller');
    expect(lines[0]).toContain('+33612345678');
    expect(lines[0]).toContain('Hi, is the catamaran free on Saturday?');
  });

  it('falls back to a [type] placeholder (plus caption) for non-text messages', () => {
    const lines = summarizeInboundMessages(
      inbound([
        {
          from: '33612345678',
          id: 'wamid.B',
          timestamp: '1789000000',
          type: 'image',
          image: { id: 'MEDIA', mime_type: 'image/jpeg', caption: 'our hotel voucher' },
        },
      ]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[image]');
    expect(lines[0]).toContain('our hotel voucher');
  });

  it('truncates very long message bodies', () => {
    const lines = summarizeInboundMessages(
      inbound([{ from: '33612345678', type: 'text', text: { body: 'x'.repeat(2000) } }]),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.length).toBeLessThan(700);
    expect(lines[0]).toContain('…');
  });

  it('returns [] for status-only payloads and junk shapes', () => {
    const statuses = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA_ID',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                statuses: [{ id: 'wamid.C', status: 'delivered', recipient_id: '33612345678' }],
              },
            },
          ],
        },
      ],
    };
    expect(summarizeInboundMessages(statuses)).toEqual([]);
    expect(summarizeInboundMessages(null)).toEqual([]);
    expect(summarizeInboundMessages({})).toEqual([]);
    expect(summarizeInboundMessages({ entry: 'nope' })).toEqual([]);
  });
});
