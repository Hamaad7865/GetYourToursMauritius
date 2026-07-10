import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppNotificationProvider } from '@/lib/notifications/whatsapp';
import type { NotificationMessage } from '@/lib/notifications/types';

/** Meta WhatsApp Cloud API provider — request shape, template mode, and fail-loud behaviour. */

const message = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  id: 'row-1',
  channel: 'whatsapp',
  recipient: '+230 5772 9919',
  template: 'owner_new_booking',
  payload: {},
  text: '🔔 New paid booking BMT-1 · €410',
  ...over,
});

function mockFetch(status = 200, body = '{}') {
  const fn = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WhatsAppNotificationProvider', () => {
  it('sends a plain text message to the digits-only number', async () => {
    const fetchMock = mockFetch();
    const p = new WhatsAppNotificationProvider({ accessToken: 'tok', phoneNumberId: '12345' });
    await p.send(message());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v20.0/12345/messages');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      messaging_product: 'whatsapp',
      to: '23057729919', // formatting stripped
      type: 'text',
      text: { body: '🔔 New paid booking BMT-1 · €410' },
    });
  });

  it('sends via the pre-approved template (one body param) when configured', async () => {
    const fetchMock = mockFetch();
    const p = new WhatsAppNotificationProvider({
      accessToken: 'tok',
      phoneNumberId: '12345',
      templateName: 'new_booking_alert',
    });
    await p.send(message());

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('new_booking_alert');
    expect(body.template.components[0].parameters).toEqual([
      { type: 'text', text: '🔔 New paid booking BMT-1 · €410' },
    ]);
  });

  it('refuses a non-whatsapp channel (never a silent success)', async () => {
    mockFetch();
    const p = new WhatsAppNotificationProvider({ accessToken: 'tok', phoneNumberId: '12345' });
    await expect(p.send(message({ channel: 'email' }))).rejects.toThrow(/cannot deliver channel/);
  });

  it('surfaces an API failure with status + detail', async () => {
    mockFetch(401, '{"error":{"message":"bad token"}}');
    const p = new WhatsAppNotificationProvider({ accessToken: 'tok', phoneNumberId: '12345' });
    await expect(p.send(message())).rejects.toThrow(/WhatsApp send failed \(401\)/);
  });
});
