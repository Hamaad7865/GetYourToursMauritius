# Cookie Notice + Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A non-blocking informational cookie-notice bottom bar + a dedicated `/cookies` policy page, bilingual EN/FR.

**Architecture:** Pure `shouldShowNotice` helper + a client `CookieNotice` bar (localStorage ack, mounts after hydration) in `app/(site)/layout.tsx`; a server `/cookies` page; a footer link. No gating, no toggles, no analytics (none exist).

**Tech Stack:** Next.js 15 App Router (edge), TypeScript strict, Tailwind, Vitest. i18n via `useT()`/`getT()`.

**Spec:** `docs/superpowers/specs/2026-06-20-cookie-notice-design.md`.

---

## Task 1: Notice helper + the CookieNotice bar

**Files:** Create `src/lib/consent/notice.ts`, `tests/unit/cookie-notice.test.ts`, `src/components/site/CookieNotice.tsx`; modify `app/(site)/layout.tsx`, `src/lib/i18n/messages.ts`.

- [ ] **Step 1: Failing test** `tests/unit/cookie-notice.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { NOTICE_VERSION, shouldShowNotice, serializeAck } from '@/lib/consent/notice';

describe('shouldShowNotice', () => {
  it('shows when nothing is stored', () => {
    expect(shouldShowNotice(null)).toBe(true);
  });
  it('shows when the stored value is malformed', () => {
    expect(shouldShowNotice('not json')).toBe(true);
    expect(shouldShowNotice('{}')).toBe(true);
  });
  it('hides when acknowledged at the current version', () => {
    expect(
      shouldShowNotice(JSON.stringify({ acknowledged: true, version: NOTICE_VERSION, ts: 1 })),
    ).toBe(false);
  });
  it('shows again when the stored version is older', () => {
    expect(
      shouldShowNotice(JSON.stringify({ acknowledged: true, version: NOTICE_VERSION - 1, ts: 1 })),
    ).toBe(true);
  });
});

describe('serializeAck', () => {
  it('serializes the current version + the given timestamp', () => {
    const parsed = JSON.parse(serializeAck(123));
    expect(parsed).toEqual({ acknowledged: true, version: NOTICE_VERSION, ts: 123 });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/unit/cookie-notice.test.ts`.

- [ ] **Step 3: Implement `src/lib/consent/notice.ts`**:

