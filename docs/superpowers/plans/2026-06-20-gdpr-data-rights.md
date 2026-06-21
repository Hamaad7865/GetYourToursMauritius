# GDPR Data Rights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the right to erasure (anonymize-with-retention) + the right of access/export, self-serve for logged-in users and a staff action for guests, plus an updated privacy policy + drafted legal docs.

**Architecture:** A `SECURITY DEFINER` `api_erase_user` engine (hard-delete safe rows + anonymize retained rows, idempotent, guarded); a `/account` "Data & privacy" tab (JSON export via RLS + a delete server action that also removes the auth user); an admin erase action; privacy-page + docs.

**Tech Stack:** Next.js 15 App Router (edge), Supabase RPCs, TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-gdpr-data-rights-design.md`. The PII inventory + hard-delete-vs-anonymize split + the RPC pattern are mapped in the brainstorm; follow them.

---

## Task 1: The erasure engine — `api_erase_user` RPC

**Files:** Create `supabase/migrations/20260727000000_gdpr_erase.sql`, `tests/integration/gdpr-erase.test.ts`; modify `supabase/catch-up.sql`, `src/lib/supabase/types.ts`, `tests/db/rpc.ts`.

- [ ] **Step 1: Failing integration test** `tests/integration/gdpr-erase.test.ts`. READ `tests/integration/admin-mark-refunded.test.ts` + the seed helpers for the harness (how to seed a user/profile/booking, set `db.as({sub, role})`). Seed: a profile (user U), a CONFIRMED+paid booking for U, a DRAFT (pending) booking for U, a `leads` row with U's email, a `notification_outbox` row for U's confirmed booking. Test:
  - `api_erase_user({ userId: U, email: U_email })` called as U (owner) → returns a summary; assert: `profiles` row gone; the draft booking gone; the lead gone; the **confirmed booking still exists but anonymized** (`customer_name = '(Deleted user)'`, `customer_email`/`customer_phone` null, `total_minor` + `status` UNCHANGED); the outbox `payload` has no `customerName` and `recipient` is null.
  - A second call → no-op (idempotent), no error.
  - Called by a DIFFERENT non-staff user → raises `forbidden`.
  - Called by STAFF with only `{ email: guest_email }` (a guest booking, user_id null) → anonymizes/deletes the guest rows by email.

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Migration `20260727000000_gdpr_erase.sql`** (dated after the latest). Define `api_erase_user(p jsonb)` SECURITY DEFINER. READ the REAL schema (the explore mapped it) to get exact table/column names + the booking status enum values. Shape:
```sql
create or replace function api_erase_user(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := nullif(p ->> 'userId','')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'),''));
  v_del_bookings int := 0; v_anon_bookings int := 0;
begin
  -- Guard: staff, OR the signed-in user erasing THEMSELVES.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Hard-delete non-retained bookings (unpaid/abandoned) owned by the user OR matching the guest email,
  -- with their items/holds (FK order). Use the REAL non-paid states + payment_state.
  -- delete from booking_holds where booking_id in (select id from bookings where (user_id = v_uid or lower(customer_email)=v_email) and status in ('draft','held','expired','cancelled') and payment_state='pending');
  -- delete from booking_items where ... ; get diagnostics v_del_bookings = row_count after deleting bookings ...

  -- Anonymize retained (paid/terminal) bookings.
  update bookings set customer_name='(Deleted user)', customer_email=null, customer_phone=null, notes=null
    where (user_id = v_uid or lower(customer_email)=v_email) and status in ('confirmed','completed','refunded');
  get diagnostics v_anon_bookings = row_count;

  -- Anonymize the outbox payload + recipient for those bookings.
  update notification_outbox set recipient=null, payload = (payload - 'customerName')
    where recipient = ... or booking_id in (select id from bookings where user_id = v_uid or lower(customer_email)=v_email);

  -- Redact audit_logs diffs; anonymize any review author tied to the user (if reviews link to a user/booking).
  -- Hard-delete: leads (by email), chat_sessions/messages (by user), then the profile.
  delete from leads where lower(contact) = v_email or ...;
  delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
  delete from chat_sessions where user_id = v_uid;
  delete from profiles where id = v_uid;

  -- One audit row (no PII): who erased, the counts.
  insert into audit_logs(actor_id, actor_role, action, entity_type, entity_id, summary)
    values (auth.uid(), case when is_staff() then 'staff' else 'user' end, 'erase_user', 'user', v_uid,
            'gdpr erasure: anon '||v_anon_bookings||' booking(s)');

  return jsonb_build_object('ok', true, 'anonymizedBookings', v_anon_bookings, 'deletedBookings', v_del_bookings);
end; $$;
revoke execute on function api_erase_user(jsonb) from anon;
grant execute on function api_erase_user(jsonb) to authenticated, service_role;
```
Adapt EVERY table/column/enum to the real schema (the pseudo-SQL above is a sketch — verify `leads.contact` vs `email`, the `reviews` linkage, the `audit_logs` columns, the booking status values). Keep it idempotent (re-running anonymized rows is a no-op; deletes of already-gone rows are no-ops). Mirror the whole function into `supabase/catch-up.sql`; add to `tests/db/rpc.ts` allow-list; add the RPC signature to `src/lib/supabase/types.ts`.

- [ ] **Step 4: Run → PASS.** Run `catch-up-parity.test.ts` too.

- [ ] **Step 5: Commit** — `git add supabase/migrations/20260727000000_gdpr_erase.sql supabase/catch-up.sql src/lib/supabase/types.ts tests/db/rpc.ts tests/integration/gdpr-erase.test.ts && git commit -m "feat(gdpr): api_erase_user — anonymize-with-retention erasure engine"`

---

## Task 2: Self-serve "Data & privacy" — export + delete

**Files:** Create `app/(site)/account/privacy/page.tsx`, `src/components/account/AccountPrivacy.tsx`, `app/(site)/account/actions.ts`, `src/lib/account/export.ts`; modify `src/components/account/AccountChrome.tsx` (AccountNav), `src/lib/i18n/messages.ts`.

- [ ] **Step 1: Export serializer + test.** `src/lib/account/export.ts` `buildAccountExport(profile, bookings): object` — a pure function shaping the user's own data into a clean JSON object (profile fields + a bookings array with ref/date/status/total/items; no internal ids that aren't theirs, no other users' data). Unit-test the shape. (The DATA is fetched by the component via the RLS browser client — RLS already scopes to the owner — so this helper is pure.)
- [ ] **Step 2: `AccountPrivacy.tsx`** (client) — READ `AccountProfile.tsx`/`AccountBookings.tsx` for the patterns (browser client, useAuth, styling). Renders:
  - **Download my data:** a button that fetches the user's `profiles` row + `bookings` (via the RLS browser client, the same queries the other account pages use), runs `buildAccountExport`, and triggers a JSON download (`account-data-{YYYY-MM-DD}.json`).
  - **Delete my account:** a button → a confirm dialog requiring the user to type a word (e.g. DELETE) to confirm; BEFORE confirming, it checks the loaded bookings for upcoming `confirmed` trips and shows the warning ("Upcoming bookings will be anonymized; contact us to reschedule.") when present; on confirm it calls the server action, then on success signs out + redirects home with a "your account was deleted" message.
  - Bilingual via `useT()`.
- [ ] **Step 3: Server action** `app/(site)/account/actions.ts` `'use server'` `deleteMyAccount()` — re-validate the session (get the user + email server-side), call `createServiceRoleClient().rpc('api_erase_user', { p: { userId, email } })`, then `createServiceRoleClient().auth.admin.deleteUser(userId)`. Order: DB erasure FIRST (if it throws, do NOT delete auth); on auth-delete failure, log (no PII) + still return success (data is already anonymized). READ `src/lib/supabase/admin.ts` + how other server-side auth is validated.
- [ ] **Step 4: Nav + i18n** — add a "Data & privacy" tab to `AccountNav` (`AccountChrome.tsx`) linking `/account/privacy`; add the new strings to EN/FR.
- [ ] **Step 5: Verify + commit** — `npm run typecheck && npm run lint && npx vitest run` green.
```bash
git add "app/(site)/account/privacy/page.tsx" src/components/account/AccountPrivacy.tsx "app/(site)/account/actions.ts" src/lib/account/export.ts tests/unit/account-export.test.ts src/components/account/AccountChrome.tsx src/lib/i18n/messages.ts
git commit -m "feat(gdpr): self-serve data export + account deletion in /account"
```

---

## Task 3: Admin "Erase customer data" (guest/written requests)

**Files:** modify `src/components/admin/AdminBookings.tsx`, `src/lib/admin/bookings.ts`.

- [ ] **Step 1:** In the AdminBookings booking drawer, add a staff-only **"Erase customer data"** action with a confirm dialog ("Permanently anonymize {email}'s personal data across all their bookings. Use only for a verified erasure request."). It calls `api_erase_user({ email: booking.customerEmail })` via the admin/service path (READ how `markBookingRefunded` calls its RPC — mirror it). On success, refresh. Match the existing admin action pattern + confirm style.
- [ ] **Step 2: Verify + commit** — `npm run typecheck && npm run lint && npx vitest run` green.
```bash
git add src/components/admin/AdminBookings.tsx src/lib/admin/bookings.ts
git commit -m "feat(gdpr): admin erase-customer-data action for guest requests"
```

---

## Task 4: Privacy policy update + drafted legal docs

**Files:** modify `app/(site)/privacy/page.tsx`; create `docs/legal/records-of-processing.md`, `docs/legal/breach-response-checklist.md`, `docs/legal/processor-dpa-tracker.md`.

- [ ] **Step 1: Privacy page.** READ `app/(site)/privacy/page.tsx`. Update/extend it to clearly state: the **processors** (Supabase = hosting/DB, Resend = email, Peach = payments, Google = maps/AI) and that data may be processed outside Mauritius/the EU under appropriate safeguards; the **data rights** (access, erasure, rectification, portability, objection); **how to exercise them** (the self-serve `/account` controls for account-holders + a privacy contact email for guests/written requests, fulfilled within 30 days); **retention** (paid-booking financial records kept for the legal tax-retention period then anonymized; non-essential data deleted on request); and a note that browser-stored data (cart/preferences) is device-local and cleared on sign-out. Bilingual (mirror the page's existing i18n approach). Use the real business contact from `src/lib/seo/site.ts`. Do NOT invent specific retention YEARS as legal fact — phrase as "for the period required by Mauritius tax/accounting law" and flag for the owner to set the exact number with their accountant.
- [ ] **Step 2: Draft docs** (markdown, clearly marked "DRAFT — for legal review, not filed"): 
  - `records-of-processing.md` — a RoPA table: each processing activity (bookings, payments, email, leads, planner/AI), the data categories, purpose, lawful basis, recipients/processors, transfers, retention.
  - `breach-response-checklist.md` — detect → contain → assess → notify (the Mauritius Data Protection Office + affected individuals where required, with the 72-hour GDPR target) → document.
  - `processor-dpa-tracker.md` — a checklist of each sub-processor (Supabase, Resend, Peach, Google, Cloudflare) with columns for "DPA signed?", "SCCs in place?", "location", "what they process".
- [ ] **Step 3: Verify + commit** — `npm run typecheck && npm run lint && npm run build` green (the privacy route compiles).
```bash
git add "app/(site)/privacy/page.tsx" docs/legal/ src/lib/i18n/messages.ts
git commit -m "docs(gdpr): privacy policy data-rights section + RoPA/breach/DPA drafts"
```

---

## Task 5: Green gate + review

- [ ] **Step 1:** `npm run typecheck && npm run lint && npx vitest run && npm run build` — all green; report real numbers.
- [ ] **Step 2:** Request a focused review: the erasure correctly anonymizes-vs-deletes per the retention split (no financial row hard-deleted; no PII left on a retained row); the guard can't let one user erase another; idempotency; the server action deletes auth only after the DB step; no PII in logs; the privacy page is accurate to what's actually built; bilingual.
- [ ] **Step 3:** Commit any review fixes.

---

## Self-review (author)

**Spec coverage:** anonymize-with-retention engine (T1) ✓; self-serve export + delete (T2) ✓; warn-on-upcoming (T2 Step 2) ✓; admin guest erase (T3) ✓; privacy policy + drafted RoPA/breach/DPA (T4) ✓; idempotent + guarded + audit-logged (T1) ✓; auth deletion after DB step (T2 Step 3) ✓.

**Type consistency:** `api_erase_user({ userId?, email? })` used by the server action (T2) and the admin action (T3); `buildAccountExport` (T2) pure.

**Verify-at-execution-time:** the REAL table/column/enum names + the `leads`/`reviews`/`audit_logs` linkage (T1 — the pseudo-SQL is a sketch; read the schema); the `auth.admin.deleteUser` call shape on the service-role client (T2 Step 3); the AccountNav + privacy-page i18n patterns (T2/T4); the exact non-paid booking states to hard-delete vs anonymize (T1 — confirm against the booking status enum).
