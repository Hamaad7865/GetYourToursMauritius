# Domain cutover runbook — bellemaretours.com

Move **bellemaretours.com** onto the new booking app (Cloudflare Pages) **without breaking email**.

Work top to bottom and tick the boxes. The order is deliberate: **DNS first, prove mail still works,
web last.** Do not skip ahead — the one thing that goes irreversibly wrong in a cutover is email.

---

## 0. What is actually moving

| Thing                                            | Before                   | After                              |
| ------------------------------------------------ | ------------------------ | ---------------------------------- |
| **DNS management**                               | Evolosis                 | ➡️ **Cloudflare**                  |
| **Web traffic** (`bellemaretours.com`)           | 302 → visitemaurice.com  | ➡️ **Cloudflare Pages** (this app) |
| **Mailboxes** (`imap`/`smtp.bellemaretours.com`) | Evolosis                 | ⛔ **stays on Evolosis**           |
| **WordPress site**                               | visitemaurice.com        | ⛔ **stays exactly as it is**      |
| **Domain registration**                          | wherever it's registered | ⛔ **no transfer needed**          |

Only DNS + web move. **You do not need to transfer the domain registrar**, and you must not move the
hosting or the mailboxes.

> `visitemaurice.com` is a **separate domain with its own DNS zone** — nothing in this runbook touches
> it. The WordPress site keeps running and keeps its rankings.

### The two mailboxes

| Mailbox                       | Job                                                                                                                                   | Who reads it                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `bookings@bellemaretours.com` | **Outbound only.** The identity the app sends confirmations, vouchers and invoices _as_ (`RESEND_FROM`).                              | Nobody — it's a send-only identity. |
| `info@bellemaretours.com`     | **The human inbox.** Shown on the site (contact + legal pages), receives owner alerts, and is the **Reply-To** on every mail we send. | **You.**                            |

The app sets `Reply-To: info@…` on every outbound email, so a guest hitting **Reply** on their booking
confirmation reaches you rather than an unwatched mailbox. In code this is `SITE.email`
([src/lib/seo/site.ts](../src/lib/seo/site.ts)).

---

## 1. Before you touch anything (5 min, saves the day)

- [ ] **Write down Evolosis's current nameservers.** This is your rollback. (Something like
      `ns1.evolosis…` / `ns2.evolosis…`.)
- [ ] Find out **where the domain is registered** — the nameserver change happens at the **registrar**,
      which may or may not be Evolosis.
- [ ] In Evolosis → **DNS Zone Editor** for `bellemaretours.com`: **export or screenshot every single
      record.** All of them. This is the source of truth you will diff against.
- [ ] Confirm you can log into a `@bellemaretours.com` mailbox right now (so "mail works" means
      something later).

---

## 2. Add the domain to Cloudflare — but change NOTHING yet

- [ ] Cloudflare → **Add a site** → `bellemaretours.com` → pick a plan (Free is fine).
- [ ] Cloudflare scans and **imports** the existing DNS records.

> ⚠️ **The import is best-effort and routinely misses records.** Cloudflare can only guess at common
> subdomains — it cannot enumerate a zone it doesn't control. Treat the import as a _starting point_,
> never as "done".

- [ ] **Diff it against your Evolosis export.** Add, by hand, anything missing. Pay attention to:

| Record                                      | Why it matters                                          |
| ------------------------------------------- | ------------------------------------------------------- |
| **MX**                                      | Inbound mail. Miss this → **you stop receiving email.** |
| `A` for `mail`, `imap`, `smtp`, `webmail`   | Your mail clients connect to these hosts.               |
| **SPF** (`TXT`, starts `v=spf1`)            | Miss it → your mail gets marked spam.                   |
| **DKIM** (`TXT`, e.g. `default._domainkey`) | Same.                                                   |
| **DMARC** (`TXT` on `_dmarc`)               | Same.                                                   |
| `autodiscover` / `autoconfig`               | Outlook/Thunderbird auto-setup.                         |
| Any other `TXT` (domain verifications)      | e.g. Google/Microsoft ownership proofs.                 |

- [ ] 🔴 **Set every mail-related record to "DNS only" (grey cloud) — never proxied (orange cloud).**
      Cloudflare's proxy only carries HTTP/HTTPS. Orange-clouding `mail`/`imap`/`smtp`
      **silently breaks email.** This is the single most common way people destroy their mail.
- [ ] **Leave the web records pointing where they already point.** Do not connect Pages yet. After the
      nameserver switch the site should behave _exactly as it does today_ — that's how you know DNS
      moved cleanly and nothing else changed.

---

## 3. Flip the nameservers

- [ ] At the **registrar**, replace the nameservers with the two Cloudflare gives you.
- [ ] Wait for Cloudflare to show the zone as **Active** (usually minutes; allow up to 24h).