```typescript
/** Stored under localStorage['gytm:cookie-notice']. Bump NOTICE_VERSION to re-show after a policy change. */
export const NOTICE_VERSION = 1;
export const NOTICE_KEY = 'gytm:cookie-notice';

/** Show the notice unless a valid acknowledgement at the CURRENT version is stored. Malformed → show. */
export function shouldShowNotice(stored: string | null): boolean {
  if (!stored) return true;
  try {
    const v = JSON.parse(stored) as { acknowledged?: boolean; version?: number };
    return !(v && v.acknowledged === true && v.version === NOTICE_VERSION);
  } catch {
    return true;
  }
}

/** The JSON to persist when the visitor accepts. `now` is passed in (no Date.now() here — testable). */
export function serializeAck(now: number): string {
  return JSON.stringify({ acknowledged: true, version: NOTICE_VERSION, ts: now });
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: `CookieNotice.tsx`** (client). READ `src/components/site/PreferencesProvider.tsx` (for `useT()`) and an existing surface component (e.g. the toast or `NotificationsBell`) for the styling tokens + the client-only mount pattern. Implement:
  - `'use client'`. State `show` starts `false` (so SSR + first client render match → no hydration flash). In a `useEffect`, read `localStorage[NOTICE_KEY]` (try/catch; on error treat as `null`) and `setShow(shouldShowNotice(stored))`.
  - When `show`, render a slim **fixed bottom bar** (`position: fixed; bottom: 0`) — full-width, site surface bg, subtle top border, max-width inner row. Content: a short message (`t('We use cookies to run this site and show maps. No tracking or ads.')` — adjust wording), an **Accept** button (`t('Accept')`) that writes `localStorage[NOTICE_KEY] = serializeAck(Date.now())` (try/catch) then `setShow(false)`, and a **Cookie policy** link (`<a href="/cookies">{t('Cookie policy')}</a>`).
  - Accessible: wrap in `role="region" aria-label={t('Cookie notice')}`; the Accept button is a real `<button>`; visible focus.
  - NOTE: `position: fixed` is fine here (real app, not the visualize widget). Ensure it sits above content (`z-index`) and doesn't cover the mobile sticky checkout bar — give the bar a sensible z-index and, if needed, bottom padding on the body is NOT required since it auto-dismisses; just don't overlap permanently (it's dismissable).

- [ ] **Step 6: Mount** `<CookieNotice />` in `app/(site)/layout.tsx` inside `PreferencesProvider` (so `useT()` resolves), near where other global client UI mounts (the toast/bell). Do NOT add it to the static root `app/layout.tsx`.

- [ ] **Step 7: i18n** — add the banner strings to BOTH locales in `messages.ts` with real French: the message, "Accept", "Cookie policy", "Cookie notice".

- [ ] **Step 8: Verify** — `npm run typecheck && npm run lint && npx vitest run` green (report numbers). Reason through: first load shows the bar; Accept hides it + persists; reload keeps it hidden; SSR renders nothing (no flash).

- [ ] **Step 9: Commit**

```bash
git add src/lib/consent/notice.ts tests/unit/cookie-notice.test.ts src/components/site/CookieNotice.tsx "app/(site)/layout.tsx" src/lib/i18n/messages.ts
git commit -m "feat(consent): informational cookie-notice bottom bar"
```

---

## Task 2: /cookies policy page + footer link + green gate

**Files:** Create `app/(site)/cookies/page.tsx`; modify `src/components/site/SiteFooter.tsx`, `src/lib/i18n/messages.ts`; maybe the sitemap.

- [ ] **Step 1: Build `app/(site)/cookies/page.tsx`** (server component). READ `app/(site)/privacy/page.tsx` to mirror its structure (`getT()`, `generateMetadata`, the prose layout + container classes). Content (bilingual via `getT()`):
  - Title "Cookie policy" + last-updated date + a short intro.
  - An explicit line: **"We use no analytics or advertising cookies."**
  - **Strictly necessary** section — a list/table of the first-party items and what each does: sign-in/session, shopping cart, booking & checkout state, language & currency preference, wishlist, recent searches, notifications.
  - **Third-party** section — Google Maps (shown on activity/planner/checkout pages; sets Google cookies; link to Google's policy) and Peach Payments (`checkout.js`, only on the payment page; payment-session cookies).
  - **Retention** + **How to manage/clear cookies** (browser settings) + a link back to `/privacy`.
  - Keep place names / brand names verbatim (don't translate them); translate the chrome/prose.
- [ ] **Step 2: Footer link** — in `src/components/site/SiteFooter.tsx`, add `Cookie policy → /cookies` to the Legal column (alongside Terms / Privacy / Refunds), using the existing link pattern + a `t()` label.
- [ ] **Step 3: Sitemap** — if the other legal pages (`/privacy`, `/terms`, `/refunds`) are in the sitemap, add `/cookies` the same way; if they're not, skip. (Grep the sitemap generator.)
- [ ] **Step 4: i18n** — add the page's headings/labels + the footer link label to EN/FR.
- [ ] **Step 5: Green gate** — `npm run typecheck && npm run lint && npx vitest run && npm run build` (the build proves the new route compiles on edge). Report real numbers. Reason through: `/cookies` renders EN/FR; the footer link resolves; the banner's link reaches it.
- [ ] **Step 6: Commit**

```bash
git add "app/(site)/cookies/page.tsx" src/components/site/SiteFooter.tsx src/lib/i18n/messages.ts
git commit -m "feat(consent): dedicated /cookies policy page + footer link"
```

- [ ] **Step 7: Review** — request a focused review (accessibility of the bar, no hydration flash, the policy is accurate to what the app actually stores, bilingual coverage, no place-name translation).

---

## Self-review (author)

**Spec coverage:** informational bottom bar (T1) ✓; non-blocking + dismissable + persisted (T1) ✓; version-bump re-show (T1 helper) ✓; dedicated `/cookies` page accurate to real storage (T2) ✓; footer link (T2) ✓; bilingual (T1+T2 i18n) ✓; no gating/toggles/CMP (out of scope) ✓; SSR-flash-free (T1 Step 5) ✓.

**Type consistency:** `NOTICE_VERSION`/`NOTICE_KEY`/`shouldShowNotice(string|null)`/`serializeAck(number)` from `@/lib/consent/notice`, consumed only by `CookieNotice.tsx`.

**Verify-at-execution-time:** the exact `useT()` import + a styling reference component (T1 Step 5 — read PreferencesProvider + a toast/bell); the `/privacy` page structure to mirror (T2 Step 1); whether the legal pages are in the sitemap (T2 Step 3 — grep); the `(site)/layout.tsx` provider order (T1 Step 6).
