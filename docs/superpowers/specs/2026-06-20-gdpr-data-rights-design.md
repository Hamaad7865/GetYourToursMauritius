# GDPR Data Rights (Erasure + Export) — Design

> Brainstormed 2026-06-20. Implements the data-subject **right to erasure** and **right of access /
> portability** for the EU-facing tours platform (Mauritius DPA 2017 + EU GDPR). Closes the audit gap:
> no erasure path, no export, indefinite PII retention. **Not legal advice** — the owner confirms the
> retention periods + the non-code obligations (DPAs, EU representative, controller registration) with
> counsel; this builds the technical mechanisms + drafts the supporting documents.

## Locked decisions
1. **Anonymize-with-retention** (the only model compatible with tax/accounting retention on paid bookings):
   - **Hard-delete** (no retention obligation): `profiles`; `bookings` (+ `booking_items`/`booking_holds`)
     in non-paid states (`draft/held/expired/cancelled` with `payment_state='pending'`); `leads`;
     `chat_sessions`/`chat_messages`; the Supabase `auth.users` record.
   - **Anonymize + retain** (legal retention): paid/terminal `bookings` (`confirmed/completed/refunded`) —
     `customer_name`→'(Deleted user)', `customer_email`/`customer_phone`/`notes`→null; `notification_outbox`
     payload (drop `customerName`) + `recipient`→null; `audit_logs.diff` PII keys redacted; `payments`/
     `payment_events` kept (no direct customer PII; redact any payload PII); review `author` (if any) →
     '(Deleted user)'. The financial rows survive for tax; the person is no longer identifiable.
2. **Self-serve for logged-in users + admin action for guests.** Logged-in users erase/export themselves
   from `/account`; guests (no account) are handled by staff via an admin "Erase customer data" action.
3. **Upcoming paid trip → warn + proceed (anonymize).** The delete dialog warns when the user has upcoming
   confirmed bookings (they'll be anonymized; contact us to reschedule), then proceeds — erasure without
   undue delay. (GDPR permits limiting erasure for an active contract, but the owner chose warn+proceed.)

## Architecture
### Erasure engine — `api_erase_user(p jsonb)` (SECURITY DEFINER)
Input `{ userId?: uuid, email?: text }`. Guard: `is_staff() OR (auth.uid() is not null and auth.uid() =
p.userId)`. (Self-serve passes its own `userId` + the session email; the admin/guest path passes `email`
and requires staff.) In one transaction it: hard-deletes the safe rows (by `user_id = userId` AND by
`customer_email = email` for guest rows), anonymizes the retained rows (same two keys), writes one
`audit_logs` entry recording the erasure (actor + counts, no PII), and is **idempotent** (re-running finds
nothing left to change). Returns a jsonb summary `{ deleted: {...}, anonymized: {...} }`. Follows the
existing `api_mark_refunded` / `is_staff()` pattern. Migration + `catch-up.sql` mirror + types.

### Self-serve UI — a "Data & privacy" tab in `/account`
- **Route/component:** `app/(site)/account/privacy/page.tsx` + `src/components/account/AccountPrivacy.tsx`
  (client), added to `AccountNav`.
- **Download my data:** gathers the user's `profiles` row + their `bookings` (+ items, via the existing
  RLS-scoped browser client — no new RPC; RLS already limits to the owner), serializes to JSON, triggers a
  client download (`account-data-{date}.json`). The access/portability right.
- **Delete my account:** a confirmation dialog (type-to-confirm) that, before proceeding, checks for
  upcoming confirmed bookings and shows the warning; on confirm it calls a server action.
- **Server action** (`app/(site)/account/actions.ts`, service-role): re-validates the session, calls
  `api_erase_user({ userId, email })` via the service-role client, then `auth.admin.deleteUser(userId)`,
  then signs the user out. Errors surface cleanly; the action is the only place auth deletion happens.

### Guests + staff — admin "Erase customer data"
In `AdminBookings` (the booking drawer), a staff-only **"Erase customer data"** action that calls
`api_erase_user({ email })` for that booking's customer email (with a confirm dialog), so the operator can
fulfil a written guest request. Reuses the same engine; staff-guarded.

### Policy + paperwork
- Update `app/(site)/privacy/page.tsx`: name every processor (Supabase, Resend, Peach, Google Maps/AI),
  list the rights (access, erasure, rectification, portability, objection) + exactly how to exercise them
  (the account controls + a privacy contact email for guests/written requests), and state retention periods
  (paid-booking financial data kept N years for tax then anonymized; non-essential data deleted on request).
- **Draft** (markdown under `docs/legal/`, for the owner's lawyer — NOT filed): a Records-of-Processing
  (RoPA), a data-breach response checklist, and a processor-DPA tracker.

## Error handling
The erasure RPC is transactional + idempotent; a failure rolls back and surfaces a clean error (the user is
NOT signed out / auth not deleted unless the DB erasure succeeded). `auth.admin.deleteUser` runs only after
the DB step succeeds; if auth deletion fails, the DB data is already anonymized (safe) and the error is
logged for staff follow-up (the account is effectively erased data-wise). No PII in any log.

## Testing
- Integration (PGlite): seed a user with a profile, a paid (confirmed) booking, an unpaid (draft) booking, a
  lead by the same email, an outbox row → `api_erase_user({userId,email})` as the owner → assert: profile
  gone, draft booking gone, lead gone, confirmed booking ANONYMIZED (name placeholder, email/phone null,
  financial cols intact), outbox payload redacted; a non-owner/non-staff caller → `forbidden`; a second call
  is a no-op (idempotent); a staff caller can erase by `email` (guest path).
- Unit: the export serializer (shape of the JSON; no other users' data).
- Manual: the account "Data & privacy" tab (download + delete-with-warning), the admin erase action, the
  updated privacy page (EN/FR).

## Out of scope
An automatic retention-sweep cron (future); the legal filing of DPAs / EU-representative appointment /
controller registration (owner + counsel — this only drafts the documents); erasing client-side localStorage
(`gytm:*` keys clear on sign-out / are device-local — note in the policy).
