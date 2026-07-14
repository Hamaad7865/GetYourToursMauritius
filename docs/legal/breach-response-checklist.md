# Personal Data Breach — Response Checklist

> **DRAFT — for legal review; not filed.** Internal operational checklist prepared by the engineering
> team. **Not legal advice.** Notification thresholds and timelines must be confirmed with a qualified
> adviser. Names/contacts below are placeholders for the owner to fill in.

## Identity

| Field                   | Value                                              |
| ----------------------- | -------------------------------------------------- |
| Controller              | Belle Mare Tours Ltd (BRN C09091906, VAT 20529965) |
| Platform                | Belle Mare Tours (Belle Mare Tours)                |
| Address                 | Royal Road, Belle Mare, Flacq, Mauritius           |
| Data-protection contact | hello@bellemaretours.com                           |
| Supervisory authority   | Data Protection Office, Mauritius                  |

## Roles (who does what — **TODO: owner to assign names/contacts**)

| Role                  | Responsibility                                                | Person   | Backup   |
| --------------------- | ------------------------------------------------------------- | -------- | -------- |
| Incident lead         | Owns the response, makes the notify/don't-notify call         | **TODO** | **TODO** |
| Technical lead        | Contains the breach, preserves evidence, restores service     | **TODO** | **TODO** |
| Comms / legal liaison | Drafts notifications, liaises with the Data Protection Office | **TODO** | **TODO** |

## The flow

### 1. Detect

- [ ] Record **what** was noticed, **when**, and **how** (alert, report, log, third-party notice).
- [ ] Open an incident record (date/time, reporter, initial description). Start a timeline — the clock
      may start at the moment of awareness.

### 2. Contain

- [ ] Stop the bleeding: revoke leaked keys/tokens, rotate Supabase / Resend / Peach / Google /
      Cloudflare credentials as relevant, disable a compromised account, take an endpoint offline.
- [ ] Preserve evidence **before** wiping anything — copy logs, note affected records.
- [ ] Confirm the breach is contained and not still ongoing.

### 3. Assess severity

- [ ] What data categories are involved? (names, emails, phones, pickup/drop-off locations, payment
      references — note: **no full card numbers** are stored here.)
- [ ] How many individuals are affected (estimate)?
- [ ] What is the likely harm? (identity theft, fraud, distress, physical safety from location data.)
- [ ] Is the data encrypted / anonymised / already public? (lowers risk.)
- [ ] Score it with the rubric below.

### 4. Notify

- [ ] **Data Protection Office (Mauritius):** notify where the breach is likely to result in a risk to
      individuals' rights and freedoms. **Target the GDPR 72-hour window from awareness** as the
      working deadline (confirm the exact Mauritius DPA 2017 requirement with legal). If you can't
      report fully in time, report what you know and follow up.
- [ ] **Affected individuals:** notify directly where the breach is likely to result in a **high risk**
      to them, in plain language — what happened, what data, what they should do, how to contact us.
- [ ] Use the contact channels above; keep a copy of every notification sent.

### 5. Remediate

- [ ] Fix the root cause (patch, config change, access revocation, process change).
- [ ] Verify the fix and confirm no related exposure remains.
- [ ] Consider offering affected users a password reset / heightened-vigilance guidance.

### 6. Document

- [ ] Complete the incident record: facts, effects, decisions, and remedial actions — **including a
      reasoned note when you decide NOT to notify**, and why.
- [ ] Keep this record on file (the supervisory authority can ask to see it).
- [ ] Run a short post-incident review: what failed, what to change, owner + due date.

## Severity rubric (simple)

| Level        | Indicators                                                                                                      | Typical action                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Low**      | Data was encrypted/anonymised, tiny scope, no realistic harm                                                    | Document; usually no external notification (record the reasoning).                   |
| **Medium**   | Limited personal data (e.g. names + emails), some risk of spam/phishing, contained quickly                      | Document; **assess** DPO notification; monitor.                                      |
| **High**     | Sensitive combinations (contact + location data, payment references), larger scope, real risk of fraud/distress | **Notify the Data Protection Office** (target 72h) **and the affected individuals**. |
| **Critical** | Large-scale exposure, ongoing compromise, or high risk to safety                                                | Immediate containment + notification; consider external incident-response support.   |

> When in doubt, escalate one level. The rubric is guidance, not a substitute for the incident lead's
> judgement and legal advice.
