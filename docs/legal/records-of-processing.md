# Record of Processing Activities (RoPA)

> **DRAFT — for legal review; not filed.** This is an internal working draft prepared by the
> engineering team to describe, as accurately as possible, what the GetYourToursMauritius platform
> actually does with personal data. It is **not legal advice**. Retention periods, lawful-basis
> classifications and the DPO designation must be confirmed by the owner with a qualified adviser /
> accountant before this is relied upon or filed with the Data Protection Office.

## Controller identity

| Field | Value |
| --- | --- |
| Controller (legal entity) | Belle Mare Tours Ltd |
| Trading as / platform | GetYourToursMauritius (Belle Mare Tours) |
| Business Registration Number (BRN) | C09091906 |
| VAT registration number | 20529965 |
| Registered address | Royal Road, Belle Mare, Flacq, Mauritius |
| Data-protection contact | hello@getyourtoursmauritius.com |
| DPO / responsible person | **TODO — owner to designate** (name, role, contact). Mauritius DPA 2017 does not always mandate a DPO, but a named responsible person is recommended. |
| Supervisory authority | Data Protection Office, Mauritius |

## Applicable law

Mauritius Data Protection Act 2017 (primary); EU GDPR where it applies to visitors in the EEA.

## Processing activities

> Retention "years" are deliberately **not stated as fact**. Financial-record retention is shown as
> "the period required by Mauritius tax/accounting law — **TODO: owner to set the exact number with
> their accountant**." Lawful-basis labels are the engineering team's best read and need legal sign-off.

| # | Activity | Data categories | Purpose | Lawful basis | Recipients / processors | International transfers | Retention |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Account bookings** | Customer name, email, phone; activity, date, party size, options; pickup & drop-off location; custom itinerary; account link (`user_id`); booking status & references | Take, confirm and deliver a booking made by a signed-in user; send voucher and trip info; support, reschedules, refunds | **Contract** (to perform the booking); **Legal obligation** for the financial-record portion | Supabase (hosting/DB), Resend (email), Google (maps/location for pickup), the guide/skipper/driver running the activity | Yes — Supabase, Resend, Google process outside Mauritius/EU under SCCs | Active booking + the period required by Mauritius tax/accounting law for paid records, then personal details anonymised. **TODO: owner to set exact number.** |
| 2 | **Guest bookings** | Same as above minus the account link; no `user_id` | Same as account bookings, for customers who book without an account | **Contract**; **Legal obligation** (financial records) | Supabase, Resend, Google, activity operator | Yes — as above, under SCCs | As activity 1. **TODO: owner to set exact number.** |
| 3 | **Payments** | Booking reference, amount, currency, payment status, payment/charge reference. **No full card number** is received or stored. | Take and reconcile payment for a booking; issue invoice/receipt | **Contract**; **Legal obligation** (accounting/tax) | Peach Payments (card processing); Supabase (stores the confirmation, not card data) | Yes — Peach processes outside Mauritius/EU under SCCs | Financial records kept for the period required by Mauritius tax/accounting law, then anonymised. **TODO: owner to set exact number.** |
| 4 | **Transactional email** | Recipient email; rendered email content (booking ref, name, amount, currency) | Send booking confirmations, e-vouchers, receipts and refund notices | **Contract** (service messages tied to a booking) | Resend (email delivery); Supabase (notification queue) | Yes — Resend processes outside Mauritius/EU under SCCs | Queue rows retained for operational/audit purposes, then purged; recipient redacted on erasure. **TODO: owner to confirm purge window.** |
| 5 | **Enquiries / leads** | Name; contact (email or phone); the activity of interest | Reply to and follow up on an enquiry or contact request | **Legitimate interest** (responding to a request the person initiated); **Consent** where applicable | Supabase (storage); Resend if we reply by email | Yes — under SCCs | Deleted on request or when no longer useful; non-essential, no legal retention obligation. **TODO: owner to set a default cleanup window.** |
| 6 | **AI road-trip planner** | The messages the user types during a planning session (may contain place names, dates, party context) | Generate route/itinerary suggestions in real time | **Legitimate interest** / **Consent** (optional feature the user chooses to use) | Google (Generative AI / Gemini) processes the messages; conversation may be stored transiently in `chat_sessions` / `chat_messages` | Yes — Google processes outside Mauritius/EU under SCCs | Conversation is session-scoped, not used to build a marketing profile; deleted with the user's data on erasure. **TODO: owner to confirm chat retention window.** |

## Security & sub-processors

- Access to personal data is restricted by database row-level security (RLS): customers see only their
  own bookings; staff/admin roles are scoped via the `profiles.role` field.
- Passwords are handled by the authentication provider (Supabase Auth) and never stored in plain text.
- A full sub-processor list with DPA / transfer-mechanism status is tracked separately in
  [`processor-dpa-tracker.md`](./processor-dpa-tracker.md).

## Data-subject rights mechanism

- Account holders self-serve via the **Data & privacy** section of their account
  (`/account/privacy`): **Download my data** (JSON export of profile + booking history) and
  **Delete my account** (erases personal details; paid bookings anonymised, financial figures kept).
- Guests / written requests: emailed to the data-protection contact above; target response 30 days.
- Erasure is implemented by the `api_erase_user` database function, which **hard-deletes**
  never-paid bookings, enquiries, profile and chat data, and **anonymises** paid/terminal bookings
  (name → "(Deleted user)", email → redacted sentinel, phone & notes cleared) while preserving the
  financial figures.

## Open items for legal review

- [ ] Confirm the exact retention period for financial records under Mauritius tax/accounting law.
- [ ] Confirm lawful-basis classification per activity (esp. enquiries and the AI planner).
- [ ] Designate a DPO / responsible person and add their contact.
- [ ] Confirm whether a Data Protection Impact Assessment (DPIA) is required for the AI planner.
- [ ] Confirm cleanup windows for leads, transactional-email queue rows and planner chat history.
