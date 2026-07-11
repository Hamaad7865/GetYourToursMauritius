# Cookie Notice + Policy — Design

> Brainstormed 2026-06-20. A GDPR/ePrivacy **informational** cookie notice (non-blocking bottom bar) +
> a dedicated `/cookies` policy page for the EU-facing tours site (bilingual EN/FR).

## Context (from the codebase audit)

- **No analytics or marketing trackers exist** (no GA, Meta pixel, etc.). Nothing to block.
- Almost all storage is **strictly necessary + first-party**: Supabase auth (`gytm:auth`), cart
  (`gytm:cart`), booking/checkout stashes (`gytm:hold:*`, `gytm:booking:*`, `gytm:pickup:*`,
  `gytm:itinerary:*`), the language/currency cookies (`gytm_lang`, `gytm_ccy`), plus functional
  first-party items (`gytm:wishlist`, `gytm:recent-searches`, `gytm:inbox`, `gytm:geo:*`).
- The only consent-relevant third parties: **Google Maps JS** (loads when a map renders; sets Google
  cookies) and **Peach `checkout.js`** (only on the pay page, effectively necessary).
- i18n: bilingual via `useT()` (client) / `getT()` (server) over `gytm_lang`. Privacy/terms/refunds
  pages exist; **no cookie policy page yet**. Footer has a Legal column (`SiteFooter.tsx`).

## Locked decisions

1. **Informational notice only** — a non-blocking bottom bar; Google Maps and other scripts load
   normally (no gating, no per-category toggles). Rationale: there are no trackers; the only
   non-essential cookie source is Google Maps, and the owner chose UX over pre-consent gating.
2. **Non-blocking bottom bar** — the visitor can browse while it's shown.
3. **Dedicated `/cookies` page** for the full policy (not folded into `/privacy`).

## Architecture

- **`src/lib/consent/notice.ts`** (pure, tested): `NOTICE_VERSION` (number) + `shouldShowNotice(stored)`
  (true when nothing stored OR the stored version is older than `NOTICE_VERSION`) + `serializeAck(now)`
  → the JSON to persist. No IO; the component owns localStorage.
- **`src/components/site/CookieNotice.tsx`** (client): reads `localStorage['gytm:cookie-notice']` in a
  `useEffect` (so SSR renders nothing → no hydration flash); if `shouldShowNotice`, renders a slim
  bottom bar with: a short message, an **Accept** button (writes the ack, hides the bar), and a
  **Cookie policy** link to `/cookies`. Bilingual via `useT()`. Styled to match the site (reuse the
  toast/modal surface tokens). Accessible (role/aria, keyboard-dismiss, focus-visible).
- **`app/(site)/cookies/page.tsx`** (server, `getT()`): the policy — intro, an explicit "we use **no**
  analytics or advertising cookies" statement, a table of what's stored grouped as **Strictly
  necessary** (the first-party items above + what each does) and **Third-party** (Google Maps; Peach on
  the pay page), retention notes, and how to clear cookies in the browser. Bilingual headings +
  `generateMetadata`. Mirror the existing `/privacy` page structure. `noindex` not required (it's a
  normal informational page; include it in the sitemap if the other legal pages are).
- **`SiteFooter.tsx`**: add "Cookie policy" → `/cookies` in the Legal column.
- **Mount:** `<CookieNotice />` in `app/(site)/layout.tsx` (the edge/dynamic layout, inside
  `PreferencesProvider` so `useT()` works) — NOT the static root `app/layout.tsx`.
- **i18n:** add the banner + page strings to EN/FR (`messages`). Never translate place names / DB content.

## Data flow

First visit → no `gytm:cookie-notice` → bar shows → **Accept** writes `{ acknowledged: true, version:
NOTICE_VERSION, ts }` → bar hidden. Re-appears only if `NOTICE_VERSION` is bumped (policy change).

## Error handling

All localStorage reads/writes wrapped in try/catch (private mode safe) — on any error, default to NOT
showing the bar a second time is wrong, so default to SHOWING it (fail-open to the notice) but never
crash. The bar is purely additive; nothing else depends on it.

## Testing

- Unit (`tests/unit/cookie-notice.test.ts`): `shouldShowNotice` — show when stored is null / malformed /
  an older version; hide when acknowledged at the current version. `serializeAck` shape.
- Render/static: the `/cookies` page renders; the footer link resolves; i18n keys exist in both locales.
- Manual: bar appears once, Accept dismisses + persists across reload, EN/FR both correct, link works,
  keyboard-accessible.

## Out of scope

Google Maps / Peach gating; granular category toggles; a third-party CMP; analytics (none exist);
a "reopen preferences" control (nothing to re-configure — the footer link to `/cookies` suffices).
