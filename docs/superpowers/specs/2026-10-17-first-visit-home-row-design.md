# First-visit homepage row — design

Date: 2026-10-17. Owner decisions recorded here were given in the session that produced this file.

## Goal

The row directly under the homepage hero shows the same six private day tours to everyone. Make it
show a first-time visitor tours they are likely to want, using only what we can know on a first visit:
whether they are browsing from Mauritius, which of our guide pages they have read, and what our past
guests actually booked.

Returning visitors are already served: "Continue planning your trip" (cart → viewed → wishlist) sits
above this row, and the catalogue rails have a "For you" tab. This design does not change either.

## Owner decisions

| Question                               | Answer                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Which signals                          | On the island vs abroad, plus guide pages read                               |
| Where it shows                         | The existing row under the hero changes; no new row, no page-height change   |
| How sure "tomorrow" must be            | Real seats: only tours with a free seat tomorrow                             |
| What visitors from abroad see          | "Most booked by our guests", from real confirmed bookings                    |
| Consent for remembering guides read    | Same as the recently-viewed list: stored without asking, listed on /cookies  |
| Guide reader who is also on the island | Guides first                                                                 |
| Shipping                               | Build now; push after the homepage SEO re-measure (~22 Oct, see SEO targets) |

## Facts established before design

- **Nationality barely changes what people book.** Of 258 confirmed bookings, only 28 record a
  traveller country; by phone dial code, UK (54), France (51) and Germany (21) all book the same top
  three categories (catamaran, speedboat, private tours) in slightly different orders. Nationality-based
  picks were rejected for this reason.
- **Many visitors are already on the island.** About 41% of search clicks come from Mauritius, and the
  median booking is made 3.8 days before the activity (see the December 2026 research).
- **Notice periods split the catalogue.** All 8 private day tours and most hikes accept a booking for
  tomorrow (`min_advance_days` ≤ 1); 18 of the 21 published catamaran, speedboat and private-cruise
  activities need 2–7 days. An on-island visitor shown a 3-day-notice cruise cannot book it before they leave.
- **Most booked, last 90 days (confirmed + completed):** Catamaran Île aux Cerfs 30, Airport transfer
  28, Catamaran 3 Northern Islands 20, South Tour 15, Blue Cruise 5 Islands 14, North Tour 14. No
  confirmed booking in that window belongs to a staff/admin/seo account, but test bookings have existed
  (they were among the expired ones), so the ranking excludes them anyway.
- **Guide pages already name their tours.** `src/lib/content/tour-links.ts` maps 69 attraction pages
  (`ATTRACTION_TOURS`) and most blog posts (`POST_TOURS`) to tours; posts without their own entry fall
  back to `DEFAULT_POST_TOURS`, which says nothing about the reader. The three topic pages
  (`/mauritius-catamaran-cruise`, `/dolphin-swim-mauritius`, `/ile-aux-cerfs-tours`) list tours via
  `featuredActivities()`.
- **Only tour pages record views today.** `<RecordView>` is on `activities/[slug]` alone, so a visitor
  who reads a guide and then opens the homepage gets nothing personal.
- **The homepage HTML is identical for everyone** (`/` is cached; Cloudflare ignores `Vary: Cookie`).
  Anything per-visitor is decided in the browser. `visitorLocality()` (Cloudflare `CF-IPCountry`)
  already exists and is exposed per-visitor, uncached, by `/api/planner/locality`.

## Behaviour

The row keeps its current tile design: square photo, title, "from €X" price, six tiles at most, a
tour without a photo is never shown. "See all" goes to `/activities`. Rules are checked in order and
the first that fits wins.

1. **Guides read** — heading "Picked from the guides you've read".
   - Tours recorded from the guides in `gytm:interest`, newest guide first, each guide's tours in the
     order its page shows them, duplicates removed.
   - Tours the visitor already sees in "Continue planning" (cart, viewed, wishlist) are left out.
   - If the visitor is on the island, tours in `freeTomorrow` move to the front (stable order otherwise).
   - Used only with at least 3 tours; otherwise fall through to rule 2.
