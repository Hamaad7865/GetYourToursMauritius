# Back office redesign: design and hand-off

Status: mock-ups published 14 Nov 2026. Phases 0 and 1 are built, committed and pushed as `1dd63efc` on
14 Nov 2026. Phase 2 (Today, Bookings, Calendar) was built the same day, reworked with the owner on
15 Nov 2026, and is uncommitted in the working tree (see each phase's result below). Phases 3 to 5
are not started.

## Where the mock-ups are

- Design canvas (owner's Claude account, private): https://claude.ai/artifact/2Sghd56wtQtbuM2M1Vbikj
- Source copies in this repo: `design-reference/backoffice-redesign/` (22 screens as `*.dc.html`, the
  shared navigation `Nav.dc.html`, the shared stylesheet `bo.css`, and `canvas.json`).

Each `*.dc.html` is plain HTML. Ignore the `<x-dc>` / `<helmet>` / `<script type="text/x-dc">` wrapper:
the markup inside `<div class="app">` is the screen, and every class is defined in `bo.css`. Read `bo.css`
first; it is the design system.

**All names, figures, refs and dates in the mock-ups are sample data.** Do not treat a number on a
mock-up as a requirement, and do not treat a control as proof that the data behind it exists (see
"Re-layout or new capability" below).

## Decisions the owner made

1. **Look:** evolve the Belle Mare brand (ink sidebar, teal, Plus Jakarta Sans), sharper and denser.
2. **Depth:** rethink each workflow, not a reskin. Data and money rules underneath stay the same.
3. **Devices:** computer-first. Keep the phone layout usable (the shell stacks; tables scroll in a box).

## Why quotes changed the most

Production data for the 165 real quotes since 8 Aug 2026 (totals over €5):

- Half of all quotes have one line (average 1.7). 143 of 165 are pay in full. "Pay per date" was never used.
- 209 lines were typed by hand, 58 came from the rental picker, only 11 from "Add tour".
- The 14-day validity was never changed. Only 40 quotes carry a covering note.
- 145 of 165 were paid; the typical quote is sent 3 minutes after it is started.
- 14 quotes are past `valid_until` and still read "Sent" (nothing ever sets `status = 'expired'`).

So a quote is mostly a payment link for a deal already agreed in chat. The current editor spreads that
over four panes with a separate Save before Send. The new editor is one page.

## Design language (`bo.css`)

| Token                     | Value                 | Use                                                 |
| ------------------------- | --------------------- | --------------------------------------------------- |
| `--ink`                   | `#0A2E36`             | sidebar, primary text                               |
| `--muted` / `--soft`      | `#51666B` / `#5F7378` | secondary text (both pass 4.5:1 on white)           |
| `--teal-d`                | `#0B5C63`             | primary buttons, links, active states (AA on white) |
| `--teal` / `--teal-t`     | `#0E8C92` / `#E6F4F3` | bars and fills only, never small text               |
| `--coral-d` / `--coral-t` | `#B23A20` / `#FCECE8` | problems, destructive actions                       |
| `--gold-d` / `--gold-t`   | `#855A05` / `#FBF2DC` | waiting, part paid, full                            |
| `--line` / `--bg`         | `#E1E7E9` / `#F3F5F6` | hairlines, page ground                              |
| violet (`--violet-*`)     | `#5B3FA8` / `#EEEAFB` | assistant (Gemini) actions only                     |

- One typeface: Plus Jakarta Sans. 13px UI text, 12px meta, 22px page titles, tabular numbers.
- Cards: white, 1px hairline, 12px radius, no shadow. Controls: 36px tall, 8px radius.
- Status is a small chip with a dot (`.st.ok|warn|bad|info|ai`), never colour alone.
- One primary (teal-dark) button per screen. The top-bar "New" button is neutral.
- Lists that have a detail use a split view (list left, detail right), not a covering drawer.

Build these once as shared pieces in `src/components/admin/ui.tsx` (or files beside it) before any
screen: `StatusChip`, `Tabs`, `Segmented`, `Kpi`, `DataTable`, `SplitView`, `ListRow`, `Switch`,
`Checklist`, `ProgressBar`, `SectionRail`. Existing `AdminHeading`, `Card`, `Field`, `BTN_*`, `INPUT_CLS`
are restyled in place so untouched screens pick up the new look.

## Shell and navigation

Grouped sidebar (`Nav.dc.html`), top bar with global search, a "New" menu, the bell and the assistant
toggle (`Shell.dc.html`). Routes and permissions do **not** change; only grouping and labels do.

| Group      | Label                  | Route                                            | Permission (unchanged)                    |
| ---------- | ---------------------- | ------------------------------------------------ | ----------------------------------------- |
|            | Today                  | `/admin`                                         | any back-office member                    |
| Operations | Bookings               | `/admin/bookings`                                | `section.bookings`                        |
| Operations | Calendar               | `/admin/calendar`                                | `section.calendar`                        |
| Operations | Quotes                 | `/admin/quotes`                                  | `section.quotes`                          |
| Operations | Enquiries              | `/admin/leads`                                   | `section.leads`                           |
| Catalogue  | Tours                  | `/admin/activities` (+ edit, availability, new)  | `section.tours`                           |
| Catalogue  | Categories and content | `/admin/categories` and `/admin/content` as tabs | `section.categories` / `section.content`  |
| Catalogue  | Pricing                | `/admin/vehicle-pricing`                         | `money.prices` or `money.currency`        |
| Catalogue  | Rental fleet           | `/admin/rental`                                  | `section.rental`                          |
| Catalogue  | Planner places         | `/admin/planner-places`                          | `section.places`                          |
| Money      | Reports                | `/admin/reports`                                 | `money.reports`                           |
| Money      | Documents              | `/admin/documents`                               | `section.documents`                       |
| Growth     | SEO                    | `/admin/seo`, with `/admin/redirects` as a tab   | `section.seo` / `section.redirects`       |
| Growth     | Blog                   | `/admin/blog`                                    | `section.blog`                            |
| Growth     | Reviews                | `/admin/reviews`                                 | `section.reviews`                         |
| Admin      | Team and roles         | `/admin/roles`                                   | owner                                     |
| Admin      | Settings               | `/admin/settings` (new route)                    | keep each card's current gate (see below) |

Where two routes become tabs of one screen, each tab stays its own route and its own permission, the way
Pricing already shows only the half a permission covers. A person with one of the two sees one tab.

## Screen by screen: re-layout or new capability

"Re-layout" means the data and actions exist today. "New" means code beyond layout is needed; build it
only as described, or leave it out and say so. Nothing here needs a migration as designed.

| Screen (mock-up)                          | Existing code                                                            | Re-layout                                                                                                      | New                                                                                                                                                                                                              |
| ----------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Today (`Main`)                            | `AdminDashboard.tsx`, `lib/admin/dashboard.ts`                           | KPIs, today's departures, needs-attention, revenue chart, recent bookings                                      | Tomorrow preview; "Needs you" rows with a direct action; the WhatsApp and ZilAi cards move to Settings                                                                                                           |
| Bookings (`Bookings`)                     | `AdminBookings.tsx`, `BookingFacts`, `BookingChangePanel`                | Filters, table, every drawer action                                                                            | Saved-view tabs with counts; detail as a side panel; WhatsApp and email quick links                                                                                                                              |
| Calendar (`Calendar`)                     | `AdminCalendar.tsx`, `calendar/*`                                        | Week grid, day sheet, change time, call off, move booking                                                      | "Print run sheet"; drag to move is optional, the Move button is enough                                                                                                                                           |
| Quotes worklist (`Quotes`)                | `AdminQuotes.tsx` (`QuoteList`)                                          | Search, open, duplicate                                                                                        | Grouping by what needs doing; "Expired" derived from `valid_until`; "Balance to collect" (needs the booking's `balance_due_minor` in `loadQuotes`); send again and send balance link from the row; WhatsApp send |
| Quote on one page (`QuoteEditor`)         | `AdminQuotes.tsx` (`QuoteEditor`), `quotes/*`                            | Every field, line kinds, per-line transfer, payment plan, preview, send, withdraw, duplicate, draft from email | One page; Send saves first; one "add an item" box suggesting past custom lines with their last price, catalogue tours and fleet vehicles; WhatsApp send; returning-guest hint                                    |
| Enquiries (`Leads`)                       | `AdminLeads.tsx`                                                         | List, status change, mailto                                                                                    | Split view; "Create quote" pre-filled (the assistant's `quoteHandoff` path already exists); history with this guest by email; "Draft a reply" is optional                                                        |
| Tours (`Tours`)                           | `AdminActivities.tsx`                                                    | Search, category filter, reorder, edit, availability, delete                                                   | From-price, options, bookable-dates health, sold in 30 days (extra queries); list or cards toggle                                                                                                                |
| Tour editor (`TourEditor`)                | `ActivityForm.tsx`, `activity/*`                                         | All ten sections and their fields                                                                              | Completeness dots on the rail; live "on the site" preview; "before it goes live" checklist                                                                                                                       |
| Availability (`Availability`)             | `AvailabilityEditor.tsx`                                                 | Runs-on weekdays, trips a day, guests a trip, per option                                                       | Month grid showing seats booked per day; single-day changes (call-off, time override) listed here                                                                                                                |
| Categories and content (`CatalogueSetup`) | `AdminCategories.tsx`, `AdminContentDefaults.tsx`                        | Both screens as two tabs                                                                                       | Tours-per-category count                                                                                                                                                                                         |
| Pricing (`Pricing`)                       | `AdminVehiclePricing.tsx`, `PaymentCurrencyCard.tsx`                     | Every fare book and the charge-currency card                                                                   | Fare-book side menu; unsaved-cell highlight; "Try a fare" (calls the existing `transportFareMinor`)                                                                                                              |
| Rental fleet (`Rental`)                   | `AdminRentalFleet.tsx`                                                   | Fleet list, form, upload, active flag, order                                                                   | KPI strip (quoted rentals come from `quote_items`); "what a guest sees" price check                                                                                                                              |
| Planner places (`Places`)                 | `AdminPlannerPlaces.tsx`                                                 | List, form, reorder                                                                                            | Region filter; pin status; map preview. The map must add no Google cost: use an inline outline or OpenStreetMap, never Mapbox                                                                                    |
| Reports (`Reports`)                       | `AdminReports.tsx`, `lib/admin/reports.ts`                               | Everything. Keep the "not tax advice" caveat                                                                   | None                                                                                                                                                                                                             |
| Documents (`Documents`)                   | `AdminDocuments.tsx`, `documents/*`                                      | List, editor, preview, issue, PDF, email, convert, void                                                        | Three-pane layout; "Copy lines from a booking" is optional                                                                                                                                                       |
| SEO (`Seo`, `SeoPages`)                   | `AdminSeoHealth`, `AdminSearchConsole`, `AdminSeoMeta`, `AdminRedirects` | All four as tabs of one screen                                                                                 | Clicks beside a page's title editor; redirect visit counts only if that data exists, otherwise drop the column                                                                                                   |
| Blog (`Blog`)                             | `AdminBlog.tsx`                                                          | List, basics, sections, FAQ, publish                                                                           | Three-pane layout; ready check; the Français toggle and "Translate" only if the blog stores French, otherwise leave out                                                                                          |
| Reviews (`Reviews`)                       | `AdminReviews.tsx`                                                       | Queue, approve, reject, Google feed                                                                            | Tabs; "Draft a reply" optional; request-sent and answered counts only if stored                                                                                                                                  |
| Team and roles (`Roles`)                  | `AdminRoles.tsx`                                                         | Same roles, members and permission keys                                                                        | Matrix presentation (roles as columns)                                                                                                                                                                           |
| Settings (`Settings`)                     | `WhatsAppNumberCard`, `ZilAiMaintenanceCard` (on the dashboard today)    | Those two cards, moved                                                                                         | System health card (reads `/api/v1/health?deep=true`, the maintenance cron's last run, and a 24-hour `error_logs` count); read-only identity from `SITE`                                                         |
| Search, bell, assistant (`Shell`)         | `AdminShell.tsx`, `AdminBell.tsx`, `assistant/*`                         | Bell list, assistant panel (keep the Gemini livery)                                                            | Ctrl K command palette across bookings, quotes, enquiries and tours; the "New" menu                                                                                                                              |

## What must not break

- **Money path.** No change to pricing, `api_book`, `create_booking`, `append_payment_event`, or the quote
  conversion and pay routes. The quote editor keeps every refusal in `quotes/state.ts` (`sendRefusal`,
  `formLineProblem`, `quoteInputFromForm`) and still sends the stored row: "Send saves first" means save,
  then send, in that order, with the send blocked if the save fails.
- **Quote links.** The raw token exists only in the send response. "Send again" and "WhatsApp" from the
  worklist mint a new link, which kills the old one. Say so in the confirm text, as the editor does today.
- **Permissions.** `nav.ts` stays the single list; `pageAllowedFor` must keep failing closed, and
  `tests/unit/admin-permissions.test.ts` must keep every page inside the nav. Never add an `seo` grant to
  a booking, payment, lead, profile or pricing table. `money.*` gates stay where they are.
- **Architecture rules** in `CLAUDE.md`: services import no `next`/`react`; new API routes declare
  `export const runtime = 'edge'`; a Zod schema change needs `npm run openapi:write`.
- **Import weight.** The quote editor must not statically import the Maps client
  (`tests/unit/admin-quotes-editor.test.ts` times out if it does); keep `next/dynamic` for `PickupMap`.
- **Accessibility.** WCAG 2.1 AA. Teal-dark for text and buttons, coral-dark for error text. Real
  buttons, links, labels. Motion respects `prefers-reduced-motion`.
- **Existing tests** for admin screens stay green; update a test only when the behaviour it pins is
  deliberately changed by this document.

## Build order and who builds it

One session at a time while files overlap. Each phase ends with the full gate green and stops for the
owner to look before the next begins. Nothing is pushed without the owner saying so (a push deploys).

| Phase | Scope                                                                                                        | Model  | Why                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------ | ------ | -------------------------------------------------------------- |
| 0     | Tokens, shared UI pieces, new shell and grouped nav. No screen logic changes.                                | Opus   | Every later phase stands on it; permission guard is delicate   |
| 1     | Quotes: worklist and one-page editor                                                                         | Opus   | Highest value, and it sits on the money path                   |
| 2     | Today, Bookings, Calendar                                                                                    | Opus   | Largest screens, most actions                                  |
| 3     | Enquiries, Tours list, Categories and content, Rental, Places, Reports, Documents, SEO, Blog, Reviews, Roles | Sonnet | Mostly re-layout with the shared pieces; one screen per commit |
| 4     | Tour editor, Availability, Pricing                                                                           | Opus   | Catalogue and fares: mistakes here change what guests pay      |
| 5     | Settings with system health, Ctrl K palette, "New" menu                                                      | Opus   | New capabilities                                               |

### Phase 0 result (built 14 Nov 2026, shipped in `1dd63efc`)

Gate green on the final code. No signed-in admin screen was looked at in a browser.

- **Colour names added** (`app/globals.css`, `tailwind.config.ts`): `ink-soft`, `ink-raised`, `line`,
  `line-soft`, `ground`, `coral-tint`, `gold-dark`, `gold-tint`, `blue-dark`, `blue-tint`,
  `violet-dark`, `violet-tint`. The mock-up's gold is the existing `gold-light`; its teal tint is the
  existing `teal-tint`.
- **Shared pieces** in `src/components/admin/ui.tsx`: `StatusChip` (`tone`), `Tabs` (`items`, `active`,
  `onSelect`; an item with `href` is a link), `Segmented`, `Kpi`, `DataTable` with `Th`, `Td`, `Tr`,
  `SplitView` (`list`, `detail`), `ListRow`, `Switch`, `Checklist`, `ProgressBar`, `SectionRail`, plus
  `Panel` (card with a header row and a flush body) and `buttonClass(variant, size)` with variants
  primary, ghost, quiet, danger, dark, ai. `fields.tsx`'s `inputClass` is now `INPUT_CLS`.
- **Shell:** grouped sidebar (`NAV_GROUPS`, `groupedNav`, `crumbFor` in `nav.ts`), breadcrumb top bar.
  Every route is still its own nav item; the tab merges and Settings are later phases.
- **Kept from before, on purpose:** the real logo; "New" still opens the new-tour form; the bell shows
  its unread count; the search still goes to Bookings; no Ctrl K hint.
- **Visible side effects on untouched screens:** unsized text in the main area is 13px medium; inputs
  are white; the owner's phone bottom bar reads Today, Bookings, Enquiries, Tours.
- **Known gap:** input borders use the light hairline (about 1.25:1 on white), under the 3:1 guideline
  for control edges. Switches and checkboxes were darkened to `#7D8F94` to pass it.
- The pieces that take a click handler must be rendered from client components.

**Browser walk, 14 Nov 2026 (owner signed in on `next dev`, sandbox database):** all 18 menu screens
and the quote editor open inside the new frame at 1440px with no sideways scroll; the phone layout has
the drawer (focus held, Esc closes), the bottom bar and 16px inputs. Found and fixed: the page headings
"Leads" and "Roles" now read "Enquiries" and "Team and roles" to match the menu. Still open:

- Local Today, Bookings, Calendar, Reports, the Pricing payment card and Team and roles show "Could
  not load" because the sandbox database is behind the code (`api_my_access` and `team_roles` missing,
  newer columns missing). The fix is `node scripts/sandbox/apply-catchup.mjs`, run by the owner. Those
  screens have therefore not been seen with data in the new look.
- Under about 940px of window height the sidebar list scrolls a little (its last item is below the fold).
- Several screens still carry their own bright-teal pills and buttons (Tours, SEO, the quote editor's
  payment toggle). They move to the shared pieces when each screen's phase is built.
- The assistant's own name for screens (`screenName` in `AssistantProvider.tsx`) still says "Leads" and
  "Dashboard".

### Phase 1 result (built 14 Nov 2026, shipped in `1dd63efc`)

Quotes: the worklist and the one-page editor. No migration, no SQL and no change to pricing,
conversion, the pay routes or the send route.

**Worklist** (`quotes/QuoteWorklist.tsx`, rules in `quotes/worklist.ts`)

- Groups, in this order: waiting for payment, balance to collect, drafts to finish, expired without
  paying, done. Search (ref, name, email, phone digits, accents ignored) filters every group. Four
  figures on top: waiting (count and value), balance (count and amount owed), expired, paid.
- "Expired" is worked out on screen only: a sent quote whose valid-until date has passed. Nothing
  writes `status = 'expired'`.
- "Balance to collect" reads each converted quote's booking (`deposit_minor`, `balance_due_minor`,
  `total_minor`) in a second read in `loadQuotes`, and files a quote there only when the booking is
  paid and `balanceIsOutstanding` says money is still owed. If that read fails, the row says "Payment
  unknown"; it is never filed as paid.
- Row actions: Send again, WhatsApp, Send balance link, Duplicate (expired rows and the Done table),
  Open. Each send asks first, and the question says that sending again makes a new link and the old one
  stops working (for the balance link: an earlier balance link stops working).
- The Done group is a table showing the latest 25, with "Show all".

**Editor** (`AdminQuotes.tsx`, lines in `quotes/QuoteLines.tsx`)

- One page: guest (name, phone, email, then language, valid-until and hotel room behind "Change
  details", opened by itself when the date has passed), what they're buying, notes, and on the right
  the summary, the guest's view and the history.
- One "Send by email" button. It saves, reads the stored quote back, checks `sendRefusal` on what was
  stored, then sends. A failed save sends nothing. When it cannot send, the reason is written above the
  button (`sendBlockReason`). "Save draft" stays as a second button.
- The payment plan is the shared `Segmented` (Pay in full, Deposit, Per date). Switching back from Pay
  in full restores the deposit that was set before. Per date lists each date's payment.
- "Add an item" is one box that suggests, in one list, lines typed before (at their last price),
  catalogue tours and fleet cars. A tour opens the existing tour picker on that tour and a car opens the
  rental picker on that car, so those lines are built by the same code as before.
- Returning-guest hint beside "Guest" when the email matches earlier quotes or paid bookings. It only
  counts; it never lists them.
- Kept: every line kind, the per-line transfer and pickup with the map loaded on demand, all payment
  plans, the email preview (now in a dialog from "Open full preview"), withdraw, reinstate, duplicate,
  the cross-check against the enquiry's figures, and "Draft from an enquiry" in its violet style.
- A converted quote is read-only on screen, as `saveQuote` already required.

**WhatsApp:** "email, then share the same new link". The send route is unchanged. After a send the
screen shows the new link with Copy and an "Open WhatsApp with the message ready" link (`wa.me`, message
in the quote's language). The link in the message is always the one the send just returned; nothing
stores or rebuilds it. With no phone, or a phone without a country code, the button is disabled and the
reason is shown (a number without a country code is never guessed). This settles open question 3
below for now: a `wa.me` link, no Business API.

**Left out, and why**

- No autosave: the send route emails the stored quote, and autosaving a sent quote would change what
  the guest's open link shows.
- No "Review all" or "re-open for 14 days" on expired quotes: Duplicate on the row does that job (a
  fresh draft with a new validity window).
- No "Paid on" date and no "paid in the last 30 days": `converted_at` is when the guest opened
  checkout, not when they paid, and no paid date is read today.
- No "Copy payment link" before sending: no link exists until a send creates one.
- No "Transfer only" button and no "from" price on tour suggestions: neither exists in the current
  editor.
- No "every item has a date" check, because a line without a date is allowed.

**Different from the mock-ups**

- The last worklist group is "Done" (paid, withdrawn or closed), not "Paid": withdrawn quotes and
  bookings that closed unpaid need a place too. The "Paid" figure on top still counts paid only.
- "Send balance link" on a row is a plain button, not a filled one, to keep one main button per screen.
- "Send on WhatsApp" in the editor reads "Send and share on WhatsApp": it emails first, then offers the
  WhatsApp link with the new quote link (see WhatsApp above).
- The row buttons ask through the browser's own confirm box, as the old quote screen did; the mock-ups
  show no confirm step.
- "Save draft" (or "Save without sending" on a sent quote) sits under the send buttons, as the task
  asked; the mock-up shows only the send buttons.

**Other changes**

- `Segmented` (`ui.tsx`) gained a `disabled` option.
- `TourPicker` and `RentalPicker` can open with a tour or car already chosen; their error text now
  uses coral-dark. So does the error in `EmailPreview.tsx`.
- `LinesPane.tsx` is deleted (replaced by `QuoteLines.tsx`). The rail helpers and the old status pills
  are gone from `state.ts`.
- One existing test was changed on purpose: "has a rail whose panes are unique" became "offers every
  payment plan from one control", because the rail no longer exists.
- New tests: `tests/unit/admin-quote-worklist.test.ts`, `tests/unit/admin-quote-one-page.test.ts`,
  and `tests/integration/admin-quotes-worklist.test.ts` (PGlite: booking balances, a deleted booking,
  line summaries, past lines, the guest lookup with `_` in an email, and a customer reads nothing).

**Verified**

- Gate: green on the final code (typecheck, lint, format, 4076 tests in 380 files with coverage at
  88.69% of statements, `next build`). `pages:build` was not run (it fails on Windows); the CI edge
  bundle step is still the real build check.
- Tests: 23 for the worklist rules, 22 for the editor's plan, send gate, suggestions and WhatsApp
  message, and 6 PGlite tests against real Postgres for the new reads. The existing quote tests pass,
  with the one deliberate change listed above.
- Browser, 14 Nov 2026 (`next dev` on port 3057, back office already signed in, sandbox database):
  - Worklist at 1440px and 375px: no sideways scroll, the search box is 16px on the phone, no console
    errors.
  - Editor: a new quote to `customer@sandbox.test` (QAC71668E7847, left in the sandbox as a sent
    quote). Send stayed off with the reason shown until the line had a price. At 375px every input is
    16px and nothing scrolls sideways; at 1440px nothing scrolls sideways. Only one filled main button
    on the page. The returning-guest hint showed for that address.
  - Send: it saved, then sent ("Emailed to customer@sandbox.test.", the dev mail stub). The new link
    appeared with Copy; the WhatsApp link points at `wa.me` with the guest's number, opens in a new tab,
    and its message holds exactly the link the send returned. The button changed to "Send again by
    email".
  - "Open full preview" opens a modal with the email in a sandboxed frame; Escape closes it and focus
    returns to the button.
  - Back on the worklist the quote sits under "Waiting for payment".
  - "Add an item": one list shows a line typed before (with its last price), catalogue tours, fleet
    cars and "add as new". Picking a tour opened the existing tour picker on that tour; picking a car
    opened the rental picker on that car. Both were cancelled, so nothing was added.
- Not verified in the browser:
  - The row buttons (Send again, WhatsApp, Send balance link, Duplicate). They ask through the
    browser's own confirm box, which the test browser cannot answer, so none was pressed. Their rules
    are covered by the unit tests; the confirm wording was checked in the code only.
  - "Balance to collect": the sandbox has no paid booking with money still owed. The PGlite test
    covers it.
  - Adding a line through a picker and saving it was not repeated in the browser; the pickers
    themselves did not change apart from opening on a chosen tour or car.
  - The map in the per-line transfer and pickup (still loaded on demand through `next/dynamic`, as
    before).

**Open for the owner**

- New quotes still default to a 10% deposit, while most past quotes were pay in full (143 of 165).
  Should a new quote start as Pay in full?
- WhatsApp is "email first, then share the same link". Sending on WhatsApp alone would need the send
  route to skip the email (a small change, no migration), if wanted.
- Follow-up (it existed before): if a new quote has been saved and is still open when the assistant
  hands over another enquiry, the drafter does not pick it up until the quote is closed.

### Phase 2 result (built 14 Nov 2026, reworked with the owner 15 Nov, uncommitted in the working tree)

Today (`/admin`), Bookings and Calendar, on phase 0's shared pieces. Same routes and the same
permissions as before, plus one new screen, Settings (see "Changed with the owner on 15 Nov"). No
migration, no SQL, no new API route, and no change to pricing, booking creation, payment settlement,
refunds, cancelling or rescheduling.

**One set of words for status** (`BookingFacts.tsx`)

- `statusPill` and `paymentPill` now give a label and a tone for the shared `StatusChip`. The Bookings
  list and detail, both tables on Today and the Calendar's party blocks all use them, so a booking
  reads the same on all three screens. "Part paid" comes only from `paymentView()`; the Calendar now
  reads `deposit_minor` (and `total_minor` on return legs) so it can use the same rule.
- The CSV's Payment column keeps exactly its old words (`paymentCsvLabel`).

**Today** (`AdminDashboard.tsx`; rules in `today/rules.ts`; `today/RunSheetCard.tsx`,
`today/NeedsYouCard.tsx`, `RevenueChart.tsx`)

- Heading: the day in Mauritius ("Saturday 14 November"), then "Good evening, Sheik. 4 departures
  today, 23 guests, and 4 things that need you.", built only from figures the viewer may see.
- Figures on top: Departures today (with guests and pickups), Taken in the last 7 days (with the change
  against the 7 days before, only when there is one), Awaiting payment (a count, with the euros only for
  `money.revenue`), Departures in the next 7 days, and Quotes waiting (only with `section.quotes`, from
  the quotes worklist's own rule). Who sees which card is still decided by `statsFor`.
- Today's run sheet, then tomorrow. Both are read with the Calendar's loader and counted by the
  Calendar's rule (paid guests only, unpaid shown as "+2 unpaid"). Each row: time ("Time TBC" when the
  tour has none), tour and option, guests, "4 of 12 booked" with a bar (from the capacity already
  loaded), pickups, and one chip (Called off, "1 awaiting payment", "Balance €135", or All paid). A row
  opens that departure on the Calendar's day sheet. "Open day sheet" and "Print" sit in the card's
  header.
- "Needs you" replaces "Needs attention" and the "Part paid" panel, with their rules unchanged: balances
  (`paymentView === 'part_paid'`, earliest trip first) and payments not made yet (the old Pending rule,
  now one function shared with the Bookings tab). Each row names the guest and the problem and offers
  one action: "Send reminder" where the booking has a per-date schedule (the existing reminder for its
  next date), "Send balance link" for a quote-born balance (the Quotes screen's sender, with the Quotes
  screen's question word for word), otherwise "Open". With `section.quotes` one row counts the quotes
  waiting and opens Quotes; with `section.leads` one row counts new enquiries and opens Enquiries. "See
  all" links open the matching Bookings tab.
- "Money in": the same figures as the old revenue chart, drawn as a clean line with the period before
  as a dashed line under it, and a read-out of both on hover, touch or the arrow keys. 7 days, 4 weeks
  or 12 months. A hidden table gives the same numbers to a screen reader.
- Latest bookings: the 6 newest, the reference opens it in Bookings.
- The WhatsApp number and the ZilAi notice moved to their own Settings screen on 15 Nov (below).
- Each read (bookings, day sheets, quotes, enquiries) loads on its own; if one fails, only its own part
  says "Could not load".

**Bookings** (`AdminBookings.tsx`; rules in `src/lib/admin/booking-views.ts`)

- Tabs with counts, counted from the whole list: All, Awaiting payment, Today, Next 7 days, Part paid,
  Completed, Cancelled. Today and Next 7 days go by the trip date in Mauritius time. The tab is in the
  address (`?view=`) and combines with the search and the status, tour, payment and date filters, which
  all stay. `?q=`, `?status=`, `?pay=`, `?date=` and `?open=<id>` work as before. The Awaiting payment
  count is the same number as Today's card (one function, and a test that says so).
- The order is said on screen ("Sorted by trip date, soonest first"). All and the status tabs open
  newest booking first; Today, Next 7 days and Part paid open soonest trip first. The column headers
  are buttons and say their order to a screen reader.
- The detail sits beside the table when the screen is at least 1100px wide, with its row highlighted,
  and slides over the list below that. Esc closes it (not while something is saving) and focus goes
  back to the row. Everything in it is kept: pickup and transfer facts, the items with every extra
  charge, "Balance still to collect", the payment schedule with "Send reminder now", payments with
  provider references and events, change of tour, the private note, mark completed, cancel, mark
  refunded, reset guest link and erase customer data, each with its confirmation word for word.
- New: WhatsApp and Email buttons for the guest. WhatsApp shows only when the phone has a country code;
  the email link only for a well-formed address. Neither carries a pre-written message or any link.

**Calendar** (`AdminCalendar.tsx`, `calendar/*`)

- Restyled, not rewritten: the period as a 22px title with a sentence under it ("19 departures and 96
  guests this week. 2 need attention."), Month and Week as the shared switch, the shared buttons, and
  the figures, type chips and "Only what needs attention" in the new colours. Every behaviour stays.
- "Print run sheet" on the day sheet (and "Print" on Today's run sheet): one day on A4, black on white,
  readable without colour. Per departure: time, tour and option, and each party with guests, pickup
  place and time, room, phone, child seats, extras, route, flights and notes. Quote lines, rentals and
  return legs are included; a called-off departure says so. Payment is printed only for someone with
  `money.revenue`. It uses the browser's own print; nothing is sent anywhere.
- `/admin/calendar?day=2026-11-14&line=…` opens that day, on that line (the links from Today).

**Changed with the owner on 15 Nov**

The owner looked at the first build and asked for changes. All of them are in this phase:

- Today's layout. The run sheet and Latest bookings stack on the left; Needs you and Money in stack on
  the right, each column its own height, so a short run sheet no longer leaves a blank area.
- Quiet days take one line, not an empty box (`quietDays` in `today/rules.ts`). Nothing today: one
  line. Nothing today or tomorrow: one sentence, and the next departures later this week stand in
  their place ("The next 3, and 2 more", with "Open calendar"), or nothing more when the week is empty.
  "Print" shows only when today has departures; the Calendar's "Print run sheet" likewise only on a
  day with something on it. Money in with nothing taken in the period (and nothing before) shows one
  line instead of an empty chart, with its period switch kept. Needs you with nothing to do shows one
  line with a tick.
- Today's look, after the owner asked for components from 21st.dev and obsidianui.dev. The figure
  cards follow ObsidianUI's analytics dashboard: a tinted icon, the figure rolling into place digit by
  digit, a change pill only where a real comparison exists (Taken, last 7 days, against the 7 days
  before), and a small trend line only where a real series exists (Taken: the 7 daily totals;
  Departures, next 7 days: one point per day, `departuresByDay`). A figure of 0 is set in grey.
  Cards and panels rise in one after another; with reduced motion nothing moves and the figures are
  simply there. The trend line is adapted from ObsidianUI (MIT; its notice is kept in
  `today/Sparkline.tsx`). The rolling figure (`today/RollingNumber.tsx`) and the entrance
  (`.bmt-rise` in `globals.css`) are written here with CSS, not copied.
- Nothing new was installed. ObsidianUI's components need the `motion` animation library and other
  packages, and any package lands in the edge bundle, which cannot be built on this machine. Nothing
  was taken from 21st.dev: its connector here is not signed in (it needs a fresh key from
  21st.dev/mcp), and each of its components carries its own author's licence.
- Latest bookings: the guest's initials, guest and tour first, then the reference (with where the
  booking came from), trip date, total, and payment and status as two chips in one column. The guest
  column takes whatever width is left, so the table never scrolls sideways. `GuestAvatar.tsx` is
  shared with Bookings (the same guest has the same colour on both).
- A new **Settings** screen (`/admin/settings`, in the Admin group of the sidebar) holds the WhatsApp
  number and the ZilAi notice, moved from the bottom of Today. Its menu entry has no permission of
  its own, so everyone who saw the two cards on Today sees it.
- The sidebar has more room between the logo and Today, and folds to a 68px rail of icons ("Hide
  menu"), each still named on hover and to a screen reader. The choice is remembered in this browser.
  Its foot holds Search, Hide menu, View site, Sign out and the signed-in person. The phone drawer is
  unchanged. Groups that open and close were tried and taken out again at the owner's request; the
  groups are plain labels as before.
- Bookings: the search and the four filters sit in one row on top of the table; each guest has their
  initials; payment and status are one column of two chips; Booked shows "via Web" (or the source)
  under the date. While a booking is open beside it, the table drops to four columns (guest with the
  reference, trip date with tour and guests, total, payment and status), so it fits without scrolling.
  Closing the detail puts focus back on that booking's reference even when the table has changed
  shape. The line under the title says "Nothing is waiting for payment." when nothing is.
- Two faults found in the browser once the sandbox had a departure: a run-sheet row's chip was drawn
  outside its row on a wide screen (every cell is now placed for both layouts), and on a phone the
  chip squeezed the tour name (it now sits under the name). A tab opened in the background showed its
  figures as 0 until looked at; a short timer now makes sure the real figure is there.
- `Panel` (phase 0, `ui.tsx`) gained an optional `style`, which Today uses for the order of the
  entrance. Nothing else in phase 0's pieces changed apart from the sidebar above (`AdminShell.tsx`).
- On a phone the figure cards' labels wrap onto a second line rather than being cut off; on a wide
  screen each stays on one line.
- The owner saw the finished Today on 15 Nov and confirmed the direction ("Yes, finish").
- "Not authorised" on reload, fixed at the owner's request. On every reload of a back-office screen
  the Owner saw "Not authorised" for about a quarter of a second (measured: exactly while the profile
  request was out). `AuthProvider` turns `loading` off as soon as the session is known, one request
  before the profile, which holds the role, arrives; `AdminGuard` judged the still-empty profile as
  "not an admin". `AuthProvider` now also says whether the signed-in person's profile is still
  being read (`profileLoading`, from `profilePending`, which goes by whose read last finished so a
  late answer for someone else cannot end it), and the gate shows "Loading…" until it is. Nothing
  else reads the new field, so the public site is unchanged. Tested in
  `tests/unit/admin-guard.test.ts` (the gate's five states and `profilePending`); after the fix,
  three reloads (Today, Bookings, Calendar) went straight from "Loading…" to the screen.

**Left out, and why**

- Invoice PDF in the Bookings detail: the invoice route reads the sign-in from the request header, so a
  plain link would be refused. It needs a small download step written for it.
- Today / Tomorrow / This week switch on Today: the run sheet already shows today and tomorrow, and the
  week is the Calendar's.
- "Card payment failed" rows in Needs you: nothing today says which failed payments were never retried,
  so the row could not be told apart from noise. Failed payments are in Bookings (payment filter
  "Failed").
- A "Nudge" per quote in Needs you: one row counts the waiting quotes and opens Quotes, where the
  per-quote sends are.
- "Load more" under the Bookings table: the list shows every booking, as before.
- Calendar: no Day view, no drag to move, no "All tours" filter (none exists today), no legend of
  coloured dots.

**Different from the mock-ups**

- The Bookings table keeps the Booked and Source columns, and Today's latest bookings keep Status.
- The Calendar keeps its figures row and its type chips, which the mock-up does not show.
- "Taken, last 7 days" rather than "Taken this week": the figure is the last 7 days.
- "Private note" is the note's label (it was "Internal note"); "Reset guest link" now comes before
  "Erase customer data".
- Confirmations are still the browser's own confirm box.

**Other changes**

- Departures today and in the next 7 days now use the Calendar's rule (one per departure, paid guests
  only). The old cards counted bookings, unpaid ones included, so these figures can read lower than
  before.
- On the Calendar a party reads "Part paid" where it read "Deposit paid", only while a balance is
  really owed, and "Failed" where it read "Payment failed". The balance line shows only when the party
  is part paid. Its WhatsApp button now needs a country code (it used to guess from 7 digits).
- The assistant now calls the screens "Today" and "Enquiries".
- `whatsappNumber` moved to `src/lib/admin/contact-links.ts` (still exported from `quotes/whatsapp.ts`),
  beside the email, phone and WhatsApp link helpers that Bookings and the Calendar share.
- The change-of-tour panel uses the shared buttons; its main button is teal-dark. The Calendar's time,
  move and call-off buttons, today's markers and grey text were brought to AA (bright teal and amber
  with white text failed). `PaymentSchedule.tsx`'s "next" chip and error text likewise.
- `useDock.ts` holds the width and top-bar hooks Bookings and the Calendar both use.
- `dashboard.ts` gained the "period before" buckets for the chart; nothing else in it changed.
- New tests: `tests/unit/admin-booking-views.test.ts`, `admin-contact-links.test.ts`,
  `admin-today-rules.test.ts` (with the quiet-day sentence, `quietDays` and `departuresByDay`),
  `admin-run-sheet.test.ts`, chip cases in `booking-facts.test.ts`, the period-before case in
  `admin-dashboard.test.ts`, and `tests/integration/admin-calendar-pay-view.test.ts` (PGlite: the
  Calendar's return-leg read gives "Part paid" for a deposit booking, and a customer reads nothing).
  `admin-permissions.test.ts` now expects the Settings entry in each menu and has a test that every
  back-office member gets it. No existing test was changed in meaning.

**Verified**

- On this machine, on 15 Nov after the last change (the sign-in fix included): typecheck, lint, format
  check and the full test suite with coverage (4,155 tests in 386 files) pass. `next build` passed on 14 Nov but was not run
  again after the 15 Nov changes, because the owner's dev server was running from this folder (a build
  would break it). CI's edge-bundle step has not run (nothing is pushed).
- In the browser on the sandbox, signed in as the sandbox Owner, 15 Nov:
  - Today at 1440px with real data (a departure tomorrow, a new booking awaiting payment): no sideways
    scroll; the Latest bookings table fits its card exactly; the chip sits in its row; the trend line
    shows on Departures, next 7 days; Money in and Needs you render. At 375px: no sideways scroll, the
    run-sheet row stacks with the tour name at full width, and the order is run sheet, Needs you,
    Money in, Latest bookings.
  - Bookings at 1440px: the filters sit in one row; opening a booking docks it and the four-column
    table fits; Esc closes it and focus returns to the reference. At 375px: no sideways scroll, inputs
    and selects are 16px, the detail is a modal dialog, Esc closes it and focus returns.
  - Calendar: `?day=2026-11-15` opens the docked day sheet; "Print run sheet" is hidden on 15 Nov
    (nothing on) and shown on 16 Nov (one departure). Week view: the title ("9–15 November 2026"),
    its sentence, the switch and the figures render. At 375px: no sideways scroll, no input under
    16px; tapping 16 Nov opens the day sheet as a full-screen modal dialog with "Print run sheet",
    and Esc closes it with focus back on that day.
  - Today at 375px after the last change: every figure card's label reads in full.
  - Settings shows both cards. The sidebar folds to the rail, stays folded after a reload, and
    unfolds.

**Not verified**

- The printed run sheet on paper, with or without departures.
- The trend line and change pill on "Taken, last 7 days" with real money: the sandbox has taken
  nothing, so that card shows its grey 0.
- The Calendar's Week view with departures in it (the sandbox week of 9–15 Nov is empty).
- No irreversible button was pressed anywhere.

**Open for the owner**

- Before pushing: stop the dev server and run `npm run build` once (or let CI's edge-bundle step be
  the judge), and print one day's run sheet.
- Settings is offered to every back-office member, as the two cards were on Today. For someone in a
  content role the database refuses the saves. Say if it should be hidden from them.
- The Calendar's attention flag says "Unpaid" where Today and Bookings say "Awaiting payment" (the
  flag predates this phase and was left as it was).
- If the profile read itself fails (a network hiccup), the profile stays empty and the gate still
  says "Not authorised", until a reload. It could say "Could not check your access" with a retry
  instead; left as it was.
- With a day open beside it, the Calendar's Week view scrolls sideways inside its own box and
  Sunday is out of sight until scrolled. That is how the week grid already worked (it keeps a 896px
  minimum width); this phase left it as it was.
- Invoice PDF in the Bookings detail needs a small download step (see "Left out").
- Whether to add rows for card payments that failed and were never retried, once something records
  that.

The gate, before calling any phase done:

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
```

Then sign in at `/admin` in the browser and walk the changed screens. The preview cannot sign in by
itself; ask the owner to sign in, or say plainly that the screen was not driven.

## Open questions for the owner

1. Which optional "New" items to build now and which to leave out (they are marked optional above).
2. Whether Categories/Standard content and SEO/Redirects should really merge, or stay separate items.
3. Whether "Send on WhatsApp" should open WhatsApp with the message ready (no API needed) or send through
   the WhatsApp Business API that the webhook already uses.
