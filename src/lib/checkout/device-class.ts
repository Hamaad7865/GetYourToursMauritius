/**
 * Reduces a User-Agent string to the three things the checkout funnel needs — device class, browser
 * family and whether it is an in-app webview — so the raw UA (a fingerprinting surface) is never
 * stored. Deliberately coarse: these are buckets for "which shoppers fail at the card step", not a
 * browser-detection library.
 */
export interface DeviceClass {
  device: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  browser: string;
  /** Facebook / Instagram / TikTok / Snapchat / LinkedIn / Line / WeChat / generic Android WebView. */
  inApp: boolean;
}

const IN_APP =
  /FBAN|FBAV|FB_IAB|FBIOS|Instagram|TikTok|musical_ly|BytedanceWebview|Snapchat|LinkedInApp|Line\/|MicroMessenger|Pinterest|; wv\)/i;

export function classifyUserAgent(ua: string | null | undefined): DeviceClass {
  const s = (ua ?? '').slice(0, 500);
  if (!s) return { device: 'unknown', browser: 'other', inApp: false };

  const inApp = IN_APP.test(s);
  const tablet = /iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(s);
  const mobile = !tablet && /Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(s);
  const device: DeviceClass['device'] = tablet ? 'tablet' : mobile ? 'mobile' : 'desktop';

  // Order matters: Edge and Opera and Samsung all also say "Chrome"; Chrome on iOS says "Safari".
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? 'edge'
    : /OPR\/|Opera/.test(s)
      ? 'opera'
      : /SamsungBrowser/.test(s)
        ? 'samsung'
        : /Firefox|FxiOS/.test(s)
          ? 'firefox'
          : /CriOS|Chrome\//.test(s)
            ? 'chrome'
            : /Safari\//.test(s) || /iPhone|iPad|iPod/.test(s)
              ? 'safari'
              : 'other';

  return { device, browser, inApp };
}
