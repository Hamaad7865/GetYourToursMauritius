import { describe, expect, it } from 'vitest';
import { classifyUserAgent } from '@/lib/checkout/device-class';

describe('classifyUserAgent', () => {
  it('buckets the common phones, tablets and desktops', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      ),
    ).toEqual({ device: 'mobile', browser: 'safari', inApp: false });
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
      ),
    ).toEqual({ device: 'mobile', browser: 'samsung', inApp: false });
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
      ).device,
    ).toBe('tablet');
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
      ),
    ).toEqual({ device: 'desktop', browser: 'edge', inApp: false });
  });

  it('flags in-app webviews, where 3-D Secure commonly breaks', () => {
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0]',
      ).inApp,
    ).toBe(true);
    expect(
      classifyUserAgent(
        'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 Instagram 340.0',
      ),
    ).toMatchObject({ device: 'mobile', inApp: true });
  });

  it('never throws on a missing or junk header', () => {
    expect(classifyUserAgent(null)).toEqual({ device: 'unknown', browser: 'other', inApp: false });
    expect(classifyUserAgent('curl/8.0').device).toBe('desktop');
  });
});
