# WhatsApp setup runbook

Connecting the Meta WhatsApp Cloud API so that **the owner gets a WhatsApp message when a booking is
made**, and so that customer replies to the business number are not lost.

**Account details** (Meta app `1603156378190538`):

| Thing           | Value                                                 |
| --------------- | ----------------------------------------------------- |
| Business number | +230 5743 2386                                        |
| Phone Number ID | `1146005161940831`                                    |
| WABA            | "Belle Mare Tours Alert" — `2242300306547154`         |
| Callback URL    | `https://bellemaretours.com/api/v1/webhooks/whatsapp` |

> **Check these against the dashboard before pasting them anywhere.** The number was first added under a
> different WABA ("Belle Mare Tours", `1656059006527876`, Phone Number ID `1205529992644486`). The IDs
> above are the current ones. A stale Phone Number ID doesn't fail loudly — it sends alerts from the
> wrong identity or 404s the Graph call.

This number is a **new, dedicated API number**. It is separate from the wa.me number on the site, which
stays a normal phone-app WhatsApp. A number registered to the Cloud API stops working in the phone app —
that is why inbound messages to it are forwarded to Telegram (Phase 2).

---

## Already done (code side)

Shipped and green on `main` — nothing to build:

- `/api/v1/webhooks/whatsapp` — the callback endpoint Meta verifies against (commit `5ef6979`).
- Owner WhatsApp alert rows on booking-confirmed and refund-pending (commit `588c862`, migration
  `20260817000000`).

Everything below is **configuration**, done in the Meta / Cloudflare / Supabase dashboards.

---

## Phase 1 — Verify the webhook

> Meta reports one generic error, "The callback URL or verify token couldn't be validated", for _every_
> failure. Use the probe in step 4 to find out what actually went wrong before changing anything.

**1. Invent a verify token.** It is not issued by Meta — it is a password you make up, used once during
the handshake. Generate one:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

**2. Copy the app secret.** Meta app → **App settings → Basic → App secret → Show**. This is _not_ the
access token; it signs webhook deliveries so forged events can't reach the app.

**3. Set both in Cloudflare and redeploy.** Cloudflare dashboard → **Workers & Pages → the Pages project
→ Settings → Variables and Secrets** → **Production** → add as **Secret** type:

| Variable                        | Value                      |
| ------------------------------- | -------------------------- |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | the token from step 1      |
| `WHATSAPP_APP_SECRET`           | the app secret from step 2 |

Then **Deployments → latest → ⋯ → Retry deployment**, and wait for green.

> **Saving a variable does nothing until you redeploy.** Cloudflare Pages bakes environment variables in
> at build time. This is the single most common reason verification fails after the values "are set".

**4. Probe before clicking anything in Meta.** Open in a browser, substituting your token:

```
https://bellemaretours.com/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR-TOKEN&hub.challenge=12345
```

| Response                                                 | Meaning                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| `12345`                                                  | Correct. Proceed to step 5.                                         |
| `{"code":"not_configured"}`                              | Variable missing, or the redeploy hasn't landed.                    |
| `{"code":"forbidden","message":"Verify token mismatch"}` | Cloudflare and your token differ — trailing space or partial paste. |

**5. Save it in Meta.** Meta app → WhatsApp → Configuration (the "Step 2. Production setup" screen):
Callback URL = the URL above, Verify token = the same string, then **Verify and save**.

**6. Subscribe to the `messages` field** in the webhook fields list, so message events are actually
delivered rather than just the subscription existing.

---

## Phase 2 — Register the phone number

Click **Register** next to +230 5743 2386. You'll be asked to set a **six-digit two-step PIN** — record
it in the password manager; Meta asks for it again on re-registration and there is no self-serve reset.

> If that number is currently signed in to the WhatsApp app on a handset, delete the account in-app
> first (Settings → Account → Delete my account). One number cannot be on both the app and the Cloud API.

### "Registration failed. Please try again."

The dashboard button swallows Meta's actual error. **Call the register endpoint directly** — it returns
the real code and message, which turns this from guesswork into a two-minute fix:

Open a terminal (Win → "terminal") and paste this as a **single line** — form-encoded parameters, so
there is no nested-quote escaping to get wrong, and it behaves identically in PowerShell, CMD and bash:

```
curl.exe -X POST "https://graph.facebook.com/v20.0/1146005161940831/register" -d "messaging_product=whatsapp" -d "pin=YOUR_6_DIGIT_PIN" -d "access_token=YOUR_ACCESS_TOKEN"
```

Two Windows traps this avoids: `^` line-continuations are CMD-only and break in PowerShell, and `curl`
in PowerShell is an alias for `Invoke-WebRequest` — which discards the response body on a 4xx, i.e. the
only part worth reading. Hence `curl.exe` and one line. A temporary token from the dashboard's
"Step 1. Try it out" tab is fine here.

