# Sub-processor & DPA Tracker

> **DRAFT — for legal review; not filed.** Prepared by the engineering team to list the sub-processors
> the platform actually uses and what each one processes. **Not legal advice.** The "DPA signed?",
> "Transfer mechanism" and DPA-link columns are **TODO for the owner** to complete after confirming
> each provider's current data-processing agreement and verifying their transfer safeguards.

## Identity

| Field | Value |
| --- | --- |
| Controller | Belle Mare Tours Ltd (BRN C09091906, VAT 20529965) |
| Platform | GetYourToursMauritius (Belle Mare Tours) |
| Address | Royal Road, Belle Mare, Flacq, Mauritius |
| Data-protection contact | hello@getyourtoursmauritius.com |

## Sub-processors

Pre-filled: **what they process** and **typical data location** (best-effort, verify against the
provider's current docs and your account region). Left as **TODO**: whether a DPA is signed, the
transfer mechanism, and the link to the provider's DPA.

| Sub-processor | What they process | Typical data location | DPA signed? (y/n/date) | SCCs / transfer mechanism? | Link to their DPA |
| --- | --- | --- | --- | --- | --- |
| **Supabase** | Hosting + Postgres database: booking, account/profile, enquiry, payment-confirmation and chat data; authentication (passwords, never in plain text to us) | Depends on project region (commonly AWS regions, e.g. EU/US — **confirm your project's region**) | **TODO** | **TODO — confirm SCCs / appropriate safeguards** | **TODO — add link** |
| **Resend** | Transactional email delivery: recipient email address + rendered email content (booking ref, name, amount) | Primarily US-based infrastructure (**confirm**) | **TODO** | **TODO — confirm SCCs** | **TODO — add link** |
| **Peach Payments** | Card payment processing: booking reference, amount, currency, transaction id, settlement webhooks. **No full card number passes through our servers** | Payment-processing infrastructure (Mauritius/South Africa region — **confirm**) | **TODO** | **TODO — confirm SCCs / equivalent** | **TODO — add link** |
| **Google** | Maps + location search (user-typed place strings, map bounds) and the AI road-trip planner (Generative AI / Gemini — user planner messages) | Global Google infrastructure (multi-region — **confirm**) | **TODO** | **TODO — confirm SCCs** | **TODO — add link** |
| **Cloudflare** | Hosting + CDN / edge delivery: serves the site and API; processes request metadata (IP, headers) in transit | Global edge network (multi-region) | **TODO** | **TODO — confirm SCCs** | **TODO — add link** |

## Notes

- This list mirrors the providers named in the [privacy policy](../../app/(site)/privacy/page.tsx) and
  the [RoPA](./records-of-processing.md). Keep all three in sync when a provider is added or removed.
- "Typical data location" is indicative only — the authoritative location is the one configured on
  **our** account with each provider; verify before relying on it for a transfer assessment.
- For each provider, attach (or link) the signed DPA and note the transfer mechanism (e.g. standard
  contractual clauses, an adequacy decision, or the provider's equivalent framework).

## Open items for the owner

- [ ] Confirm and sign each provider's current Data Processing Agreement; record the date.
- [ ] Confirm the transfer mechanism for each (SCCs / adequacy / equivalent) and file the evidence.
- [ ] Confirm each provider's actual data-residency region for our account.
- [ ] Add the link to each provider's published DPA.
- [ ] Review at least annually, or whenever a sub-processor is added or changed.
