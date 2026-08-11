# Admin-editable WhatsApp contact number

**Date:** 2026-08-11
**Status:** Approved (design), ready for implementation

## Problem

Every customer-facing "Chat on WhatsApp" link on the site (the floating enquiry
bubble, the contact page, the footer, booking cards, rental, transfers, the
disruption banner, and more — ~15 call sites) is built by `whatsappUrl()` in
[site.ts](../../../src/lib/seo/site.ts), which derives the number from the
compile-time constant `SITE.phone` (`+230 5772 9919`). Changing the WhatsApp
number today means a code edit and a redeploy.

The owner wants to change **the WhatsApp number** from the admin section, without
a deploy.

## Scope (agreed)

- **Only the WhatsApp chat links change.** The displayed phone number, `tel:`
  call links, the invoice footer, and the Google/schema.org business data stay on
  `SITE.phone`. This deliberately lets the WhatsApp number differ from the phone
  number. `SITE.phone` remains the source for everything except `wa.me` links.
- **One number**, editable in admin — not a list, not booking-alert recipients
  (those are the separate `OWNER_WHATSAPP_TO` owner-alert path and are out of
  scope).
- **No new "Settings" nav section.** The field lives as a small card on the
  existing admin Dashboard (`/admin`).
- **Fallback:** if the stored number is blank/unset (or a read fails), links fall
  back to the current `SITE.phone` so they are never broken.

## Approach (agreed: "editable in DB, delivered like the other SSR values")

The site layout `app/(site)/layout.tsx` is already an async, edge, per-request
server component that resolves small values (locale, currency, USD rate) and
seeds client components through `PreferencesProvider`. The WhatsApp number is the
same kind of value, so it is delivered the same way.

Rejected alternatives: changing only the prominent entry points (would leave two
different WhatsApp numbers across the site — contradicts "one number"); an env var
(not editable without a redeploy).

## Design

### 1. Data — `business_settings` singleton table

A single-row settings table (mirrors the `guest_reviews` RLS/grants pattern:
public read, staff write via `is_staff()`).

```sql
create table if not exists business_settings (
  -- Enforced singleton: PK + check means exactly one row can ever exist.
  id boolean primary key default true check (id),
  whatsapp_number text
    check (whatsapp_number is null
           or length(regexp_replace(whatsapp_number, '\D', '', 'g')) between 8 and 15),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);
insert into business_settings (id) values (true) on conflict do nothing;

alter table business_settings enable row level security;
create policy business_settings_public_read on business_settings for select using (true);
create policy business_settings_staff on business_settings for all using (is_staff()) with check (is_staff());

grant select on business_settings to anon, authenticated, service_role;
grant update on business_settings to authenticated;  -- RLS restricts to staff
```

- The number is public (it is shown on the site anyway), so anon can read it.
- Only staff can update — same boundary as every other admin write.
- The CHECK keeps a malformed number (too few/many digits) out of the DB as a
  belt to the client-side validation; free-form text like `+230 5772 9919` is
  allowed (the digit count is what is constrained).
- Delivered as an idempotent migration `20260922000000_business_settings.sql`,
  appended verbatim to `supabase/catch-up.sql` per repo convention.
- `src/lib/supabase/types.ts` (`Database`) gets the new table's Row/Insert/Update
  types.

### 2. Server read — `getWhatsAppNumber()`

New `src/lib/settings/whatsapp-number.ts`:

- Reads `business_settings.whatsapp_number` via the anon server client
  (`createUserClient()` with no token — the public-read policy allows it).
- Returns the trimmed stored value, or `SITE.phone` when null/blank/on any error.
- Wrapped in React `cache()` so multiple reads in one request hit the DB once.
  No cross-request cache — the layout is already dynamic (reads cookies), the
  query is a single-row PK lookup, and always-fresh reads make "edit → refresh →
  see it" trivial to test. (YAGNI on tag-based caching; can be added later.)

### 3. Client delivery — provider + hook

New `src/components/site/WhatsAppNumberProvider.tsx` (client):

- `WhatsAppNumberProvider` — a trivial context provider seeded with the resolved
  number.
- `useWhatsAppNumber(): string` — returns the number, falling back to
  `SITE.phone` if used outside a provider.

Kept as its own tiny provider (single purpose) rather than folded into
`PreferencesProvider`, which is about language/currency.

### 4. `whatsappUrl` gains an optional number

```ts
export function whatsappUrl(message: string, number: string = SITE.phone): string {
  const digits = number.replace(/[^\d]/g, '') || SITE.phone.replace(/[^\d]/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
```

Backward-compatible: `whatsappUrl(msg)` still resolves to `SITE.phone`, so the
existing `tests/unit/whatsapp-links.test.ts` assertions still hold, and any call
site not yet migrated keeps working (just not editable). The empty-digits guard
means a bad stored value can never produce `wa.me//`.

### 5. Wiring the call sites

- **Layout:** resolve `getWhatsAppNumber()` alongside the other awaits and wrap
  the tree in `WhatsAppNumberProvider`.
- **Client components** (footer, ContactFloat, RentalWidget, InquiryWidget,
  BookingPanel, BookingCard, BookingConfirmation, DisruptionBanner,
  HotelToHotelQuote, InfoPage if client): read `const wa = useWhatsAppNumber()`
  and call `whatsappUrl(msg, wa)`.
- **Server components/pages** (contact, belle-mare + its HotelRail, airport-
  transfers, about — whichever are server): `const wa = await getWhatsAppNumber()`
  and pass `whatsappUrl(msg, wa)`.

Each call site is a one-line, mechanical change. The default parameter is the
safety net for anything missed.

### 6. Admin UI — Dashboard card

New `src/components/admin/WhatsAppNumberCard.tsx` (client), rendered on the admin
Dashboard:

- Loads the current value via the browser Supabase client
  (`getBrowserSupabase().from('business_settings').select('whatsapp_number')`).
- One text input, a Save button, and a live `wa.me` preview of the resulting
  link. Basic validation (8–15 digits after stripping non-digits); Save disabled
  until valid.
- Saves via `update({ whatsapp_number, updated_at, updated_by })` under staff RLS
  (matches `setLeadStatus` in [leads.ts](../../../src/lib/admin/leads.ts) — no new
  API route). Success/error toast.
- Staff-only in practice (RLS), and placed on the Dashboard, which the restricted
  `seo` role does not use for this.

### 7. Tests

- Extend `tests/unit/whatsapp-links.test.ts`: `whatsappUrl(msg, number)` uses the
  passed number (digits only); empty/garbage number falls back to `SITE.phone`
  digits; the zero-arg form is unchanged.
- New unit test for `getWhatsAppNumber()` fallback (stubbed client returns
  null/empty/throws → `SITE.phone`; a real value → that value, trimmed).
- If an integration schema/RLS test enumerates tables, add `business_settings`
  (public-read + staff-write) to its expectations.

## Out of scope

- WhatsApp booking-alert recipients (`OWNER_WHATSAPP_TO`) — unrelated path.
- Editing the displayed phone / `tel:` / invoice / schema.org number.
- A general admin Settings section (explicitly declined).

## Risks

- **Call-site breadth (~15 files).** Mechanical, and the `whatsappUrl` default
  parameter means a missed site degrades to the old constant rather than breaking.
- **Per-request DB read in the layout.** One cached single-row PK lookup on an
  already-dynamic layout; negligible, and revisitable if it ever shows up.
- **New table must reach every environment.** Migration + `catch-up.sql` append;
  confirm the CI/integration DB build picks it up.
