# Full French localisation — design

**Date:** 2026-07-30
**Status:** approved (owner), ready for implementation planning

## The ask

> "When you switch to French, everything should be French."

Today a visitor who picks Français gets a partly translated site: the UI chrome is
largely French, but every tour title, summary and description stays English, as do
the destination guides, the blog, the confirmation email and the voucher PDF. The
most visible half of an activity page — the part describing the actual tour — never
switches.

## Where we are

The i18n foundation is sound and needs no redesign. It is a gettext-style system:
English source strings sit inline in components, `translate()` looks them up in a
French table keyed by the English string, and a missing key falls back to the English
source, so an untranslated string always renders as readable English rather than a raw
key. The locale lives in the `gytm_lang` cookie, which the server reads at SSR and the
client mirrors, so pages render in the right language on first paint with no flash.

Measured coverage at the time of writing:

- 1,188 keys in the French table, covering 978 distinct `t()` calls across 80 files.
- 31 `t()` keys are called but absent from the table, so they silently render English.
- ~366 user-visible English strings across 54 customer-facing files never pass
  through `t()` at all.
- `activity_translations` exists, holds French rows, and is returned by
  `api_get_activity` — but **no component reads it**. The pipeline is built and dead.
- `TourSummary` (cards, search, home rails, related tours, sitemap) carries no
  translation data whatsoever.
- Bookings do not record the guest's language, so outbound email and PDFs cannot know
  which language to render.

## Scope

In scope, confirmed with the owner:

1. The 31 missing UI keys, plus the 5 untranslated category labels.
2. The ~366 hardcoded strings in customer-facing components and pages.
3. Catalogue content from the database, including tour names.
4. Long-form SEO prose: destination guides, attractions, blog, transfer guides.
5. Outbound: confirmation email, voucher PDF, invoice PDF, SEO metadata.

Explicitly out of scope, each for a stated reason:

- **Legal pages** (terms, privacy, refunds) stay English, with a short French line
  saying the English text is the binding version. A mistranslated clause is still
  contractually binding, so translating them creates legal risk for no UX gain.
- **Customer reviews** (`_reviews.gen.ts`, `_review-pool.gen.ts`, ~3,300 lines) are
  real reviews by real named people, scraped from Google. Translating them and still
  attributing them by name would misrepresent what those people wrote. They stay in
  their original language.
- **The admin area** stays English. It is staff-only and the owner works in English.
- **French SEO routing** (`/fr/` URLs plus hreflang). See the caveat below.

## Caveat the owner has accepted

Cookie-switched French earns no French search traffic. Google indexes one version per
URL, and our language lives in a cookie, so `/activities/dolphin-swim` is only ever
indexed in English no matter how good the French translation is. This work makes the
site fully French **for visitors**; it contributes nothing to French rankings. Earning
those requires `/fr/` routes with hreflang annotations — a routing change of comparable
size to this whole project, scoped separately if wanted.

This matters because the project has an active SEO goal (ranking for "belle mare + X"),
and it would be reasonable to assume a French translation helps it. It does not.

## Architecture

### Decision: resolve the locale in SQL, not in components

The obvious approach is to let each component reach into a translations map:
`translations[locale]?.title ?? title`. We reject it for three reasons.

`TourSummary` — the payload behind cards, search results, home rails, related tours and
the sitemap — has no translations field at all. Adding one means every list response
ships both languages for every row, on the highest-traffic queries on the site.

It is roughly 30 call sites. Missing one produces a half-French page, which is the exact
defect being reported. Correctness would depend on never forgetting.

The existing `translations` jsonb only carries `title`, `summary` and `description`. The
table also holds `highlights`, `inclusions`, `exclusions`, `meeting_point`, `seo_title`
and `seo_description`, none of which that shape can reach.

Instead, the locale travels with the request into Postgres, and the RPCs return fields
that are already resolved:

```
coalesce(t.title, a.title) as title
```

The `coalesce` is **per field, not per row**. A half-translated activity then shows
French for the fields that have it and English for the rest — never a blank, never a
mixed-up record. This is the single most important detail in the design: it is what
makes partial translation safe, which in turn is what lets French content land
incrementally instead of in one big bang.

### The seam

`ServiceContext` is the dependency bundle every service function already receives as its
first argument. Adding `locale` there means the ~30 call sites change **not at all** —
they already pass `ctx`. Contexts are built in a handful of places; those read
`getLocale()` and populate the field. Tests pass a locale explicitly.

```
ServiceContext { db, payments, ai, admin?, now, locale }   // locale: 'en' | 'fr'
```

This keeps the service layer framework-agnostic, which is an existing constraint:
nothing in `src/lib/services` may import Next.js. `getLocale()` is called by the caller
that builds the context, not by the service.

### Data flow

```
gytm_lang cookie
  → getLocale()            (server components / route handlers)
  → ServiceContext.locale
  → api_get_activity(p.locale) / api_search_activities(p.locale)
  → LEFT JOIN activity_translations ON (activity_id, locale)
  → per-field coalesce
  → TourDetail / TourSummary, already in the right language
  → components render, unchanged
```

Components need no knowledge of the locale to display catalogue content. They keep
using `t()` for their own chrome.

## Component changes

### 1. UI strings

