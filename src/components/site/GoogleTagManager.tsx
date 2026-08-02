import Script from 'next/script';
import {
  CONSENT_DENIED,
  NOTICE_KEY,
  NOTICE_VERSION,
  consentModePayload,
} from '@/lib/consent/notice';

/**
 * Google Tag Manager, gated by Google Consent Mode v2.
 *
 * GA4 is configured INSIDE the container (Sharon's setup), so the site installs the GTM snippet
 * only — there is deliberately no separate gtag/GA4 tag here.
 *
 * Consent Mode rather than conditional injection: the container always loads, but every storage
 * signal starts DENIED, so Google's own tags fall back to cookieless pings until the visitor opts
 * in via the cookie banner (which calls `gtag('consent','update',…)`). This keeps the tag plumbing
 * in one place — Sharon can add tags in GTM without touching the codebase — while the legal gate
 * stays in ours.
 *
 * ORDERING IS LOAD-BEARING: the consent default must be in the dataLayer *before* gtm.js is
 * requested, or tags can fire unconsented in the gap. That is why the default, the restore and the
 * loader are one inline script instead of three tags whose relative order Next does not guarantee.
 * The stored choice is restored SYNCHRONOUSLY here (not from the React banner, which mounts later)
 * so a returning visitor who already opted in is measured from their very first pageview.
 */

/** Public container id. Overridable so a preview/staging deploy can point elsewhere or set it empty. */
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID ?? 'GTM-PXZRKZ2J';

const bootstrap = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', ${JSON.stringify(consentModePayload(CONSENT_DENIED))});
try {
  var raw = localStorage.getItem(${JSON.stringify(NOTICE_KEY)});
  if (raw) {
    var stored = JSON.parse(raw);
    if (stored && stored.version === ${NOTICE_VERSION}) {
      var on = 'granted', off = 'denied';
      var a = stored.analytics === true ? on : off;
      var m = stored.marketing === true ? on : off;
      gtag('consent', 'update', {
        analytics_storage: a,
        ad_storage: m,
        ad_user_data: m,
        ad_personalization: m,
        personalization_storage: m,
        functionality_storage: on,
        security_storage: on
      });
    }
  }
} catch (e) { /* private mode / storage blocked — stay denied */ }
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer',${JSON.stringify(GTM_ID)});
`.trim();

/** The loader + consent bootstrap. Render inside <body>; runs after hydration starts. */
export function GoogleTagManager() {
  if (!GTM_ID) return null;
  return (
    <Script id="gtm-consent-bootstrap" strategy="afterInteractive">
      {bootstrap}
    </Script>
  );
}

/** The `<noscript>` fallback. Must be the first thing inside <body>, per Google's install docs. */
export function GoogleTagManagerNoScript() {
  if (!GTM_ID) return null;
  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(GTM_ID)}`}
        height="0"
        width="0"
        style={{ display: 'none', visibility: 'hidden' }}
        title="Google Tag Manager"
      />
    </noscript>
  );
}
