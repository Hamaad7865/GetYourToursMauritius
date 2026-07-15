import { afterEach, describe, expect, it, vi } from 'vitest';
import { TelegramNotificationProvider } from '@/lib/notifications/telegram';
import type { NotificationMessage } from '@/lib/notifications/types';

/** Telegram Bot API provider — request shape, multi-recipient fan-out, and fail-loud behaviour. */

const message = (over: Partial<NotificationMessage> = {}): NotificationMessage => ({
  id: 'row-1',
  channel: 'telegram',
  recipient: '-1002233445566',
  template: 'owner_new_booking',
  payload: {},
  text: '🔔 New paid booking\nMiguel booked X — €410 (ref BMT-1).\nhttps://x/admin',
  ...over,
});

function mockFetch(status = 200, body = '{"ok":true}') {
  const fn = vi.fn().mockResolvedValue(new Response(body, { status }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TelegramNotificationProvider', () => {
  it('posts sendMessage to the bot token with the chat id + text (link preview suppressed)', async () => {
    const fetchMock = mockFetch();
    const p = new TelegramNotificationProvider({ botToken: '123:AA-tok' });
    await p.send(message());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.telegram.org/bot123:AA-tok/sendMessage');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      chat_id: '-1002233445566',
      // Telegram takes the multi-line text verbatim (no template flattening, unlike WhatsApp).
      text: '🔔 New paid booking\nMiguel booked X — €410 (ref BMT-1).\nhttps://x/admin',
      disable_web_page_preview: true,
    });
  });

  it('fans out to every chat id in a comma-separated recipient list', async () => {
    const fetchMock = mockFetch();
    const p = new TelegramNotificationProvider({ botToken: 'tok' });
    await p.send(message({ recipient: '111, 222 , 333' }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const chatIds = fetchMock.mock.calls.map(
      (c) => JSON.parse((c[1] as RequestInit).body as string).chat_id,
    );
    expect(chatIds).toEqual(['111', '222', '333']); // trimmed
  });

  it('refuses a non-telegram channel (never a silent success)', async () => {
    mockFetch();
    const p = new TelegramNotificationProvider({ botToken: 'tok' });
    await expect(p.send(message({ channel: 'email' }))).rejects.toThrow(/cannot deliver channel/);
  });

  it('throws on an empty chat id so the row stays visible', async () => {
    mockFetch();
    const p = new TelegramNotificationProvider({ botToken: 'tok' });
    await expect(p.send(message({ recipient: '   ' }))).rejects.toThrow(/empty chat id/);
  });

  it('fails loudly when the Bot API rejects the send', async () => {
    mockFetch(400, '{"ok":false,"description":"chat not found"}');
    const p = new TelegramNotificationProvider({ botToken: 'tok' });
    await expect(p.send(message())).rejects.toThrow(/Telegram send failed for 1\/1/);
  });

  it('fails if ANY recipient in a list fails (a partial outage is visible, not swallowed)', async () => {
    // First call OK, second call 400 → the whole send throws so the outbox row retries.
    const fn = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
      .mockResolvedValueOnce(new Response('{"ok":false}', { status: 403 }));
    vi.stubGlobal('fetch', fn);
    const p = new TelegramNotificationProvider({ botToken: 'tok' });
    await expect(p.send(message({ recipient: '111,222' }))).rejects.toThrow(
      /Telegram send failed for 1\/2/,
    );
  });
});
