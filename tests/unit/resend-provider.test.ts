import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendNotificationProvider } from '@/lib/notifications/resend';
import type { NotificationMessage } from '@/lib/notifications/types';
import { SITE } from '@/lib/seo/site';

const CONFIG = { apiKey: 're_test_key', from: 'bookings@example.com' };
/** A bare mailbox is sent WITH the brand name so an inbox shows "Belle Mare Tours", not "bookings". */
const BRANDED = (addr: string) => `${SITE.name} <${addr}>`;

/**
 * The Resend provider POSTs a single JSON body to https://api.resend.com/emails. Task 5 extends it
 * to carry an HTML body + base64 file attachments (for the invoice/receipt email), while keeping the
 * existing plain-text-only path byte-for-byte the same.
 */
describe('ResendNotificationProvider.send — HTML + attachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
  }

  /** Assert exactly one POST was made and return its url + parsed JSON body. */
  function onlyCall(calls: Array<{ url: string; init: RequestInit }>): {
    url: string;
    body: Record<string, unknown>;
  } {
    expect(calls).toHaveLength(1);
    const call = calls[0];
    if (!call) throw new Error('expected exactly one fetch call');
    return { url: call.url, body: JSON.parse(String(call.init.body)) as Record<string, unknown> };
  }

  it('sends html + base64 attachments alongside from/to/subject/text', async () => {
    const { calls } = mockFetch();

    const message: NotificationMessage = {
      id: 'n1',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: {},
      subject: 'Your invoice for BMT-1',
      text: 'Plain text fallback',
      html: '<p>Hi</p>',
      attachments: [
        { filename: 'invoice.pdf', content: 'QkFTRTY0', contentType: 'application/pdf' },
      ],
    };

    await new ResendNotificationProvider(CONFIG).send(message);

    const { url, body } = onlyCall(calls);
    expect(url).toBe('https://api.resend.com/emails');

    // Idempotency: the POST carries `Idempotency-Key: notif:{message.id}` so a re-claimed retry
    // (worker died between send + mark-sent) is deduped by Resend and never delivers a 2nd copy.
    const headers = calls[0]?.init.headers as Record<string, string> | undefined;
    expect(headers?.['Idempotency-Key']).toBe('notif:n1');

    expect(body.from).toBe(BRANDED(CONFIG.from));
    expect(body.to).toBe('guest@example.com');
    expect(body.subject).toBe('Your invoice for BMT-1');
    expect(body.text).toBe('Plain text fallback');
    expect(body.html).toBe('<p>Hi</p>');
    expect(Array.isArray(body.attachments)).toBe(true);
    const attachments = body.attachments as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ filename: 'invoice.pdf', content: 'QkFTRTY0' });
  });

  it('leaves the plain-text path unchanged: no html / attachments keys when absent', async () => {
    const { calls } = mockFetch();

    const message: NotificationMessage = {
      id: 'n2',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-7', customerName: 'Ada' },
    };

    await new ResendNotificationProvider(CONFIG).send(message);

    const { body } = onlyCall(calls);

    // The render()-derived subject/text are still the source for plain sends.
    expect(body.from).toBe(BRANDED(CONFIG.from));
    expect(body.to).toBe('guest@example.com');
    expect(typeof body.subject).toBe('string');
    expect(String(body.subject).length).toBeGreaterThan(0);
    expect(typeof body.text).toBe('string');
    expect(String(body.text)).toContain('Ada');

    // No HTML / attachments emitted when the message carries none.
    expect('html' in body).toBe(false);
    expect('attachments' in body).toBe(false);
  });

  it('prefers a pre-rendered subject/text over render() when the message carries them', async () => {
    const { calls } = mockFetch();

    const message: NotificationMessage = {
      id: 'n3',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-9' },
      subject: 'Pre-rendered subject',
      text: 'Pre-rendered text',
    };

    await new ResendNotificationProvider(CONFIG).send(message);

    const { body } = onlyCall(calls);
    expect(body.subject).toBe('Pre-rendered subject');
    expect(body.text).toBe('Pre-rendered text');
  });

  it('sends AS the per-message from when one is set — a quote goes out from the monitored inbox', async () => {
    // Phase D: a quote must be sent FROM info@ (the monitored human inbox) instead of the send-only
    // bookings@ identity (config.from / RESEND_FROM), WITHOUT moving every other template. The message
    // carries an optional `from`; when present the provider sends AS it and never touches config.from.
    const { calls } = mockFetch();
    await new ResendNotificationProvider(CONFIG).send({
      id: 'nq',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'quote_sent',
      payload: {},
      from: 'info@bellemaretours.com',
      subject: 'Your quote',
      text: 'Here is your quote',
    });
    expect(onlyCall(calls).body.from).toBe(BRANDED('info@bellemaretours.com')); // per-message override wins, brand name attached
  });

  it('leaves an already-named from untouched (an env like "Belle Mare Tours <info@…>" wins)', async () => {
    const { calls } = mockFetch();
    await new ResendNotificationProvider(CONFIG).send({
      id: 'nn',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'quote_sent',
      payload: {},
      from: 'Belle Mare Tours <info@bellemaretours.com>',
      subject: 'Your quote',
      text: 'Here is your quote',
    });
    expect(onlyCall(calls).body.from).toBe('Belle Mare Tours <info@bellemaretours.com>');
  });

  it('falls back to the configured from (RESEND_FROM identity) when the message carries none', async () => {
    const { calls } = mockFetch();
    await new ResendNotificationProvider(CONFIG).send({
      id: 'nc',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-1' },
    });
    expect(onlyCall(calls).body.from).toBe(BRANDED(CONFIG.from)); // no per-message from → the send-only identity, branded
  });

  it('sets Reply-To to the human inbox — mail goes out as bookings@ but replies must reach a person', async () => {
    const { calls } = mockFetch();
    await new ResendNotificationProvider({ ...CONFIG, replyTo: 'info@example.com' }).send({
      id: 'n5',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-5' },
    });
    const { body } = onlyCall(calls);
    expect(body.from).toBe(BRANDED('bookings@example.com')); // send-only identity, branded
    expect(body.reply_to).toBe('info@example.com'); // monitored inbox
  });

  it('omits reply_to entirely when no inbox is configured', async () => {
    const { calls } = mockFetch();
    await new ResendNotificationProvider(CONFIG).send({
      id: 'n6',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-6' },
    });
    expect('reply_to' in onlyCall(calls).body).toBe(false);
  });

  it('BCCs the human inbox on a booking_confirmation (owner keeps a silent copy + invoice)', async () => {
    const { calls } = mockFetch();
    await new ResendNotificationProvider({ ...CONFIG, bcc: 'info@example.com' }).send({
      id: 'n7',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_confirmation',
      payload: { ref: 'BMT-7' },
    });
    const { body } = onlyCall(calls);
    expect(body.bcc).toBe('info@example.com'); // owner's silent copy
    expect(body.to).toBe('guest@example.com'); // the customer is still the sole visible recipient
  });

  it('does NOT BCC on non-confirmation emails (owner alerts + refund/expiry mails stay uncopied)', async () => {
    for (const template of [
      'booking_expired',
      'booking_refunded',
      'owner_refund_pending',
    ] as const) {
      const { calls } = mockFetch();
      await new ResendNotificationProvider({ ...CONFIG, bcc: 'info@example.com' }).send({
        id: `n-${template}`,
        channel: 'email',
        recipient: 'guest@example.com',
        template,
        payload: { ref: 'BMT-1' },
      });
      expect('bcc' in onlyCall(calls).body, `${template} must not be BCC'd`).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it('renders the booking_expired template with the ref + customer name', async () => {
    const { calls } = mockFetch();

    const message: NotificationMessage = {
      id: 'n4',
      channel: 'email',
      recipient: 'guest@example.com',
      template: 'booking_expired',
      payload: { ref: 'BMT-42', customerName: 'Noor' },
    };

    await new ResendNotificationProvider(CONFIG).send(message);

    const { body } = onlyCall(calls);
    expect(String(body.subject)).toContain('BMT-42');
    expect(String(body.subject).toLowerCase()).toContain('expired');
    expect(String(body.text)).toContain('Noor');
  });
});
