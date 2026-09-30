import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendNotificationProvider } from '@/lib/notifications/resend';
import type { NotificationMessage } from '@/lib/notifications/types';

/**
 * SANDBOX ONLY: `redirectTo` delivers EVERY email to one inbox, whoever it was addressed to.
 *
 * The hosted sandbox has a real mail key but a database full of fake customers (and the owner's own
 * test addresses), and its cron drains the outbox every two minutes. Without this, turning mail on
 * would email those addresses from the real sender domain — bounces that damage its reputation, or
 * mail to real people. With it, the worst case is a tagged message in the tester's own inbox.
 */
const TESTER = 'tester@example.org';
const CONFIG = {
  apiKey: 're_sandbox_key',
  from: 'bookings@example.com',
  replyTo: 'info@example.com',
  bcc: 'info@example.com',
  redirectTo: TESTER,
};

function mockFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return {
    sent(): { body: Record<string, unknown>; headers: Record<string, string> } {
      expect(calls).toHaveLength(1);
      const call = calls[0];
      if (!call) throw new Error('no fetch call');
      return {
        body: JSON.parse(String(call.init.body)) as Record<string, unknown>,
        headers: call.init.headers as Record<string, string>,
      };
    },
  };
}

const message = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  id: 'n1',
  channel: 'email',
  recipient: 'Guest.Customer@gmail.example',
  template: 'booking_confirmation',
  payload: { ref: 'BMT-1', customerName: 'Ada' },
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ResendNotificationProvider — sandbox redirect', () => {
  it('delivers to the tester and to nobody else, whoever the row was addressed to', async () => {
    for (const recipient of [
      'Guest.Customer@gmail.example', // a real-looking customer
      'customer@sandbox.test', // a fake seeded customer
      'info@bellemaretours.com', // the real owner inbox the owner alerts default to
    ]) {
      const http = mockFetch();
      await new ResendNotificationProvider(CONFIG).send(message({ recipient }));
      expect(http.sent().body.to).toBe(TESTER);
      vi.unstubAllGlobals();
    }
  });

  it('tags the subject and the text with who it was really for', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(message());
    const { body } = http.sent();
    expect(String(body.subject).startsWith('[sandbox → Guest.Customer@gmail.example] ')).toBe(true);
    expect(String(body.subject)).toContain('BMT-1'); // the real subject still follows the tag
    expect(String(body.text)).toContain('addressed to Guest.Customer@gmail.example');
    expect(String(body.text)).toContain('Ada'); // and the real body is intact
  });

  it('tags a pre-rendered subject too (the invoice / receipt emails carry their own)', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(
      message({ subject: 'Your invoice for BMT-1', text: 'Plain', html: '<p>Hi</p>' }),
    );
    expect(http.sent().body.subject).toBe(
      '[sandbox → Guest.Customer@gmail.example] Your invoice for BMT-1',
    );
  });

  it('puts a banner inside the HTML body (or in front of it), naming the original recipient', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(
      message({ html: '<html><body class="x"><p>Hi</p></body></html>' }),
    );
    const html = String(http.sent().body.html);
    expect(html).toMatch(/<body class="x"><div[^>]*>SANDBOX/);
    expect(html).toContain('Guest.Customer@gmail.example');
    expect(html).toContain('<p>Hi</p>');

    const http2 = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(message({ html: '<p>No body tag</p>' }));
    expect(String(http2.sent().body.html).startsWith('<div')).toBe(true);
  });

  it('escapes the original recipient in the HTML banner', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(
      message({ recipient: '<script>alert(1)</script>@x.test', html: '<p>Hi</p>' }),
    );
    const html = String(http.sent().body.html);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('sends no BCC and no Reply-To, so the real info@ inbox is never copied or replied into', async () => {
    for (const template of ['booking_confirmation', 'deposit_receipt']) {
      const http = mockFetch();
      await new ResendNotificationProvider(CONFIG).send(message({ template }));
      const { body } = http.sent();
      expect('bcc' in body, `${template} must not BCC the real inbox`).toBe(false);
      expect('reply_to' in body, `${template} must not set Reply-To`).toBe(false);
      vi.unstubAllGlobals();
    }
  });

  it('changes nothing else: sender, per-message sender, attachments and idempotency key', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider(CONFIG).send(
      message({
        id: 'notif-42',
        from: 'info@example.com',
        subject: 'Quote',
        text: 'Here',
        attachments: [{ filename: 'quote.pdf', content: 'QkFTRTY0' }],
      }),
    );
    const { body, headers } = http.sent();
    expect(String(body.from)).toContain('info@example.com'); // the per-message identity still wins
    expect(body.attachments).toEqual([{ filename: 'quote.pdf', content: 'QkFTRTY0' }]);
    expect(headers['Idempotency-Key']).toBe('notif:notif-42');
  });

  it('is visible in the provider name, so a log line says mail is being diverted', () => {
    expect(new ResendNotificationProvider(CONFIG).name).toBe('resend-redirected');
    expect(new ResendNotificationProvider({ apiKey: 'k', from: 'bookings@example.com' }).name).toBe(
      'resend',
    );
  });

  it('without a redirect, mail goes to the real recipient exactly as before', async () => {
    const http = mockFetch();
    await new ResendNotificationProvider({
      apiKey: 'k',
      from: 'bookings@example.com',
      replyTo: 'info@example.com',
      bcc: 'info@example.com',
    }).send(message());
    const { body } = http.sent();
    expect(body.to).toBe('Guest.Customer@gmail.example');
    expect(String(body.subject)).not.toContain('[sandbox');
    expect(body.bcc).toBe('info@example.com');
    expect(body.reply_to).toBe('info@example.com');
  });
});
