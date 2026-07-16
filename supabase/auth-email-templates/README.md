# Branded auth emails (Supabase → Resend SMTP)

Why: Supabase's default auth emails (plain template, Supabase's own sender) look nothing like the
brand — a password reset that "doesn't feel genuine" trains customers to distrust exactly the email
they must trust most. These templates + custom SMTP make every auth email come **from
`accounts@bellemaretours.com`, with the logo, in brand colours** — like a real operator.

The four templates in this folder share one layout: logo header (the live
`https://bellemaretours.com/logo.png` — email clients can't render SVG, so it must stay a PNG),
white card, teal-dark button, legal footer. Owner pastes them into the Supabase dashboard once.

---

## Order matters: verify the domain in Resend FIRST

Nothing here works until **bellemaretours.com is verified in Resend**. Sending from an unverified
domain is rejected — for auth emails that means password resets silently never arrive.

### 1. Resend — verify bellemaretours.com

Resend dashboard → **Domains → Add Domain** → `bellemaretours.com` (the ROOT domain — the apex is
clean now that the old stackmail SPF was purged, and root verification lets us send as both
`accounts@` and `bookings@`).

Resend shows 3–4 DNS records. Add each in **Cloudflare → bellemaretours.com → DNS → Records**
(MX/TXT records have no proxy toggle — just add them exactly as shown):

- `MX  send.bellemaretours.com` → the feedback-smtp host Resend shows
- `TXT send.bellemaretours.com` → `v=spf1 include:amazonses.com ~all` (or as shown)
- `TXT resend._domainkey.bellemaretours.com` → the long `p=…` DKIM key

Back in Resend, click **Verify** — usually green within minutes.

While in Cloudflare DNS, also add the DMARC record it has been recommending:

- `TXT _dmarc.bellemaretours.com` → `v=DMARC1; p=none; rua=mailto:boodoo.sheik786@gmail.com`

(`p=none` = monitor only; tighten to `quarantine` after a few clean weeks.)

### 2. Supabase — custom SMTP

Supabase dashboard → **Project Settings → Authentication → SMTP Settings** → Enable custom SMTP:

| Field        | Value                                             |
| ------------ | ------------------------------------------------- |
| Host         | `smtp.resend.com`                                 |
| Port         | `465`                                             |
| Username     | `resend`                                          |
| Password     | the Resend API key (same one as `RESEND_API_KEY`) |
| Sender email | `accounts@bellemaretours.com`                     |
| Sender name  | `Belle Mare Tours`                                |

Raise the per-hour email rate limit (Authentication → Rate Limits) if it's still at the restrictive
built-in default — 30/hour is plenty.

### 3. Supabase — paste the templates

**Authentication → Emails (Templates)** — for each, paste the matching file's full contents and set
the subject:

| Template tab         | File                  | Subject                                 |
| -------------------- | --------------------- | --------------------------------------- |
| Reset password       | `reset-password.html` | Reset your Belle Mare Tours password    |
| Confirm sign up      | `confirm-signup.html` | Confirm your email for Belle Mare Tours |
| Magic link           | `magic-link.html`     | Your Belle Mare Tours sign-in link      |
| Change email address | `change-email.html`   | Confirm your new email address          |

(Invite / Reauthentication aren't used by the app — leave them.)

### 4. Test

On `https://bellemaretours.com`: sign in modal → **Forgot password?** → your own email. The email
must arrive **from Belle Mare Tours `<accounts@bellemaretours.com>`**, with the logo, and the
button must land on `/auth/reset-password` and accept a new password.

### 5. Same moment — finish Phase 5 for the BOOKING emails too

The domain is now verified, so the transactional sender can finally move off the old domain:

1. Cloudflare Pages → project → Settings → Environment variables (Production):
   `RESEND_FROM` = `Belle Mare Tours <bookings@bellemaretours.com>` → **redeploy**.
2. Update `.env.local` line `RESEND_FROM=` to match (it still holds the old-domain value and would
   get re-copied into dashboards otherwise).
3. Cloudflare → bellemaretours.com → **Email → Email Routing**: route
   `info@bellemaretours.com` → the owner's real inbox. `info@` is the **Reply-To on every booking
   email** — until this exists, customer replies bounce.

---

Maintenance note: the templates hard-code brand hexes (ink `#0A2E36`, teal-dark `#0B5C63`, muted
`#51666B`, wash `#F0F4F5`) because email clients need inline styles — if the site palette ever
changes, update all four files. `{{ .ConfirmationURL }}` / `{{ .Email }}` / `{{ .NewEmail }}` are
Supabase Go-template variables; leave them exactly as written.
