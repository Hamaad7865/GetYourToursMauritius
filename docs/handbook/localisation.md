# French localisation

[← Handbook](../HANDBOOK.md)

A French visitor gets French UI chrome, catalogue copy, search, checkout, confirmation email, voucher
and invoice PDFs, landing FAQs, destination guides, attractions, transfer guides and blog. This page is
how the system works, where it deliberately stops, and the one thing it does **not** buy you: search
ranking.

---

## How it works

Translation is **gettext-style**: the English sentence typed inline in a component **is** the lookup
key. There is no separate ID scheme to keep in sync.

```ts
// src/lib/i18n/messages.ts
export const fr: Record<string, string> = {
  'Book now': 'Réserver',
  '{n} reviews': '{n} avis',
  // …
};
```

Three call sites, depending on where you are:

| Where                            | Call                                                         | Notes                                                                   |
| -------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Client component                 | `useT()` (`PreferencesProvider.tsx`)                         | Reads the language from React context, set client-side                  |
| Server component                 | `await getT()` (`src/lib/i18n/server.ts`)                    | Reads the `gytm_lang` cookie via `next/headers`                         |
| Outside React (email, PDF, cron) | `translate(locale, key, vars)` (`src/lib/i18n/translate.ts`) | Takes the locale explicitly — there is no request to read a cookie from |

All three end up calling the same table lookup. `{name}`-style placeholders are interpolated by simple
string substitution (`translate.ts`), not a template engine — keep vars alphanumeric-safe.

**A missing key falls back to the English source string, not an error.** This is deliberate — a
translation gap must never take a page down — but it is also why gaps are invisible at runtime. Nothing
renders wrong; a French visitor just silently sees an English sentence sitting in an otherwise-French
page. There is no error, no console warning, no visual break. The only way this gets caught is the guard
rail below.

---

## ⚠️ The apostrophe landmine

The codebase mixes straight `'` and curly `’` apostrophes — Word/Google-Docs-authored copy tends to
carry curly ones, hand-typed strings tend to be straight. `messages.ts` is keyed on the **exact**
source string, so:

```ts
t('Where to go in Mauritius: local guides to the island’s top areas'); // curly ’
```

does **not** match a key written with `island's` (straight `'`). This isn't a typo-checker catching it
either — both are valid strings, so it silently falls back to English. **This shipped as a real P1**:
French customers saw English on the checkout flow, because a component's string was retyped instead of
copied.