**GUI alternative:** the [Graph API Explorer](https://developers.facebook.com/tools/explorer/) does the
same thing without a terminal — pick the app, switch `GET` to `POST`, path `1146005161940831/register`,
add `messaging_product=whatsapp` and `pin=<six digits>`, Submit. It prints the full error JSON.

Causes, most likely first:

| Cause                                                                             | Fix                                                                                                                                             |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Number still active in the WhatsApp or WhatsApp Business **app**                  | Delete the account in-app (Settings → Account → Delete my account), wait ~5 minutes, retry.                                                     |
| Number still attached to the **previous WABA** (`1656059006527876`)               | A number lives in exactly one WABA. Remove it there (WhatsApp Manager → Phone numbers) first.                                                   |
| **Two-step PIN conflict** — the number had a PIN set from an earlier registration | Enter the _old_ PIN, or disable two-step verification before deleting the app account. A wrong PIN too many times triggers a multi-day lockout. |
| Number **verified but not yet confirmed** by SMS/voice code                       | Re-run the verification code step on the number before registering.                                                                             |
| Number **recently removed** from another WABA                                     | There is a cooldown. Wait and retry rather than hammering the button.                                                                           |
| Too many attempts                                                                 | Rate limited. Wait an hour.                                                                                                                     |

Note this is entirely between Meta and the phone number — the app, the webhook and the site play no part
in registration, so there is nothing to change in the codebase for any of these.

**Inbound messages.** Once registered, messages customers send to this number no longer appear on any
phone — they arrive only as webhook events. The app forwards each one to the owner's Telegram group, so
enquiries are still visible. Note Meta's banner on the setup screen: while the app is **unpublished**
only test webhooks are delivered, so **publish the app** when you want real inbound forwarding.

---

## Phase 3 — Owner booking alerts

**1. Run the database migration.** Supabase → SQL Editor → run `supabase/catch-up.sql`. It is
idempotent; re-running it is safe. This adds the WhatsApp rows to the booking-notification trigger.

**2. Create a permanent access token.** The token shown on the dashboard expires in 24 hours — a system
user token does not. business.facebook.com → **Business settings → Users → System users → Add**
(role: Admin) → **Assign assets**: add both the _app_ and the _WhatsApp account_ → **Generate new token**:

- App: the Belle Mare Tours app
- Expiry: **Never**
- Permissions: `whatsapp_business_messaging` and `whatsapp_business_management`

Copy it immediately; it is shown once.

**3. Create and submit a message template.** This is **required**, not optional. WhatsApp only delivers
business-initiated messages outside an open 24-hour conversation window if they use an approved
template, and a booking alert is always business-initiated.

WhatsApp Manager → **Message templates → Create template**:

| Field    | Value                                                          |
| -------- | -------------------------------------------------------------- |
| Category | **Utility** (not Marketing — cheaper, and appropriate here)    |
| Name     | `owner_booking_alert` (lowercase, digits and underscores only) |
| Language | English                                                        |
| Body     | `Belle Mare Tours: {{1}}`                                      |

Exactly **one** `{{1}}` parameter — the app fills it with the whole alert line (who booked what, date,
guests, total, reference). Meta asks for a sample value to review; any realistic booking sentence works.
Approval usually takes minutes to a few hours.

**4. Add a payment method.** WhatsApp Manager → Billing. Utility templates cost a fraction of a cent,
but sends fail once the free allowance is used if no card is on file.

**5. Set the remaining variables in Cloudflare** (same place as Phase 1, Production, Secret type):

| Variable                   | Value                                                    |
| -------------------------- | -------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`    | the system-user token from step 2                        |
| `WHATSAPP_PHONE_NUMBER_ID` | `1146005161940831` (re-read it from the dashboard)       |
| `OWNER_WHATSAPP_TO`        | owner's personal number, digits only, e.g. `23057729919` |
| `WHATSAPP_TEMPLATE_NAME`   | `owner_booking_alert`                                    |
| `WHATSAPP_TEMPLATE_LANG`   | `en`                                                     |

Then **redeploy** again.

> `OWNER_WHATSAPP_TO` must be a **different** number from the business number — a number cannot message
> itself. `WHATSAPP_TEMPLATE_LANG` must match the template's approved locale **exactly**: if it was
> approved as `en_US`, `en` is rejected.

---

## Phase 4 — Verify

Make a test booking through to payment. On confirmation the alert is enqueued and sent by the
notification drain, which the cron worker triggers — so allow about a minute, and confirm the cron
worker is running (it also needs `INTERNAL_TASK_SECRET` to match).

The owner's phone should receive: `Belle Mare Tours: <name> booked <tour> on <date> — N guests, €X (ref BMT-…)`.

Nothing arrives? Check the outbox — failures are recorded, never silently dropped:

```sql
select channel, status, attempts, last_error, created_at
from notification_outbox
where channel = 'whatsapp'
order by created_at desc
limit 10;
```

| `last_error` contains             | Fix                                                          |
| --------------------------------- | ------------------------------------------------------------ |
| `OWNER_WHATSAPP_TO`               | Variable unset, or set but not redeployed.                   |
| `(401)` / `(403)`                 | Access token wrong, expired, or missing the two permissions. |
| `template name does not exist`    | Name typo, or the template is not approved yet.              |
| `(132001)` / language             | `WHATSAPP_TEMPLATE_LANG` doesn't match the approved locale.  |
| `Param text cannot have new-line` | Should not occur — the provider flattens newlines already.   |

Rows retry automatically until attempts run out, so fixing the variable and redeploying can be enough to
let a stuck alert through on its own.

---

## Testing without a template

For a quick end-to-end check before template approval: leave `WHATSAPP_TEMPLATE_NAME` unset and message
the business number **from the owner's phone** first. That opens a 24-hour window in which plain-text
sends are allowed, and the provider falls back to plain text when no template is configured. Set the
template name before relying on it in production — the window closes after 24 hours of silence.