---

## 4. 🔴 GATE: prove email still works

**Do not go further until this passes.**

- [ ] **Send** an email from `info@bellemaretours.com` to an outside address (e.g. Gmail). It arrives.
- [ ] **Receive**: reply from that outside address. It lands in the mailbox.
- [ ] Your mail client (phone/desktop) still connects — no password prompts, no errors.
- [ ] Check the received mail isn't in **spam** (a missing SPF/DKIM shows up here).

**If mail is broken:** put the Evolosis nameservers back (step 1), wait for propagation, and fix the
missing records before retrying. Nothing else in this runbook has changed yet, so rollback is clean.

---

## 5. Point the web at the app

Only now does the site actually move.

- [ ] Cloudflare **Pages** → your project → **Custom domains** → add `bellemaretours.com` (and `www`).
      This replaces the old record and **kills the current 302 → visitemaurice.com**.
- [ ] Decide the canonical host and redirect the other to it (`www` → apex, or apex → `www`). Pick one
      and stick to it — don't serve both.
- [ ] Pages → **Settings → Environment variables**:
      `NEXT_PUBLIC_SITE_URL=https://bellemaretours.com`

> Everything in the app — canonical tags, social/OG images, structured data, the sitemap, the CORS
> allow-list, Peach return URLs and every link inside emails — is derived from that one variable. There
> is no other place the domain is hardcoded.

- [ ] Set the rest of the Pages env/secrets (Supabase, Peach, Resend, `INTERNAL_TASK_SECRET`) — see
      [gytm go-live checklist](./../README.md) / the go-live notes.
- [ ] Confirm `https://bellemaretours.com` serves the app over HTTPS.

---

## 6. Mailboxes + Resend (sending)

- [ ] In Evolosis, create the two mailboxes: - `bookings@bellemaretours.com` (send-only identity) - `info@bellemaretours.com` (**the inbox you actually read**)
- [ ] Resend → **add + verify the domain** `bellemaretours.com`; add the DNS records it gives you
      (in Cloudflare, **DNS only / grey cloud**).
- [ ] Pages env: `RESEND_FROM=Belle Mare Tours <bookings@bellemaretours.com>` and `RESEND_API_KEY=…`
- [ ] _(Optional)_ `OWNER_NOTIFY_EMAIL=info@bellemaretours.com` — if unset it already defaults to
      `SITE.email` (`info@…`), so you can skip it.

### 🔴 The SPF footgun — read this

**A domain may only have ONE SPF record.** You already have one from Evolosis (for your mailboxes). If
you _add a second_ SPF `TXT` for Resend, SPF hits a `permerror` and **your deliverability collapses**.

Two correct options:

1. **Sending subdomain (recommended, safest).** Verify Resend on `send.bellemaretours.com`. Its SPF
   lives on the subdomain and can't collide with your inbox's SPF at the root. Mail still _displays_
   as coming from `bookings@bellemaretours.com`.
2. **Merge into one record.** Keep a single root SPF containing both:
   `v=spf1 include:<evolosis-include> include:<resend-include> ~all`
   Never two separate `v=spf1` records.

DKIM and DMARC are fine — those are per-selector and don't collide.

---

## 7. Verify the whole path

- [ ] Make a **real test booking** on the live domain.
- [ ] The **confirmation email arrives** (from `bookings@`, not in spam).
- [ ] **Hit Reply on it** — the reply should address `info@bellemaretours.com`, and land in your inbox.
- [ ] The **owner alert** for the new booking reaches `info@`.
- [ ] Links inside the email point at `https://bellemaretours.com` (not localhost, not the tunnel).
- [ ] Old indexed URLs from the previous bellemaretours.com site (`/excursions/`, `/tour/…`) don't
      404 — add redirects in **/admin/redirects** if any do.

---

## 8. Search engines (after the site is live and stable)

- [ ] Google **Search Console** → add + verify `bellemaretours.com`; submit `/sitemap.xml`.
- [ ] Set `NEXT_PUBLIC_GSC_VERIFICATION` in Pages env if you use the meta-tag method.
- [ ] **Google Business Profile** → set the website to `https://bellemaretours.com`.
- [ ] Add prominent "Book online → bellemaretours.com" links on the WordPress site — it's your own
      highest-relevance backlink.

---

## Rollback summary

| Broke          | Do this                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| **Email**      | Restore the Evolosis nameservers at the registrar.                           |
| **Website**    | Remove the custom domain from Pages, or point the DNS record back.           |
| **Everything** | Nameservers back to Evolosis. WordPress/visitemaurice.com was never touched. |

Keep the old records in your export until you've been live and stable for a couple of weeks.