**The rule: copy strings into `messages.ts`, never retype them.** When you change a string passed to
`t(...)`, update the matching key in the same commit — see the [dependency
table](architecture.md#6-the-dependency-table--if-i-change-x-i-must-also-do-y).

---

## The guard rail

`tests/unit/i18n-coverage.test.ts` fails CI if any `t()` key used in the codebase has no French entry.
It's a static scan (`scripts/i18n-scan.mjs`), not a runtime check — it regexes every `.ts`/`.tsx` file
under `src/` and `app/` for `t('…')` / `t("…")` / ``t(`…`)`` literal calls and diffs the set against
`fr`'s keys.

```bash
node scripts/i18n-scan.mjs
# French keys: 1864   t() keys in use: 1531   missing: 0
```

Run it directly any time for a live report — the test just asserts `missing` is empty. If it fails, copy
the **exact** key from the failure output into `messages.ts` (see the apostrophe landmine above for why
retyping it is how this breaks again) rather than trusting your own keyboard.

**Known blind spot:** the scanner only matches a literal string argument. `t(SOME_VARIABLE)` — used
deliberately in a few hub pages to translate a long marketing paragraph stored in a `const DESCRIPTION`
— is invisible to it. That pattern still works at runtime (the coalesce/fallback rule applies exactly
the same way), it just isn't coverage-enforced, so double-check those by hand when you add one.

---

## Where the locale enters

```
cookie gytm_lang  →  getLocale() / useT()  →  ServiceContext.locale  →  api_* SQL functions
```

- The cookie is `gytm_lang` (`src/lib/i18n/config.ts`), set client-side by the language switcher,
  1-year `PREF_MAX_AGE`.
- Server components read it via `getLocale()` and build their DB context with
  `publicServiceContext(await getLocale())` (`src/lib/http/context.ts`) — this is the plumbing Task 7
  wired through the catalogue/search/activity call sites.
- Every locale-aware `api_*` function resolves French with a **per-field** `coalesce`, not a per-row
  switch:

  ```sql
  -- api_get_activity, supabase/migrations/20260901000100_localised_catalogue_rpcs.sql
  'title', coalesce(t.title, a.title),
  'summary', coalesce(t.summary, a.summary),
  'seoTitle', coalesce(t.seo_title, a.seo_title),
  ```

  **Per field, not per row** is the whole trick: an activity with a French title but no French
  description still renders a French title and an English description, instead of the SQL falling back
  to the entire English row because one column is empty. This is what makes partial translation safe to
  ship incrementally.

- Don't add `getLocale()` (or anything that reads cookies) to code reachable from `app/sitemap.ts`. See
  [below](#deliberately-english).

---

## Catalogue copy

Tour titles, summaries, descriptions, highlights, inclusions/exclusions and SEO title/description live
in `activity_translations` (locale = `'fr'`), left-joined and coalesced by `api_get_activity` /
`api_search_activities` above.

**Seeding:** `supabase/migrations/20260901000400_seed_fr_catalogue.sql` — idempotent,
machine-translated, every row lands with `source = 'machine'`.

It lives in `migrations/`, not as a standalone seed file, and that placement is deliberate. The
release pipeline (`.github/workflows/release.yml`) runs `supabase db push`, which applies
**migrations only** — nothing runs a loose `supabase/*.sql` seed. This content originally shipped as
`supabase/seed-fr-catalogue.sql` and therefore never reached production at all: the code was
deployed, the RPCs resolved French correctly, and the catalogue still rendered in English because
the rows did not exist. If you add catalogue data that must reach production, it goes in a
migration.

The upsert is guarded:

```sql
on conflict (activity_id, locale) do update set … where activity_translations.source = 'machine';
```

so **a row the owner has touched (`source = 'human'`) is never overwritten** by a redeploy or a re-run
of the seed. Machine rows update freely; human rows are permanent until a human changes them again.

**Review workflow:** `/admin/activities/[id]/edit` shows a "Machine draft — not yet reviewed" badge
(`isMachineDraft()`, `src/lib/admin/activity-write.ts`) on any French field still at `source = 'machine'`.
Editing **any** field or just clicking Save flips the row to `source = 'human'` — reviewing the copy IS
the review, there's no separate "approve" step. That flip is also what makes the seed's guard above
meaningful: once an owner has looked at a tour once, nothing can silently discard their edit.

---

## Content prose (destinations, attractions, transfers, blog)

The long-form guide pages (`src/lib/content/areas.ts`, `attractions.ts`, `transfers.ts`, `blog.ts`)
are English source + a generated `_*.fr.gen.ts` overlay, merged per field by `localiseContent()`
(`src/lib/content/localise.ts`) — the same coalesce-per-field idea as the SQL above, just in
TypeScript:

```ts
export function localiseContent<T extends object>(
  english: T,
  french: Partial<NoInfer<T>> | undefined,
  locale: Locale,
): T; // an absent/empty French field keeps the English text
```

**Every module's overlay type is an ALLOWLIST, not a blocklist**, and this is deliberate, not an
oversight to "get around to": these modules are full of real Mauritian place, beach and hotel names
(`AreaContent.beaches`, `.stayOptions`, `.nearbyAttractions`, `.name`; `TransferContent.hotelName`,
`.area`; `PlannerPlace.name`, `.region`). A blocklist would silently let through any such field nobody
thought to add — the very first miss invents a French beach name that doesn't exist. An allowlist fails
**closed**, and fails at **compile time**: adding a real-world field to a translation type is a type
error, not a production incident discovered by a guest googling a beach that doesn't exist.

| Module           | Translatable (allowlisted)                              | Left out — why                                                                                                                                                          |
| ---------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `areas.ts`       | `intro`, `highlights`, `gettingThere`, `goodFor`, `faq` | `name`, `beaches`, `stayOptions`, `nearbyAttractions` — real place/hotel names                                                                                          |
| `attractions.ts` | `blurb`, `body`, `bestTime`, `tips`                     | `name`, `region`, `lat`/`lng`, `closesAt` — real place data / facts                                                                                                     |
| `transfers.ts`   | `intro`, `included`, `faq`                              | `hotelName`, `area`, `distanceKmFromAirport`, `durationMinFromAirport`, `lat`/`lng`, `nearbyAttractions` — real hotel names or fare-relevant facts a customer relies on |
| `blog.ts`        | `title`, `excerpt`, `sections`, `faq`                   | `slug`, `readMins`, `heroImageUrl`, section `imageUrl` — identifiers/paths, not prose                                                                                   |

`metaTitle`/`metaDescription` are deliberately **not** in any of these allowlist types — SEO tag
copy is handled in the page's own `generateMetadata`, not the content module, and (Task 17) most of it
stays English: these are `<title>`/`<meta description>` strings, not visible page content, so an
English/French mismatch there is not a structured-data violation worth the extra maintenance surface
of hand-writing French SEO variants for ~30 blog posts and 45 transfer pages. Where a page's
`generateMetadata` already had a translated field to hand cheaply (an area's `intro`, an attraction's
`blurb`) it's wired in; where the meta text doesn't consume any translatable field at all (the transfer
pages' meta description is built entirely from fare facts and hardcoded English sentences), it's left
English rather than inventing new French boilerplate nobody asked for.

`openGraph.locale` (`fr_FR` vs `en_GB`) is set centrally in `overrideMetadata()`
(`src/lib/seo/override.ts`) for every page that routes metadata through it — which is nearly all of
them, since it already reads the visitor's locale for the `/admin/seo` override lookup.

---

## Outbound: what a booking remembers

`bookings.locale` (migration `20260901000300_booking_locale.sql`) records the language the guest was
using **at the moment they booked**. This matters because the confirmation email, the e-voucher PDF and
the invoice PDF are not rendered inline during the request — they're rendered later by
`notification_outbox` drain, running in the cron Worker, which has no cookie and no request to read a
locale from. Without a stored column, every async render would silently default to English regardless
of who booked. `bookings.locale` is the one place the visitor's language crosses from "cookie on a
browser" to "durable fact the system can act on days later."

---

## Deliberately English

Not translated, on purpose — don't file these as bugs:

| What                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legal pages (`/terms`, `/privacy`, `/refunds`, `/cookies`) | The text is legally binding. They show a French **notice** pointing at the English original, rather than a translated (and therefore not-binding-in-the-same-way) copy.                                                                                                                                                                                                                                                                                                                                                                |
| Scraped Google/TripAdvisor reviews                         | Real named people's words, quoted verbatim. Not our copy to translate. (Page chrome around the reviews — eyebrow, title, breadcrumb — is translated; the quotes themselves are not.)                                                                                                                                                                                                                                                                                                                                                   |
| The `/admin` area                                          | Staff-only, English-speaking operators. No `useT()`/`getT()` calls anywhere under it.                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `app/global-error.tsx`, `app/not-found.tsx`                | No provider is mounted at these boundaries (the root-layout error boundary and the router-level 404 can fire before/without `PreferencesProvider`) — `useT()` would throw, replacing a working error page with a worse one.                                                                                                                                                                                                                                                                                                            |
| Anything reachable from `app/sitemap.ts`                   | `getLocale()`/`getT()` read the `gytm_lang` cookie via `next/headers`, which forces Next into dynamic rendering. The sitemap must stay static. `blog-live.ts` and `catalogue/places.ts` take `locale` as an explicit parameter (default `'en'`) for exactly this reason — the sitemap omits the argument and keeps building statically; pages that DO know the visitor's locale pass it in themselves. Verify with `grep -n "getLocale" app/sitemap.ts src/lib/content/blog-live.ts src/lib/catalogue/places.ts` — must print nothing. |

---

## The SEO caveat — read this before promising anything

**Cookie-switched French earns zero French search traffic.** This matters because the project has an
active SEO goal — ranking for "belle mare + X" searches — and it's easy to assume translation work
moves that number. It doesn't, and here's why:

Google indexes **one version per URL**. `/activities/catamaran-cruise` is a single page as far as a
crawler is concerned — it has no way to know the language changes based on a cookie it doesn't carry
between visits, and Googlebot's crawl requests don't carry a `gytm_lang` cookie set by a previous visit
in a browser. So the URL gets indexed once, in whatever language it renders for a cookie-less request —
English, the default.

**Real French SEO needs separate `/fr/` routes** (or a subdomain/ccTLD), each with its own indexable
URL, plus `hreflang` tags telling Google which URL is the French counterpart of which English one. That
is a routing and infrastructure project of comparable size to everything documented on this page — not
a follow-on task, a separate one.

What today's system **does** buy: a better experience for a French-speaking visitor who lands on the
site some other way (a paid ad, a WhatsApp link, a direct booking from a French-speaking guest referred
by a hotel concierge) and a foundation (the translated strings, the coalesce plumbing, the allowlists)
that a future `/fr/` project would reuse rather than start from scratch. It does not, on its own, rank
this site for a single French search query.