Add the 31 missing keys to `src/lib/i18n/messages.ts`. The bulk of them are the weather
call-off flow in `DisruptionBanner.tsx` — an entire user journey (trip cancelled, choose
a new date or take a refund) that is currently English-only for French guests. This is
the highest-severity gap in layer 1, because it is where an already-disappointed guest
makes a money decision.

Add the 5 missing category labels (`Catamaran cruises`, `Dolphin swims`,
`Sea walks & diving`, `Parasailing`, `Sightseeing tours`). These are Postgres enum
values used directly as display text, so they appear on every card and filter chip.
Because the enum set is small, closed and stable, a `t()` lookup is the right tool; they
do not need database translation rows.

Route the ~366 hardcoded strings through `t()` in client components and `getT()` in
server components.

### 2. Catalogue content

Schema: `activity_translations` gains a `source` column, `'machine' | 'human'`, default
`'human'`. Rows seeded from machine drafts are written as `'machine'`.

RPCs `api_get_activity` and `api_search_activities` accept a locale and left-join the
translations table, coalescing per field. `api_search_activities` is what finally gets
French onto cards, search results and home rails.

Admin activity editor gains French fields for all nine translatable columns. A field
whose row is `source = 'machine'` renders with a "machine draft — needs review" badge.
Editing a field, or using the explicit approve action, flips that row to `'human'` and
clears the badge. This gives the owner a visible worklist of unreviewed French copy
rather than a silent wall of text that may or may not have been checked.

Seed: machine-drafted French for the 32+ catalogue activities, written as `'machine'` so
every row arrives pre-flagged for review.

### 3. SEO prose

The content modules are typed objects mixing translatable prose (`intro`, `highlights`,
`gettingThere`, `faq[].q`, `faq[].a`) with data that must not be translated (`slug`,
`region`, proper nouns like beach and hotel names). Translating the whole object would
corrupt slugs and rename real places.

Pattern: a parallel `_areas.fr.gen.ts` keyed by the same slug, carrying **only** the
translatable fields, and a resolver in the existing wrapper module (`areas.ts` and
siblings) that merges French over English per field. Same per-field fallback rule as the
database path, and the same benefit: a partially translated guide degrades gracefully.

Applies to `_areas.gen.ts` (821 lines), `_additional-attractions.gen.ts` (395),
`_blog.gen.ts` (3,078) and `_transfers.gen.ts` (2,080). Excludes the review files, per
scope above.

These files are generated and are not admin-editable, so the machine-draft flag here is
a header comment in the generated French file rather than an admin badge. That boundary
is deliberate: the owner reviews catalogue copy in admin, and content prose in the repo.

### 4. Outbound

`bookings` gains a `locale` column, captured at checkout from the cookie. The
confirmation email, voucher PDF and invoice PDF then render in the language the guest
actually booked in — not the language whoever triggers the send happens to be using.
This also fixes the hardcoded `en-GB` date format at `voucher-pdf.ts:46`.

`generateMetadata` reads `getLocale()` and picks up the translated `seo_title` and
`seo_description` that layer 3 already resolves.

## Guard rail

A vitest asserting that every `t()` key used anywhere in `src/` and `app/` exists in the
French table. This is the mechanism that keeps the site French after this project ends.
Without it, the next feature adds English strings and coverage decays; with it, a
missing French string fails CI, which per the project's deploy setup also stops the
Cloudflare deploy.

The test is written first, and is expected to fail with 31 missing keys until layer 1
lands. That failure is the layer 1 acceptance criterion.

## Testing

- The key-coverage test above.
- Per-field coalesce: an activity with `title` translated and `description` not must
  render a French title and an English description, not a blank.
- Locale propagation: a context with `locale: 'fr'` returns French catalogue fields; the
  default returns English.
- Fallback: an activity with no French row at all renders entirely in English.
- Booking locale: a booking made in French produces a French voucher.

Existing suites must stay green, and the full suite is run rather than a filtered subset,
per the project's CI gate.

## Delivery order

Each phase is independently shippable and leaves the site in a working state.

1. **Guard rail + layer 1** — the coverage test, the 31 keys, the 5 category labels.
   Small, and immediately fixes the cancelled-trip flow.
2. **Layer 3 plumbing** — `ServiceContext.locale`, both RPCs, the `source` column, admin
   French fields. No new copy yet; the site behaves exactly as today because there is
   nothing to fall back from.
3. **Catalogue French copy** — the machine-drafted seed. This is the moment the site
   visibly becomes French for a French visitor.
4. **Layer 2** — the ~366 hardcoded strings.
5. **SEO prose** — the four content modules. Largest content volume; earns no ranking,
   so it goes last of the visible work.
6. **Outbound** — booking locale, email, PDFs, metadata.

Phases 2 and 3 are separated on purpose. Landing dead plumbing is safe and reviewable on
its own; landing plumbing and a large content seed together makes a bad diff to review
and a bad one to roll back.

## Project conventions this follows

- Migrations deploy automatically on push to main via the release pipeline, so no manual
  owner step is required. `catch-up.sql` is still kept in sync in the same commit, for
  drift recovery and the parity tests.
- Work happens on `main`, per the standing owner override. Never `git add -A`, since a
  parallel session may share the working tree.
- `docs/HANDBOOK.md` is updated in the same commit as the behaviour it documents.
