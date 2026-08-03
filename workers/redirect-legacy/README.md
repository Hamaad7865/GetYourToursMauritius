# Retiring visitemaurice.com

The old WordPress site at **visitemaurice.com** is being taken down and every URL 301'd to the
matching page on **bellemaretours.com**. One URL map, `src/map.js`, drives two possible deployments.

## Which one to use

**→ Plan A — `apache/.htaccess` on the existing hosting. Start here.**

Delete the WordPress files, upload the three files from `apache/`, done. No DNS change, no
nameserver cutover, and — the reason this is the default — **the `info@visitemaurice.com` mailbox is
never touched**. Clients email that address; it is worth more than the hosting fee. Generate the
files with:

```bash
node scripts/build-legacy-htaccess.mjs
```

**Plan B — the Cloudflare Worker in `src/`.** Only worth the extra moving parts if the hosting plan
is being cancelled outright to save the fee. That is the expensive version: it forces a nameserver
change _and_ a migration of the live mailbox, because the mail is on the same provider as the
website. Everything it needs is in [Cutover](#cutover) and [Mail](#mail--migrate-it-then-forward-forever)
below; skip both sections entirely if you are on Plan A.

Both deployments share the same map and the same tests, so switching later costs nothing.

## What it does

| Request                               | Response                                                      |
| ------------------------------------- | ------------------------------------------------------------- |
| Any mapped URL                        | `301` to the equivalent page, one hop, query string preserved |
| An unmapped URL under a known section | `301` to that section's hub page                              |
| Anything else                         | `301` to the home page                                        |
| `/robots.txt`                         | `200`, allow-all, pointing at the legacy sitemap              |
| The eight old sitemap filenames       | `200`, a sitemap of the OLD urls                              |

Serving the old sitemap looks backwards but is deliberate: it invites Google to recrawl exactly the
URLs that now redirect, so the ranking signals move across in weeks rather than months. Retire it
once Search Console shows the old URLs consolidated — roughly a year after cutover.

`robots.txt` is served rather than redirected because during a domain move a crawler must be able to
reach the 301s, and a redirected `robots.txt` is one more thing that can fail at the worst moment.

## The map

`src/map.js` holds 199 exact rules plus 21 longest-prefix fallbacks, built from the old site's five
sitemaps **and** the SEO crawl export. The crawl mattered: it turned up an entire earlier permalink
structure (flat `/helicotour`, `/en/hiking-le-morne`, …) that no sitemap lists but that is still
indexed. `legacy-urls.txt` is that full inventory, and
`tests/unit/legacy-redirects.test.ts` asserts every path in it resolves to a specific rule rather
than the catch-all — a mass redirect onto the home page reads as a soft 404 to Google and inherits
nothing.

To re-check the map after a re-crawl, paste the new paths into `legacy-urls.txt` and run:

```bash
npx vitest run tests/unit/legacy-redirects.test.ts
```

### French is not URL-addressable yet

Two thirds of the old site's indexed URLs were French (French at the root, English under `/en/`). The
new site has French content, but `getLocale()` reads the `gytm_lang` **cookie** — French has no URL
of its own and no `hreflang`, and a cross-domain redirect cannot set a cookie on another domain. So
today every French URL lands on the English rendering of the right page.

When French becomes URL-addressable, set `FR_PREFIX` in `src/map.js` to `'/fr'`. That is the only
edit needed here — every French row is already tagged by `isFrenchSource()`.

## Plan A — upload to the existing hosting

1. Run `node scripts/build-legacy-htaccess.mjs`. It writes `apache/.htaccess`, `apache/robots.txt`
   and `apache/sitemap.xml`.
2. **Take a backup of the hosting account first** — files and database. Once WordPress is deleted
   there is no undo, and the old article text is the only copy of that content.
3. **Delete the WordPress files** from the web root. Not "install a redirect plugin" — leaving
   WordPress online keeps an ageing, public, patch-hungry application running for no reason. Once the
   rules are in place nothing else needs to exist on that server.
4. Upload the three files to the web root.
5. Verify:

   ```bash
   curl -sSI https://www.visitemaurice.com/en/sightseeing/north-tour/ | grep -i '^location'
   ```

   Expect `https://bellemaretours.com/activities/north-tour`.

6. Keep the hosting plan and the domain registration alive — the 301s have to outlive the migration
   by years. Everything under [After cutover](#after-cutover) still applies.

Nothing about mail changes on this plan. The mailbox, its MX records and the nameservers all stay
exactly where they are.

## Cutover

**Plan B only.** Skip this whole section if the `.htaccess` is going on the existing hosting.

Nothing below affects the live site until step 4. Steps 1–3 are safe to do in advance.

1. **Add `visitemaurice.com` as a zone** in the same Cloudflare account as bellemaretours.com. Free
   plan is enough. Do **not** change nameservers yet.
2. **Recreate the current DNS records in Cloudflare before cutting over.** These are live as of
   2026-07-31 and must all be **DNS-only (grey cloud)** — proxying a mail record breaks mail:

   | Type    | Name           | Value                                              |
   | ------- | -------------- | -------------------------------------------------- |
   | `MX`    | `@`            | `mx.stackmail.com` (priority 10)                   |
   | `TXT`   | `@`            | `v=spf1 include:spf.stackmail.com a mx -all`       |
   | `TXT`   | `@`            | `brevo-code:0b583e4cc4029de3270ae0c4ba52f5d9`      |
   | `TXT`   | `_dmarc`       | `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com` |
   | `CNAME` | `mail`         | `mail.stackmail.com`                               |
   | `CNAME` | `smtp`         | `smtp.stackmail.com`                               |
   | `CNAME` | `imap`         | `imap.stackmail.com`                               |
   | `CNAME` | `autodiscover` | `autodiscover.stackmail.com`                       |

   Re-check the zone at the old host for anything added since — especially a DKIM selector, which
   varies per account and is easy to miss.

   Carry these over **as they are**, even though the mail section below replaces the `MX` with
   Cloudflare Email Routing later. That ordering is deliberate: mail keeps flowing to the existing
   mailbox straight through the nameserver change, and the switch to Email Routing happens only once
   the archive has been migrated and verified. One risky change at a time.

3. **Add the redirect records**, both **proxied (orange cloud)**:

   | Type | Name  | Value       |
   | ---- | ----- | ----------- |
   | `A`  | `@`   | `192.0.2.1` |
   | `A`  | `www` | `192.0.2.1` |

   `192.0.2.1` is a reserved documentation address that routes nowhere. Cloudflare terminates TLS and
   this Worker answers before anything tries to reach it, so no origin is ever needed.

4. **Change the nameservers at the registrar** from `ns1–4.stackdns.com` to the pair Cloudflare
   shows. Propagation is usually under an hour.
5. **Deploy the Worker** (from the repo root):

   ```bash
   npx wrangler deploy --config workers/redirect-legacy/wrangler.toml
   ```

6. **Verify before cancelling anything**:

   ```bash
   curl -sSI https://www.visitemaurice.com/en/sightseeing/north-tour/ | grep -i '^location'
   ```

   Expect `https://bellemaretours.com/activities/north-tour`. Send a test mail to
   `info@visitemaurice.com` and confirm it lands in `info@bellemaretours.com`.

7. **Only then** cancel the hosting — after the mail migration below has been verified, not before.

## Mail — migrate it, then forward forever

`info@visitemaurice.com` is a live, actively used mailbox on **StackMail**, the same provider as the
website (`mx.stackmail.com`, nameservers `stackdns.com`). Cancelling the hosting plan will most
likely take the mailbox with it. Note too that `webmail.visitemaurice.com` and
`autoconfig.visitemaurice.com` resolve to `185.151.30.159` — **the web server's own IP** — so webmail
access may be tied to the hosting account rather than to the mail service.

**bellemaretours.com is already on Google Workspace** (`aspmx.l.google.com`, SPF
`include:_spf.google.com`), so there is a real destination and no mail-only plan is needed. Two
separate jobs:

**1. Move the existing mail** into `info@bellemaretours.com`, while StackMail is still live —
the migration reads the old mailbox over IMAP, so it cannot run after cancellation.

- **Workspace Data Migration Service** (best): Admin console → Account → Data migration → generic
  IMAP, `imap.stackmail.com` port 993 SSL. Preserves folder structure and is re-runnable, so it can
  be run again at cutover to sweep up anything that arrived in between.
- **imapsync** for a scripted server-to-server copy, ideal for that final delta.
- Gmail's own "Import mail and contacts" is POP-based and flattens folders — only for a small, flat
  mailbox.

Export contacts from the old webmail before cancelling; they do not come across with the mail.

**2. Keep future mail arriving** with **Cloudflare Email Routing** on the zone added in step 1 of the
cutover. Replace the StackMail `MX` in the table above with Cloudflare's Email Routing MX, then route
`info@visitemaurice.com` → `info@bellemaretours.com` plus a catch-all. Free, and it means StackMail
can be cancelled outright — hosting **and** mail.

Its one limit: Email Routing **forwards inbound only**. Nobody can send _as_
`info@visitemaurice.com` afterwards, because there is no SMTP behind the domain any more. That suits
a brand consolidation; it is wrong if somebody still needs to reply from the old address, in which
case keep a real mailbox somewhere instead.

Marketing mail goes out through **Brevo** on the old domain (hence the `brevo-code` TXT and the DMARC
`rua`). Its SPF (`include:spf.stackmail.com`) goes stale the moment StackMail is gone — either move
campaigns onto bellemaretours.com to match the rebrand, or repoint that SPF at Brevo. Keep the
`brevo-code` TXT either way.

### Two gaps on the new domain, worth closing while you are in the DNS

Neither blocks this migration; both affect deliverability as mail consolidates onto the new brand.

- **No DMARC record on bellemaretours.com.** The old domain has one and the new one does not. Start
  at `v=DMARC1; p=none; rua=mailto:…` to collect reports before tightening.
- **Google Workspace DKIM is not switched on** (`google._domainkey.bellemaretours.com` does not
  resolve), so human mail from Gmail is authenticated by SPF alone. It is a few clicks in the
  Workspace admin console. Transactional mail is unaffected — Resend is correctly set up on the
  `send.` subdomain with its own DKIM and SPF.

## After cutover

- **Keep the domain registered. Indefinitely.** visitemaurice.com is registered at **GoDaddy** and
  expires **2027-05-18** — a separate account from the StackCP hosting, which is why cancelling the
  hosting cannot take the domain with it. Turn auto-renew on and push the expiry out several years.
  Once the site is gone, this registration is the single point of failure for the whole arrangement:
  if it lapses, every redirect dies, the mail forwarding dies, and the name goes on the open market.

  A domain is not a website. After cutover visitemaurice.com has nothing hosted anywhere and still
  does two jobs at Cloudflare's edge — 301s and mail forwarding. Only three things break that: the
  registration lapsing, the nameservers moving off Cloudflare, or the zone being deleted.

- **Optionally transfer the registration to Cloudflare Registrar** — recommended, but as the LAST
  step, never during the cutover. It puts the registration next to the zone, the Worker and the
  Email Routing rules instead of in a GoDaddy account nobody would otherwise log into again, and
  Cloudflare sells at the registry's cost with free WHOIS privacy. Best of all an inbound transfer
  must include a **1-year extension**, so it pushes the expiry from 2027-05-18 to 2028-05-18 by
  itself.

  Two constraints make the ordering matter. Cloudflare only accepts a transfer for a domain that is
  **already on its nameservers with an active zone**, so this can only follow step 4. And transfer
  approval mail goes to the **registrant contact** — if that is `info@visitemaurice.com` while the
  mailbox is mid-migration, the approval is missed and the transfer stalls. Settle mail first.

  At GoDaddy: unlock the domain (it currently carries the standard `client transfer prohibited`
  status) and copy the EPP/authorization code. **Do not edit the registrant contact details
  beforehand** — that can trigger a fresh ICANN 60-day transfer lock. Transfer takes up to 5 days and
  does not touch DNS: the nameservers stay put, so the redirects and mail forwarding keep running
  throughout.

- **Google Search Console** — verify visitemaurice.com, then run **Change of Address** to
  bellemaretours.com. Leave the old property in place; it is where the migration can be watched.
- **Google Business Profile** — the listed website is still visitemaurice.com. Change it to
  bellemaretours.com. This is the single highest-value item on the list.
- Update social profiles, WhatsApp Business, email signatures and directory listings.
- Leave this Worker running for at least a year. Google consolidates signals over months, not weeks.
