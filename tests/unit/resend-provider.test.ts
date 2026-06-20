import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendNotificationProvider } from '@/lib/notifications/resend';
import type { NotificationMessage } from '@/lib/notifications/types';

const CONFIG = { apiKey: 're_test_key', from: 'bookings@example.com' };

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

    expect(body.from).toBe(CONFIG.from);
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
    expect(body.from).toBe(CONFIG.from);
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
});
