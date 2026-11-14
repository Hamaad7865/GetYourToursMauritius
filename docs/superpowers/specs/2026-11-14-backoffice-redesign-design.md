# Back office redesign: design and hand-off

Status: mock-ups published 14 Nov 2026. Phase 0 is built (uncommitted, see "Phase 0 result"). The owner
started phase 1 (quotes) the same day. Phases 2 to 5 are not started.

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

### Phase 0 result (built 14 Nov 2026, uncommitted in the working tree)

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

### Phase 1 result (built 14 Nov 2026, uncommitted in the working tree)

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