2. **On the island** (`onIsland` true) — heading "Still free tomorrow".
   - Tours in `freeTomorrow`, in `mostBooked` order, then any remaining ones in catalogue order.
   - Used only with at least 3 tours; otherwise fall through to rule 3.
3. **Everyone else** (abroad, unknown location, crawlers) — heading "Most booked by our guests".
   - Tours in `mostBooked` order; if fewer than six qualify, top up in catalogue order.
   - This is what the server renders, so it is also what Google sees.

French headings (curly apostrophes, exact-match `messages.ts` keys): "Sélectionnés d’après les guides
que vous avez lus", "Encore des places demain", "Les plus réservés par nos clients".

## Architecture

### Database — `api_home_picks(p jsonb)`

One `security definer`, `stable` function, granted to `anon` and `authenticated`. The parameter MUST be
named `p` (PostgREST resolves by argument name; see the api\_\* RPC param landmine). Returns:

```json
{ "date": "2026-10-18", "mostBooked": ["slug", "..."], "freeTomorrow": ["slug", "..."] }
```

- `date` — tomorrow in `Indian/Mauritius`.
- `mostBooked` — published activities ranked by the number of distinct bookings with status
  `confirmed` or `completed` and `created_at` in the last 90 days, excluding bookings whose `user_id`
  belongs to a `staff`, `admin` or `seo` profile. Ties break in catalogue order (the order the public
  listing uses). At most 24 slugs. Only slugs leave the function, never counts.
- `freeTomorrow` — published activities, excluding `extra.inquiryOnly`, that have an `open`
  `session_occurrences` row starting tomorrow (Mauritius date) with `starts_at > now()`, that tomorrow
  is on or after today + `min_advance_days`, and `capacity - used_capacity(id) > 0`. These are the
  rules of the winning `api_list_availability` body; the implementation must re-read that body (last
  definition in filename order) and match it rather than copy this list.

Migration chores: mirror to the end of `supabase/catch-up.sql`, add a `backfill-migration-ledger.sql`
row, add `api_home_picks` to `ALLOWED` in `tests/db/rpc.ts`, run `npm run seed:gen && npm run setup:sql`.
No table, column or enum change, so `types.ts` is untouched.

### Server

- `src/lib/services/home-picks.ts` — `homePicks(ctx)` calls the RPC and parses it with a new Zod
  schema in `src/lib/validation/` (then `npm run openapi:write`).
- `GET /api/v1/activities/picks` — public, `runtime = 'edge'`, cached at the edge for 60 s
  (`s-maxage=60`, `stale-while-revalidate=120`). The answer is identical for every visitor.
  Registered in the OpenAPI registry.
- The homepage server component calls `homePicks()` alongside `searchActivities()` and renders rule 3.
  A failure there degrades to today's behaviour (catalogue order), never an error page.
- `/api/planner/locality` gains `onIsland: boolean` (true only when Cloudflare says Mauritius;
  `unknown` → false). It stays `private, no-store` and still never returns the country. In
  `next dev` only, `?as=island` / `?as=abroad` on the request overrides it so the variants can be
  checked locally.

### Browser

- `src/lib/recent/interest.ts`, a sibling of `views.ts`: `gytm:interest` in localStorage, a list of
  `{ topic, slugs }` newest first, at most 5 topics and 6 slugs each, deduped by `topic`. Malformed
  storage reads as empty. Fires a same-tab `gytm:interest` event on write, like `gytm:recent`.
- `<RecordInterest topic slugs>` (client, renders nothing), placed next to the tour cards on:
  attraction pages (`topic = attraction:<id>`), blog posts with their own `POST_TOURS` entry
  (`post:<slug>`; never for the `DEFAULT_POST_TOURS` fallback), and the three topic pages
  (`hub:<path>`). It records the slugs the page actually displays, after the published-only filter.
- `chooseHomeRow(input)` in `src/lib/catalogue/home-row.ts` — pure, no React, no storage. Input:
  activities, interest, Continue-planning slugs, `onIsland`, picks. Output: `{ variant, heading, tours }`
  with `variant` ∈ `guides | island | popular`. All three rules and thresholds live here.
- `HomeTours` splits into the server shell (renders rule 3) and a client part that, after hydration,
  fetches `/api/planner/locality` and `/api/v1/activities/picks` in parallel, calls `chooseHomeRow`,
  and swaps the tiles if the variant is not `popular`.
- The on-island answer is kept in `sessionStorage['gytm:on-island']` for the rest of the visit.
- A pre-paint inline script (a server component placed right after the row, as
  `ContinuePlanningReserve` is) marks the row when `gytm:interest` is non-empty or the session says
  on-island. A marked row shows placeholder tiles in the same footprint instead of the server tiles
  until the client decides, so a guide reader never sees the wrong tours flash.
- "Clear viewed" in "Continue planning" also clears `gytm:interest`.
- One `dataLayer.push({ event: 'home_row', home_row: variant })` when the row settles. It reaches GA4
  only for visitors who accepted analytics (Consent Mode). The owner adds a GA4 event tag for
  `home_row` in GTM-5F8BVWJL to see it.

### Failure handling

- Either fetch fails or takes longer than 1.5 s → keep the server row (unmark the placeholders if they
  were shown). Never leave placeholders on screen.
- `picks.date` is not tomorrow in Mauritius time (a cached answer straddling midnight) → treat
  `freeTomorrow` as empty, so rule 2 falls through to rule 3.
- An interest or picks slug no longer in the catalogue silently drops out.

### Privacy

- Location: the country is read from the request and reduced to a yes/no; nothing is stored about it
  except the session-only `gytm:on-island` flag.
- `gytm:interest` never leaves the browser. `/cookies` (EN + FR) gets a line in the list of browser
  storage: recently viewed tours and guides, kept in your browser to suggest tours on the homepage,
  never sent to us, cleared by "Clear viewed". The existing recently-viewed list is not on that page
  today; this line covers both. Not legal advice; the owner chose this over a consent switch.

## Testing

- Unit: `chooseHomeRow` — each rule, the 3-tour thresholds, top-up, dedupe, Continue-planning exclusion,
  photo-less tours skipped, island ordering inside the guide row, the midnight `date` check.
- Unit: `interest.ts` — cap, dedupe by topic, newest first, malformed storage, clear.
- Unit: `<RecordInterest>` is rendered for a post with its own pairing and not for the fallback.
- Unit: locality `onIsland` mapping (`MU` → true; other, `XX`, missing → false).
- DB (PGlite): `api_home_picks` ranking and tie-break; excluded statuses, staff/admin/seo bookings,
  bookings older than 90 days, unpublished activities; `freeTomorrow` with a full slot, a closed slot,
  a notice period of 2 days, an inquiry-only activity, and Mauritius midnight.
- Browser (preview pane): each variant via `?as=island` and seeded `gytm:interest`; no layout shift
  (row height constant); placeholders never stick when the fetch is blocked.
- The full gate, then CI's edge-bundle step. `node scripts/i18n-scan.mjs` for the new strings.

## Rollout

Build and run the gate now. Push to `main` after the ~22 Oct homepage re-measure so the measurement is
not muddied a second time (the homepage already changed on 10 Oct). The database function ships with
the same push (`supabase db push` in the release pipeline). Update the homepage section of the handbook
in the implementation commit.

## Out of scope

- Picks by nationality, and storing the visitor's country on bookings.
- A personalisation consent switch.
- Per-guide headings ("Because you read about Île aux Cerfs").
- Any server-side per-visitor rendering of the homepage.
