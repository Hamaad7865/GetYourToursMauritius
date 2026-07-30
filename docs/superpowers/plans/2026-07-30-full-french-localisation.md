# Full French Localisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a visitor switches the site to French, every customer-facing string — UI chrome, tour names and descriptions, destination guides, confirmation emails and PDFs — renders in French.

**Architecture:** The locale rides on `ServiceContext` into the Postgres `api_*` functions, which left-join `activity_translations` and return fields already resolved with a **per-field** `coalesce(t.field, a.field)`. Components stay locale-unaware for catalogue content and keep using `t()` for their own chrome. A CI test asserts every `t()` key exists in the French table, so coverage cannot silently decay after this project ends.

**Tech Stack:** Next.js 15 App Router (server components), TypeScript, Supabase/Postgres, Zod, Vitest, PGlite (integration tests), Tailwind.

**Spec:** `docs/superpowers/specs/2026-07-30-full-french-localisation-design.md`

---

## Background an engineer new to this codebase needs

**The i18n system is gettext-style.** There are no message IDs. The English sentence _is_ the key:
`t('Book now')` looks up `'Book now'` in the `fr` table in `src/lib/i18n/messages.ts`. A missing key
returns the key itself, which is the English text — so an untranslated string renders as readable
English, never as a raw identifier. This is why the site currently looks "half translated" rather
than broken.

**Two ways to translate, depending on component type:**

- Client components (`'use client'`): `const t = useT()` from `@/components/site/PreferencesProvider`.
- Server components: `const t = await getT()` from `@/lib/i18n/server`.

**LANDMINE — apostrophes.** Keys must match the English source **byte for byte**. This codebase mixes
straight (`'`) and curly (`’`) apostrophes in source strings. `t("We couldn't load")` and
`t("We couldn’t load")` are different keys. A key that differs only by apostrophe style silently
falls back to English, which is exactly the bug class this project exists to fix. When adding a key,
copy the string from the source file — do not retype it. Task 1's test catches this automatically.

**Migrations deploy automatically.** Since 2026-07-22, `git push origin main` runs `supabase db push`.
No manual owner step.

**Adding a migration touches FOUR files, not one.** Miss any and CI goes red:

1. `supabase/migrations/<version>_<name>.sql` — the migration itself.
2. `supabase/catch-up.sql` — append the same statements. Backs drift recovery and the parity tests.
3. `supabase/backfill-migration-ledger.sql` — add a `('<version>', '<name>')` row.
   `tests/unit/migration-ledger.test.ts` asserts this file mirrors the migrations directory **1:1**,
   by version *and* name. This is the step people forget.
4. `supabase/setup.sql` — regenerate with `npm run setup:sql`, never hand-edit.

**Version numbers must sort AFTER every existing migration.** Check the current maximum first:

```bash
ls supabase/migrations/*.sql | sed 's#.*/##' | sort | tail -3
```

At the time of writing the maximum is `20260831000000_error_logs`, so this plan's migrations use
`202609010000xx`. If more migrations have landed since, pick versions after those instead — a
migration numbered below an already-applied one is at best skipped and at worst applied out of
order. The ledger test also requires a unique, well-formed 14-digit prefix.

**Git conventions:** work on `main` (standing owner override). **Never `git add -A`** — a parallel
session may share the working tree. Always `git add` explicit paths, as every commit step below does.

---

## File Structure

**Created:**

- `tests/unit/i18n-coverage.test.ts` — the guard rail; asserts every `t()` key exists in `fr`.
- `scripts/i18n-scan.mjs` — shared scanner used by the test and runnable by hand for progress.
- `supabase/migrations/20260901000000_activity_translation_source.sql` — `source` column.
- `supabase/migrations/20260901000100_localised_catalogue_rpcs.sql` — locale-aware RPCs.
- `supabase/migrations/20260901000200_booking_locale.sql` — `bookings.locale`.
- `supabase/seed-fr-catalogue.sql` — machine-drafted French for the catalogue.
- `src/lib/content/_areas.fr.gen.ts`, `_additional-attractions.fr.gen.ts`, `_blog.fr.gen.ts`,
  `_transfers.fr.gen.ts` — French prose, translatable fields only.
- `src/lib/content/localise.ts` — the generic per-field merge helper the four wrappers share.

**Modified:**

- `src/lib/i18n/messages.ts` — +36 keys (31 missing + 5 category labels).
- `src/lib/services/context.ts` — add `locale`.
- `src/lib/http/context.ts` — populate `locale` in all five constructors.
- `src/lib/services/activities.ts` — pass `ctx.locale` into both RPCs.
- `src/lib/admin/activity-write.ts`, `src/components/admin/ActivityForm.tsx` — French fields + badge.
- `src/lib/content/areas.ts`, `attractions.ts`, `blog.ts`, `transfers.ts` — call the merge helper.
- ~54 customer-facing `.tsx` files — route literals through `t()`.
- `src/lib/email/booking-confirmation.ts`, `src/lib/invoice/voucher-pdf.ts`, `pdf.ts` — take a locale.

**Deliberately NOT modified:** `app/(site)/{terms,privacy,refunds}/page.tsx` (legal text stays
English, see Task 24), `src/lib/content/_reviews.gen.ts` and `_review-pool.gen.ts` (real people's
words), everything under `src/components/admin/` except the activity form (staff-only, English).

---

# Phase 1 — Guard rail and UI keys

### Task 1: The i18n coverage test

This lands **first** and is **expected to fail**. Its failure list is the acceptance criterion for
Task 2, and afterwards it is the mechanism that keeps the site French forever.

**Files:**

- Create: `scripts/i18n-scan.mjs`
- Create: `tests/unit/i18n-coverage.test.ts`

- [ ] **Step 1: Write the scanner**

Create `scripts/i18n-scan.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/** Every .ts/.tsx file under src/ and app/. */
export function sourceFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/node_modules|\.next/.test(p)) walk(p);
      } else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'app'));
  return out;
}

/** Keys defined in the French table (top-level, two-space-indented properties). */
export function frenchKeys() {
  const src = fs.readFileSync(path.join(ROOT, 'src/lib/i18n/messages.ts'), 'utf8');
  const keys = new Set();
  const re = /^ {2}(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*)):/gm;
  for (const m of src.matchAll(re)) {
    keys.add((m[1] ?? m[2] ?? m[3]).replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
  return keys;
}

/** Literal keys passed to t(...), mapped to the files that use them. */
export function usedKeys() {
  const used = new Map();
  const re = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`$]*)`)/g;
  for (const f of sourceFiles()) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) {
      const key = (m[1] ?? m[2] ?? m[3])
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, '\n');
      if (!used.has(key)) used.set(key, new Set());
      used.get(key).add(rel);
    }
  }
  return used;
}

// Run directly for a progress report: `node scripts/i18n-scan.mjs`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  const fr = frenchKeys();
  const used = usedKeys();
  const missing = [...used.keys()].filter((k) => !fr.has(k));
  console.log(
    `French keys: ${fr.size}   t() keys in use: ${used.size}   missing: ${missing.length}`,
  );
  for (const k of missing) console.log(`  ${JSON.stringify(k)}  ← ${[...used.get(k)][0]}`);
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/unit/i18n-coverage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { frenchKeys, usedKeys } from '../../scripts/i18n-scan.mjs';

/**
 * The guard rail for "everything is French". Because a missing key falls back to the English source
 * string, an untranslated string renders as plausible English rather than an obvious error — so
 * nothing surfaces the gap at runtime. This test is the only thing that does.
 *
 * If this fails: add the printed key to the `fr` table in src/lib/i18n/messages.ts. Copy the key
 * from the failure output rather than retyping it — straight vs curly apostrophes are different
 * keys, and a mismatch silently falls back to English.
 */
describe('French translation coverage', () => {
  it('has a French translation for every t() key used in the codebase', () => {
    const fr = frenchKeys();
    const missing = [...usedKeys().entries()]
      .filter(([key]) => !fr.has(key))
      .map(([key, files]) => `${JSON.stringify(key)}  ← ${[...files][0]}`);

    expect(missing, `Missing French translations:\n${missing.join('\n')}`).toEqual([]);
  });

  it('scans a plausible number of files (guards against a broken scanner)', () => {
    // A regex or path change that silently matches nothing would make the test above vacuously
    // pass. Assert the scanner still finds the bulk of the table.
    expect(frenchKeys().size).toBeGreaterThan(1_000);
    expect(usedKeys().size).toBeGreaterThan(900);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx vitest run tests/unit/i18n-coverage.test.ts
```

Expected: FAIL. The first test lists **27** missing keys (25 of them from
`src/components/gyg/detail/DisruptionBanner.tsx`, plus one each in `Checkout.tsx` and
`TransferBookingWidget.tsx`). The second test PASSES.

Take the count from `node scripts/i18n-scan.mjs` rather than from this document — `messages.ts` is
being edited by a parallel session, so the exact number is a moving target. Do **not** tune the
regex to hit a target number.

If the second test fails, the scanner is broken — fix it before continuing, because a broken scanner
makes the guard rail worthless.

- [ ] **Step 4: Commit**

```bash
git add scripts/i18n-scan.mjs tests/unit/i18n-coverage.test.ts
git commit -m "test(i18n): fail CI when a t() key has no French translation

A missing key falls back to the English source string, so an untranslated
string renders as plausible English and nothing surfaces the gap at runtime.
Currently red with 31 missing keys.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Add the 31 missing keys and 5 category labels

**Files:**

- Modify: `src/lib/i18n/messages.ts`
- Test: `tests/unit/i18n-coverage.test.ts` (already written)

- [ ] **Step 1: Append the weather call-off flow keys**

These cover `DisruptionBanner.tsx` — the journey a guest sees when we cancel their trip for weather.
It is currently English-only, which means a French guest reads English at the exact moment they are
disappointed and choosing between a refund and a new date.

Append inside the `fr` object in `src/lib/i18n/messages.ts`, before the closing `};`:

```ts
  // Weather call-off / disruption flow (src/components/gyg/detail/DisruptionBanner.tsx).
  // NOTE: apostrophe style below matches the source strings exactly — do not normalise.
  'Your trip was called off — choose what happens next':
    'Votre sortie a été annulée — choisissez la suite',
  'Your trip on {date} has been called off': 'Votre sortie du {date} a été annulée',
  'Your trip has been called off': 'Votre sortie a été annulée',
  "We're sorry — we called it off because of {reason}, and we don't make that decision lightly.":
    'Nous sommes désolés — nous l’avons annulée en raison de {reason}, et nous ne prenons pas cette décision à la légère.',
  'What happens next is your choice, and both options are free.':
    'La suite vous appartient, et les deux options sont gratuites.',
  'the conditions': 'les conditions',
  'Move to another date': 'Reporter à une autre date',
  'Get a full refund': 'Obtenir un remboursement intégral',
  'Pick a new date': 'Choisir une nouvelle date',
  'Loading available dates…': 'Chargement des dates disponibles…',
  "We couldn't load the available dates.": 'Nous n’avons pas pu charger les dates disponibles.',
  'No dates with room for your whole party in the next few months.':
    'Aucune date ne peut accueillir tout votre groupe dans les prochains mois.',
  'Hi Belle Mare Tours! My trip {ref} was called off — can we find a new date?':
    'Bonjour Belle Mare Tours ! Ma sortie {ref} a été annulée — pouvons-nous trouver une nouvelle date ?',
  'Message us': 'Écrivez-nous',
  'and we’ll sort something out, or take the refund below.':
    'et nous trouverons une solution, ou prenez le remboursement ci-dessous.',
  'Moving…': 'Report en cours…',
  '{n} seats left': 'Plus que {n} places',
  'Show more dates ({n})': 'Afficher plus de dates ({n})',
  'I’d rather have a refund': 'Je préfère être remboursé',
  'Refund booking {ref} in full? Your money goes back to the card you paid with, usually within a few days.':
    'Rembourser intégralement la réservation {ref} ? Votre argent est renvoyé sur la carte utilisée, généralement sous quelques jours.',
  'Refunding…': 'Remboursement en cours…',
  'Yes, refund me in full': 'Oui, remboursez-moi intégralement',
  'Show me dates instead': 'Voir plutôt les dates',
  'Could not move your booking. Please try again.':
    'Impossible de déplacer votre réservation. Veuillez réessayer.',
  'Could not start your refund. Please try again.':
    'Impossible de lancer votre remboursement. Veuillez réessayer.',
```

- [ ] **Step 2: Append the remaining missing keys**

```ts
  // Checkout price verification (src/components/checkout/Checkout.tsx)
  'We could not verify the price of this booking. Please try again in a moment.':
    'Nous n’avons pas pu vérifier le prix de cette réservation. Veuillez réessayer dans un instant.',
  // Transfer widget (src/components/transfers/TransferBookingWidget.tsx)
  "That date isn't open yet — please try another day, or contact us to arrange it.":
    'Cette date n’est pas encore ouverte — essayez un autre jour ou contactez-nous pour l’organiser.',
```

> **DO NOT touch `app/(site)/about/page.tsx` or its keys.** An earlier draft of this plan listed 4
> About-page keys and a total of 31. A **parallel session owns that page** and is rewriting both it
> and `src/lib/i18n/messages.ts` right now (both show as modified in `git status`). Its `t()` calls
> have already changed, which is why the real count is **27**, not 31. Add only what
> `node scripts/i18n-scan.mjs` currently reports, and when staging, `git add` only the files you
> edited — never `git add -A`, or you will commit the other session's in-flight work.

- [ ] **Step 3: Append the category labels**

These are Postgres `activity_category` enum values used directly as display text, so they appear on
every activity card and every filter chip. The enum set is small, closed and stable, so a `t()`
lookup is correct here — they do not need database translation rows. `Île aux Cerfs` and
`Airport transfers` are already handled (the former is a proper noun that is already French).

```ts
  // activity_category enum values, rendered directly as card + filter-chip labels.
  'Catamaran cruises': 'Croisières en catamaran',
  'Dolphin swims': 'Nage avec les dauphins',
  'Sea walks & diving': 'Balades sous-marines et plongée',
  Parasailing: 'Parachute ascensionnel',
  'Sightseeing tours': 'Excursions touristiques',
```

- [ ] **Step 4: Verify the guard rail is now green**

```bash
npx vitest run tests/unit/i18n-coverage.test.ts
```

Expected: PASS, both tests.

If any key still reports missing, it is almost certainly an apostrophe mismatch. Copy the key
verbatim from the test output rather than retyping it.

- [ ] **Step 5: Confirm the category labels actually reach the UI**

The enum value must be passed through `t()` at the render site, not just present in the table. Check:

```bash
grep -rn "category" src/components/catalogue/CategoryChips.tsx src/components/catalogue/ActivityCard.tsx
```

If either renders `activity.category` or `chip.label` raw, wrap it: `{t(activity.category)}`.
`t()` returns its argument unchanged for an unknown key, so this is safe for any category added later.

- [ ] **Step 6: Run the full suite and commit**

```bash
npm test
```

Expected: PASS.

```bash
git add src/lib/i18n/messages.ts src/components/catalogue/CategoryChips.tsx src/components/catalogue/ActivityCard.tsx
git commit -m "feat(i18n): translate the weather call-off flow and category labels

Adds the 31 keys that were called but absent from the fr table — most of
them the entire cancel/reschedule/refund journey, which a French guest was
reading in English at the point of choosing between a refund and a new date.
Also translates the 5 activity_category enum values rendered as card and
chip labels. Coverage test is now green.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 2 — Catalogue plumbing (no new copy)

This phase makes the site capable of serving French catalogue content and changes **no visible
behaviour**, because there is no French content flowing yet. That is deliberate: it keeps the diff
reviewable and independently revertable, separate from the large content seed in Phase 3.

### Task 3: Add `source` to `activity_translations`

**Files:**

- Create: `supabase/migrations/20260901000000_activity_translation_source.sql`
- Modify: `supabase/catch-up.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Distinguishes machine-drafted French from owner-reviewed French, so the admin activity editor can
-- show an unreviewed worklist instead of a silent wall of text that may or may not have been checked.
-- Default 'human': the rows that already exist were hand-written in the seed.
alter table activity_translations
  add column if not exists source text not null default 'human'
  check (source in ('machine', 'human'));

comment on column activity_translations.source is
  'human = written or approved by staff; machine = drafted automatically, awaiting review in /admin.';
```

- [ ] **Step 2: Append the same statements to `supabase/catch-up.sql`**

Open `supabase/catch-up.sql` and append the exact SQL above at the end. This file is what recovers a
drifted database and what the parity tests compare against; a migration missing from it fails those
tests.

- [ ] **Step 2b: Add the ledger row**

In `supabase/backfill-migration-ledger.sql`, add a row matching the existing format:

```sql
  ('20260901000000', 'activity_translation_source'),
```

The name is the filename with the version prefix and `.sql` stripped — it must match **exactly**.
`tests/unit/migration-ledger.test.ts` compares this file to the migrations directory 1:1 and fails
on any mismatch. Tasks 5 and 15 add migrations too, and each needs its own row here.

- [ ] **Step 3: Regenerate the consolidated setup file and types**

```bash
npm run setup:sql
```

Expected: `supabase/setup.sql` regenerates with the new column, exit 0.

- [ ] **Step 4: Verify the parity test passes**

```bash
npx vitest run tests/integration
```

Expected: PASS. If a parity test fails complaining about a schema difference, `catch-up.sql` and the
migration have drifted apart — re-check Step 2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260901000000_activity_translation_source.sql supabase/catch-up.sql supabase/setup.sql
git commit -m "feat(db): flag machine-drafted activity translations

Adds activity_translations.source so the admin editor can surface French copy
that has not been reviewed yet. Defaults to 'human' because existing rows were
hand-written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Carry the locale on `ServiceContext`

**Files:**

- Modify: `src/lib/services/context.ts`
- Modify: `src/lib/http/context.ts`
- Test: `tests/unit/service-context-locale.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/service-context-locale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localeFromCookieHeader } from '@/lib/http/context';

/**
 * API routes must resolve the guest's language from the request itself. Reading it via next/headers
 * `cookies()` instead would force dynamic rendering on routes that are deliberately static (notably
 * app/sitemap.ts), so the locale is parsed from the Cookie header here.
 */
describe('localeFromCookieHeader', () => {
  it('reads the language cookie', () => {
    expect(localeFromCookieHeader('gytm_lang=fr')).toBe('fr');
  });

  it('finds the cookie among others, in any position', () => {
    expect(localeFromCookieHeader('gytm_ccy=USD; gytm_lang=fr; other=1')).toBe('fr');
    expect(localeFromCookieHeader('gytm_lang=fr; gytm_ccy=USD')).toBe('fr');
  });

  it('defaults to English when absent, empty, or not a supported locale', () => {
    expect(localeFromCookieHeader(null)).toBe('en');
    expect(localeFromCookieHeader('')).toBe('en');
    expect(localeFromCookieHeader('gytm_ccy=USD')).toBe('en');
    expect(localeFromCookieHeader('gytm_lang=de')).toBe('en');
  });

  it('does not match a cookie whose name merely ends with the cookie name', () => {
    expect(localeFromCookieHeader('x_gytm_lang=fr')).toBe('en');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/unit/service-context-locale.test.ts
```

Expected: FAIL — `localeFromCookieHeader` is not exported.

- [ ] **Step 3: Add `locale` to the ServiceContext interface**

In `src/lib/services/context.ts`, add the import and the field. Note this file must not import
Next.js — importing the `Locale` type from `@/lib/i18n/config` is fine, as that module is
framework-agnostic.

```ts
import type { Locale } from '@/lib/i18n/config';
```

Add to the `ServiceContext` interface, after `now`:

```ts
/**
 * The visitor's language. Travels into the `api_*` catalogue functions so Postgres returns
 * already-resolved text (per-field `coalesce(translation, english)`), rather than each of the ~30
 * call sites reaching into a translations map and one of them eventually forgetting.
 */
locale: Locale;
```

- [ ] **Step 4: Populate it in the constructors**

In `src/lib/http/context.ts`, add the imports:

```ts
import { DEFAULT_LOCALE, LANG_COOKIE, isLocale, type Locale } from '@/lib/i18n/config';
```

Add the exported parser:

```ts
/**
 * The visitor's locale from a raw Cookie header. Used instead of next/headers `cookies()` because
 * `cookies()` opts a route into dynamic rendering, which would be wrong for app/sitemap.ts.
 */
export function localeFromCookieHeader(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === LANG_COOKIE) {
      const value = rest.join('=');
      return isLocale(value) ? value : DEFAULT_LOCALE;
    }
  }
  return DEFAULT_LOCALE;
}
```

Change `makeContext` to accept a locale:

```ts
function makeContext(
  db: DbRpc,
  admin?: SupabaseClient<Database>,
  locale: Locale = DEFAULT_LOCALE,
): ServiceContext {
  let payments: PaymentProvider | null = null;
  return {
    db,
    get payments(): PaymentProvider {
      payments ??= getPaymentProvider();
      return payments;
    },
    ai: getAiProvider(),
    ...(admin ? { admin } : {}),
    now: () => new Date(),
    locale,
  };
}
```

Update the two constructors that serve visitors. Leave `userServiceContext`,
`serviceRoleRpcContext` and `serviceRoleServiceContext` defaulting to English — they back internal
workers and mutations, not localised reads.

```ts
export function buildServiceContext(req: Request): ServiceContext {
  return makeContext(
    selectDb(getBearerToken(req)),
    undefined,
    localeFromCookieHeader(req.headers.get('cookie')),
  );
}
```

`buildServiceContext` reads the locale off the request, so all 33 API-route call sites are unchanged.

```ts
/**
 * Anonymous context for public server components (RLS shows published only). Pass the locale from
 * `await getLocale()` at the call site — deliberately explicit rather than reading cookies() in
 * here, so a caller like app/sitemap.ts is not silently forced into dynamic rendering.
 */
export function publicServiceContext(locale: Locale = DEFAULT_LOCALE): ServiceContext {
  return makeContext(selectDb(null), undefined, locale);
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/unit/service-context-locale.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: exit 0. `publicServiceContext()` keeps its no-argument form via the default, so no existing
call site breaks yet.

- [ ] **Step 7: Commit**

```bash
git add src/lib/services/context.ts src/lib/http/context.ts tests/unit/service-context-locale.test.ts
git commit -m "feat(i18n): carry the visitor locale on ServiceContext

The seam every service call already passes through, so localising catalogue
reads needs no changes at the ~30 call sites. API routes parse the locale from
the request Cookie header rather than next/headers cookies(), which would force
dynamic rendering on deliberately-static routes like sitemap.ts.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Make `api_get_activity` locale-aware

**Files:**

- Create: `supabase/migrations/20260901000100_localised_catalogue_rpcs.sql`
- Modify: `supabase/catch-up.sql`
- Test: `tests/integration/localised-catalogue.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/integration/localised-catalogue.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

async function rpc<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface Detail {
  slug: string;
  title: string;
  summary: string | null;
  description: string | null;
}

/**
 * The per-field coalesce is the load-bearing detail of this whole feature: it is what makes partial
 * translation safe, which in turn is what lets French copy land incrementally instead of in one big
 * bang. A row-level fallback would blank every untranslated field on a half-translated activity.
 */
describe('locale-aware catalogue RPCs', () => {
  let db: TestDb;
  let slug: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));

    const { rows } = await db.pg.query<{ id: string; slug: string }>(
      `select id, slug from activities where status = 'published' order by slug limit 1`,
    );
    slug = rows[0]!.slug;

    // Deliberately partial: title translated, description NOT.
    await db.pg.query(
      `insert into activity_translations (activity_id, locale, title, source)
       values ($1, 'fr', 'Titre en français', 'machine')`,
      [rows[0]!.id],
    );
  });

  afterAll(async () => {
    await db.close?.();
  });

  it('returns English when no locale is supplied', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug });
    expect(a.title).not.toBe('Titre en français');
  });

  it('returns English when the locale is en', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    expect(a.title).not.toBe('Titre en français');
  });

  it('returns the French title when the locale is fr', async () => {
    const a = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(a.title).toBe('Titre en français');
  });

  it('falls back PER FIELD, so an untranslated field keeps its English text', async () => {
    const en = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug, locale: 'fr' });
    expect(fr.title).toBe('Titre en français');
    // description had no French row — it must be English, NOT null and NOT empty.
    expect(fr.description).toBe(en.description);
  });

  it('returns entirely English for an activity with no French row at all', async () => {
    const { rows } = await db.pg.query<{ slug: string }>(
      `select a.slug from activities a
        where a.status = 'published'
          and not exists (select 1 from activity_translations t
                          where t.activity_id = a.id and t.locale = 'fr')
        limit 1`,
    );
    const other = rows[0]!.slug;
    const en = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'en' });
    const fr = await rpc<Detail>(db, 'api_get_activity', { slug: other, locale: 'fr' });
    expect(fr.title).toBe(en.title);
    expect(fr.summary).toBe(en.summary);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/integration/localised-catalogue.test.ts
```

Expected: FAIL — the `fr` cases return English because the RPC ignores the locale.

- [ ] **Step 3: Write the migration**

Copy the current `api_get_activity` body from `supabase/setup.sql` (search for
`create or replace function api_get_activity`) into
`supabase/migrations/20260901000100_localised_catalogue_rpcs.sql`, then apply these changes:

1. Add a locale CTE-style join by turning the trailing `from activities a` into:

```sql
  from activities a
  left join activity_translations t
    on t.activity_id = a.id
   and t.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where a.slug = p ->> 'slug';
```

2. Replace each translatable field in the `jsonb_build_object` with a per-field coalesce. **Only
   these nine** — leave ids, prices, images, options and flags exactly as they are:

```sql
    'title', coalesce(t.title, a.title),
    'summary', coalesce(t.summary, a.summary),
    'description', coalesce(t.description, a.description),
    'meetingPoint', coalesce(t.meeting_point, a.meeting_point),
    'seoTitle', coalesce(t.seo_title, a.seo_title),
    'seoDescription', coalesce(t.seo_description, a.seo_description),
    'inclusions', to_jsonb(coalesce(nullif(t.inclusions, '{}'), a.inclusions)),
    'exclusions', to_jsonb(coalesce(nullif(t.exclusions, '{}'), a.exclusions)),
    'highlights', to_jsonb(coalesce(nullif(t.highlights, '{}'), a.highlights)),
```

The array fields use `nullif(..., '{}')` because those columns are `not null default '{}'`: an empty
array means "not translated", whereas plain `coalesce` would treat `{}` as a real translated value
and render an empty highlights list.

3. Leave the existing `'translations', ...` key in place. It is part of `tourDetailSchema` and
   removing it is an unrelated breaking change.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/integration/localised-catalogue.test.ts
```

Expected: PASS, 5 tests. The per-field test is the important one.

- [ ] **Step 5: Sync catch-up.sql and regenerate**

Append the full `create or replace function api_get_activity ...` statement to
`supabase/catch-up.sql`, then:

```bash
npm run setup:sql
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260901000100_localised_catalogue_rpcs.sql supabase/catch-up.sql supabase/setup.sql tests/integration/localised-catalogue.test.ts
git commit -m "feat(catalogue): resolve activity detail text per locale in SQL

api_get_activity now left-joins activity_translations and coalesces PER FIELD,
so a half-translated activity shows French where it exists and English
elsewhere — never a blank. Array fields use nullif(...,'{}') because an empty
array means untranslated, not translated-to-empty.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Make `api_search_activities` locale-aware

This is what finally puts French on cards, search results, home rails, related tours and the wishlist
— the surfaces a French visitor sees before ever opening an activity.

**Files:**

- Modify: `supabase/migrations/20260901000100_localised_catalogue_rpcs.sql`
- Modify: `supabase/catch-up.sql`
- Modify: `tests/integration/localised-catalogue.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe` block in `tests/integration/localised-catalogue.test.ts`:

```ts
it('returns French titles in search results, not just on the detail page', async () => {
  const res = await rpc<{ items: { slug: string; title: string }[] }>(db, 'api_search_activities', {
    q: null,
    category: null,
    type: null,
    region: null,
    priceMin: null,
    priceMax: null,
    durationMin: null,
    durationMax: null,
    minRating: null,
    page: 1,
    pageSize: 100,
    locale: 'fr',
  });
  const hit = res.items.find((i) => i.slug === slug);
  expect(hit?.title).toBe('Titre en français');
});

it('leaves search results English by default', async () => {
  const res = await rpc<{ items: { slug: string; title: string }[] }>(db, 'api_search_activities', {
    q: null,
    category: null,
    type: null,
    region: null,
    priceMin: null,
    priceMax: null,
    durationMin: null,
    durationMax: null,
    minRating: null,
    page: 1,
    pageSize: 100,
  });
  expect(res.items.find((i) => i.slug === slug)?.title).not.toBe('Titre en français');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/integration/localised-catalogue.test.ts
```

Expected: FAIL on the French search case.

- [ ] **Step 3: Update the RPC**

Append `create or replace function api_search_activities` to the same migration file, copying the
current body from `supabase/setup.sql` and applying the same two edits: join
`activity_translations` on the locale, and coalesce `title` and `summary` per field. `TourSummary`
carries only those two text fields, so nothing else changes.

Make sure the join does not change row counts — it is a `left join` on a table with
`unique (activity_id, locale)`, so it cannot fan out. If the total count changes in the test, the
join condition is missing the `and t.locale = ...` clause.

- [ ] **Step 4: Verify**

```bash
npx vitest run tests/integration/localised-catalogue.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Sync and commit**

Append the statement to `supabase/catch-up.sql`, then:

```bash
npm run setup:sql
git add supabase/migrations/20260901000100_localised_catalogue_rpcs.sql supabase/catch-up.sql supabase/setup.sql tests/integration/localised-catalogue.test.ts
git commit -m "feat(catalogue): localise search results, cards and home rails

api_search_activities now resolves title and summary per locale, which is what
puts French on every surface a visitor sees before opening an activity.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Pass the locale from the app into the RPCs

**Files:**

- Modify: `src/lib/services/activities.ts`
- Modify: 15 server-component call sites (listed below)

- [ ] **Step 1: Pass `ctx.locale` in the service layer**

In `src/lib/services/activities.ts`, add `locale: ctx.locale` to both RPC payloads:

```ts
const data = await callRpc(ctx, 'api_search_activities', {
  q: query.q ?? null,
  category: query.category ?? null,
  type: query.type ?? null,
  region: query.region ?? null,
  priceMin: query.priceMin ?? null,
  priceMax: query.priceMax ?? null,
  durationMin: query.durationMin ?? null,
  durationMax: query.durationMax ?? null,
  minRating: query.minRating ?? null,
  page: query.page,
  pageSize: query.pageSize,
  locale: ctx.locale,
});
```

```ts
export async function getActivity(ctx: ServiceContext, slug: string): Promise<TourDetail> {
  const data = await callRpc(ctx, 'api_get_activity', { slug, locale: ctx.locale });
  if (data === null || data === undefined) {
    throw new NotFoundError(`Activity "${slug}" not found`);
  }
  return tourDetailSchema.parse(data);
}
```

- [ ] **Step 2: Pass the locale at the visitor-facing call sites**

Add `import { getLocale } from '@/lib/i18n/server';` to each file below and change
`publicServiceContext()` to `publicServiceContext(await getLocale())`:

- `app/(site)/activities/page.tsx:107`
- `app/(site)/activities/[slug]/page.tsx:56, 72, 150`
- `app/(site)/page.tsx:50`
- `app/(site)/rent/page.tsx:75`
- `app/(site)/wishlist/page.tsx:24`
- `app/(site)/reviews/write/page.tsx:15`
- `app/(site)/[...missing]/page.tsx:19`
- `src/lib/catalogue/places.ts:15`
- `src/lib/content/blog-live.ts:16, 41`
- `src/lib/content/guest-reviews-live.ts:59`
- `src/lib/seo/landing.ts:18, 62`
- `src/lib/seo/override.ts:13`

**Leave these two on the English default — do not add `getLocale()`:**

- `app/sitemap.ts:65` — the sitemap lists URLs for crawlers, has no reader locale, and calling
  `cookies()` here would force it into dynamic rendering.
- `app/api/v1/health/route.ts:17` — a health probe with no locale.
- `app/api/planner/from-tour/route.ts:39` — this is a route handler; use
  `buildServiceContext(req)` if a locale is wanted, since `getLocale()` needs a server-component
  context. Leaving it English is acceptable for this phase.

- [ ] **Step 3: Typecheck and run the full suite**

```bash
npm run typecheck && npm test
```

Expected: both exit 0. Behaviour is unchanged because no French catalogue content exists yet — that
is the point of splitting this phase from the next.

- [ ] **Step 4: Commit**

```bash
git add src/lib/services/activities.ts "app/(site)" src/lib/catalogue/places.ts src/lib/content/blog-live.ts src/lib/content/guest-reviews-live.ts src/lib/seo/landing.ts src/lib/seo/override.ts
git commit -m "feat(catalogue): pass the visitor locale into the catalogue RPCs

Sitemap and health deliberately stay on the English default: neither has a
reader locale, and cookies() would force the sitemap into dynamic rendering.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: French fields in the admin activity editor

**Files:**

- Modify: `src/lib/admin/activity-write.ts`
- Modify: `src/components/admin/ActivityForm.tsx`
- Test: `tests/unit/admin-activity-translations.test.ts` (create)

- [ ] **Step 0: Add `source` to the hand-maintained row type**

`src/lib/supabase/types.ts` is maintained by hand, not generated, so Task 3's migration did not
update it. `ActivityTranslationsRow` and `ActivityTranslationsInsert` are both missing `source`,
and this task is the first to read or write it. Add to both:

```ts
  /** 'human' = written or approved by staff; 'machine' = auto-drafted, awaiting review in /admin. */
  source: string;
```

On the `Insert` type make it optional (`source?: string`) — the column has a default, so an insert
that omits it is valid.

- [ ] **Step 1: Read the existing form and write path first**

```bash
sed -n '1,140p' src/lib/admin/activity-write.ts
grep -n "summary\|description\|highlights\|inclusions" src/components/admin/ActivityForm.tsx | head -30
```

Match the file's existing patterns for field definitions, defaults and the save path. Do not
restructure the form.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/admin-activity-translations.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { translationRowFromForm, isMachineDraft } from '@/lib/admin/activity-write';

/**
 * Saving French copy must flip source to 'human'. If it stayed 'machine', the owner's own edits
 * would keep showing the "needs review" badge and the worklist would never empty — the badge would
 * become noise and get ignored, which defeats the point of flagging drafts at all.
 */
describe('activity translation save', () => {
  const base = {
    title: 'Titre',
    summary: null,
    description: null,
    meetingPoint: null,
    seoTitle: null,
    seoDescription: null,
    highlights: [],
    inclusions: [],
    exclusions: [],
  };

  it('marks an owner-edited translation as human-reviewed', () => {
    expect(translationRowFromForm('act-1', base).source).toBe('human');
  });

  it('maps camelCase form fields onto snake_case columns', () => {
    const row = translationRowFromForm('act-1', {
      ...base,
      meetingPoint: 'Quai de Trou d’Eau Douce',
    });
    expect(row.meeting_point).toBe('Quai de Trou d’Eau Douce');
    expect(row.activity_id).toBe('act-1');
    expect(row.locale).toBe('fr');
  });

  it('treats an empty string as untranslated (null), so SQL falls back to English', () => {
    // '' would win the coalesce and blank the field on the live page.
    expect(translationRowFromForm('act-1', { ...base, summary: '' }).summary).toBeNull();
  });

  it('identifies rows still awaiting review', () => {
    expect(isMachineDraft({ source: 'machine' })).toBe(true);
    expect(isMachineDraft({ source: 'human' })).toBe(false);
    expect(isMachineDraft(null)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/unit/admin-activity-translations.test.ts
```

Expected: FAIL — the exports do not exist.

- [ ] **Step 4: Implement in `src/lib/admin/activity-write.ts`**

```ts
export interface ActivityTranslationForm {
  title: string | null;
  summary: string | null;
  description: string | null;
  meetingPoint: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
}

/** '' means the field was left blank, i.e. untranslated. It must be stored as NULL, because the
 *  SQL fallback is `coalesce(t.field, a.field)` and an empty string would win that coalesce and
 *  blank the field on the live page instead of showing the English text. */
const blankToNull = (v: string | null): string | null => (v && v.trim() ? v : null);

/** Row for an owner-entered French translation. Always 'human': the owner typing in admin IS the
 *  review, so the draft badge must clear on save. */
export function translationRowFromForm(activityId: string, form: ActivityTranslationForm) {
  return {
    activity_id: activityId,
    locale: 'fr' as const,
    title: blankToNull(form.title),
    summary: blankToNull(form.summary),
    description: blankToNull(form.description),
    meeting_point: blankToNull(form.meetingPoint),
    seo_title: blankToNull(form.seoTitle),
    seo_description: blankToNull(form.seoDescription),
    highlights: form.highlights,
    inclusions: form.inclusions,
    exclusions: form.exclusions,
    source: 'human' as const,
  };
}

/** True when this translation was drafted automatically and has not been reviewed yet. */
export function isMachineDraft(row: { source?: string } | null | undefined): boolean {
  return row?.source === 'machine';
}
```

Wire the save: upsert on the `(activity_id, locale)` unique constraint alongside the existing
activity save.

```ts
export async function saveActivityTranslation(
  activityId: string,
  form: ActivityTranslationForm,
): Promise<void> {
  const sb = getBrowserSupabase();
  const { error } = await sb
    .from('activity_translations')
    .upsert(translationRowFromForm(activityId, form), { onConflict: 'activity_id,locale' });
  if (error) throw error;
}
```

- [ ] **Step 5: Add the French panel to `ActivityForm.tsx`**

Add a collapsible "Français" section mirroring the English fields, following the form's existing
field components. When the loaded translation row satisfies `isMachineDraft`, render a badge above
the panel:

```tsx
{
  isMachineDraft(translation) && (
    <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      Machine draft — not yet reviewed. Edit any field, or save, to mark it reviewed.
    </p>
  );
}
```

Admin is staff-only and stays English, so this string is deliberately **not** wrapped in `t()`.

- [ ] **Step 6: Verify and commit**

```bash
npx vitest run tests/unit/admin-activity-translations.test.ts && npm run typecheck && npm test
```

Expected: all pass.

```bash
git add src/lib/admin/activity-write.ts src/components/admin/ActivityForm.tsx tests/unit/admin-activity-translations.test.ts
git commit -m "feat(admin): edit French activity copy and flag machine drafts

Blank fields save as NULL, not '', because the SQL fallback is a coalesce and
an empty string would win it — blanking the field on the live page instead of
showing English. Saving marks the row human-reviewed so the badge clears.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3 — Catalogue French copy

### Task 9: Seed machine-drafted French for the catalogue

This is the phase where the site visibly becomes French for a French visitor.

**Files:**

- Create: `supabase/seed-fr-catalogue.sql`
- Modify: `supabase/catch-up.sql`

- [ ] **Step 1: Export the English catalogue text**

```bash
npx tsx scripts/dump-catalogue.ts
```

Inspect the output for the fields needing translation: `title`, `summary`, `description`,
`meeting_point`, `highlights`, `inclusions`, `exclusions`, `seo_title`, `seo_description`.

- [ ] **Step 2: Draft the French**

Translate every published activity. Rules:

- **Do translate:** titles, summaries, descriptions, highlights, inclusions, exclusions, meeting-point
  descriptions, SEO titles and descriptions.
- **Do NOT translate proper nouns:** `Île aux Cerfs`, `Belle Mare`, `Trou d'Eau Douce`, `Grand Baie`,
  `Chamarel`, `Port Louis`, hotel and resort names, `Belle Mare Tours`. A tour named
  "Île aux Cerfs Catamaran Cruise" becomes "Croisière en catamaran à l'Île aux Cerfs" — the place
  name is untouched.
- **Match the existing register:** the French table uses curly apostrophes (`’`) and vouvoiement
  (`vous`, never `tu`). Follow both.
- **Never invent claims.** Translate what is there. If an English description says the tour is 4
  hours, the French says 4 hours.

- [ ] **Step 3: Write the seed as idempotent upserts**

Every row is `source = 'machine'` so it lands in the owner's review worklist. Pattern:

```sql
-- Machine-drafted French catalogue copy. Every row is source='machine' so it appears in the admin
-- review worklist. Idempotent: re-running refreshes drafts but NEVER overwrites owner-reviewed
-- ('human') rows — that would silently discard the owner's corrections on the next deploy.
insert into activity_translations
  (activity_id, locale, title, summary, description, meeting_point,
   highlights, inclusions, exclusions, seo_title, seo_description, source)
select a.id, 'fr'::content_locale,
       'Croisière en catamaran à l''Île aux Cerfs',
       'Journée en catamaran vers l''Île aux Cerfs, avec déjeuner barbecue sur la plage.',
       null, null, '{}'::text[], '{}'::text[], '{}'::text[], null, null,
       'machine'
from activities a
where a.slug = 'ile-aux-cerfs-catamaran-cruise'
on conflict (activity_id, locale) do update
  set title = excluded.title,
      summary = excluded.summary,
      description = excluded.description,
      meeting_point = excluded.meeting_point,
      highlights = excluded.highlights,
      inclusions = excluded.inclusions,
      exclusions = excluded.exclusions,
      seo_title = excluded.seo_title,
      seo_description = excluded.seo_description
  where activity_translations.source = 'machine';
```

The `where activity_translations.source = 'machine'` on the `do update` is the important clause: it
protects owner-reviewed rows from being clobbered when the seed re-runs.

- [ ] **Step 4: Verify against a test database**

```bash
npx vitest run tests/integration/localised-catalogue.test.ts
```

Expected: PASS.

Then confirm the protection clause actually holds. Add to that test file:

```ts
it('a re-run of the seed does not clobber owner-reviewed copy', async () => {
  const { rows } = await db.pg.query<{ id: string }>(`select id from activities where slug = $1`, [
    slug,
  ]);
  const id = rows[0]!.id;
  await db.pg.query(
    `update activity_translations set title = 'Titre approuvé', source = 'human'
       where activity_id = $1 and locale = 'fr'`,
    [id],
  );
  await db.pg.query(
    `insert into activity_translations (activity_id, locale, title, source)
       values ($1, 'fr', 'Brouillon machine', 'machine')
       on conflict (activity_id, locale) do update set title = excluded.title
       where activity_translations.source = 'machine'`,
    [id],
  );
  const { rows: after } = await db.pg.query<{ title: string; source: string }>(
    `select title, source from activity_translations where activity_id = $1 and locale = 'fr'`,
    [id],
  );
  expect(after[0]!.title).toBe('Titre approuvé');
  expect(after[0]!.source).toBe('human');
});
```

- [ ] **Step 5: Append to catch-up.sql and commit**

```bash
git add supabase/seed-fr-catalogue.sql supabase/catch-up.sql tests/integration/localised-catalogue.test.ts
git commit -m "feat(catalogue): machine-drafted French for the live catalogue

Every row lands as source='machine' so it shows in the admin review worklist.
The upsert refuses to overwrite rows the owner has already reviewed, so a
re-run on deploy cannot silently discard their corrections.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Verify in the running app**

```bash
npm run dev -- --turbopack
```

Open an activity page, switch to Français in the header, and confirm the tour title, summary and
description are French while prices and place names are unchanged. Then open `/activities` and
confirm the cards are French too — that exercises the `api_search_activities` path from Task 6, which
is a different code path from the detail page.

---

# Phase 4 — Hardcoded UI strings

### Task 10: Route the ~366 hardcoded strings through `t()`

54 files. Work in the batches below, committing per batch, so a mistake is easy to bisect. Each batch
follows the identical pattern, so it is written once here.

**The pattern.** For a client component (`'use client'` at the top):

```tsx
import { useT } from '@/components/site/PreferencesProvider';

export function Thing() {
  const t = useT();
  return <h2>{t('Book your transfer')}</h2>;
}
```

For a server component (no `'use client'`):

```tsx
import { getT } from '@/lib/i18n/server';

export default async function Page() {
  const t = await getT();
  return <h2>{t('Book your transfer')}</h2>;
}
```

Then add the English source string as a key to `src/lib/i18n/messages.ts` with its French value.

**Rules for every batch:**

- Copy the English string **verbatim** into `t()`, including its apostrophe style. Do not normalise.
- Do not wrap: `className` values, `href`s, `data-*`, test ids, or proper nouns rendered alone
  (`Belle Mare Tours`, `Île aux Cerfs`).
- Do wrap: visible text, `placeholder`, `aria-label`, `alt`, and `title` attributes. Screen-reader
  text is user-facing text.
- A server component cannot call `useT()`, and a client component cannot `await getT()`. If a file
  has no `'use client'` but is imported by one, it is a client component.

- [ ] **Step 1: Batch A — interactive UI (highest value, most-seen)**

- `src/components/transfers/HotelToHotelQuote.tsx` (14)
- `src/components/gyg/detail/BookingCard.tsx` (12)
- `src/components/rental/RentalWidget.tsx` (10)
- `src/components/site/SiteHeader.tsx` (6)
- `src/components/site/ReviewWriteForm.tsx` (4)
- `src/components/transfers/TransferSearch.tsx` (4)

Verify and commit:

```bash
node scripts/i18n-scan.mjs && npm run typecheck && npx vitest run tests/unit/i18n-coverage.test.ts
git add src/components/transfers src/components/gyg/detail/BookingCard.tsx src/components/rental/RentalWidget.tsx src/components/site/SiteHeader.tsx src/components/site/ReviewWriteForm.tsx src/lib/i18n/messages.ts
git commit -m "feat(i18n): translate the booking, transfer and rental widgets

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Batch B — landing and category pages**

- `app/(site)/airport-transfers/page.tsx` (36)
- `app/(site)/mauritius-tours/page.tsx` (16)
- `app/(site)/things-to-do-in-belle-mare/page.tsx` (12)
- `app/(site)/help/page.tsx` (12)
- `app/(site)/airport-transfers/[slug]/page.tsx` (10)
- `app/(site)/mauritius-catamaran-cruise/page.tsx` (10)
- `app/(site)/belle-mare-tours/page.tsx` (8)
- `app/(site)/dolphin-swim-mauritius/page.tsx` (8)
- `app/(site)/ile-aux-cerfs-tours/page.tsx` (5)

Same verify-and-commit sequence, adjusting the paths in `git add`.

- [ ] **Step 3: Batch C — content page furniture**

Only the page **furniture** here — headings, labels, CTAs, section titles. The long-form prose inside
these pages comes from the content modules and is handled in Phase 5.

- `app/(site)/attractions/[slug]/page.tsx` (12)
- `app/(site)/destinations/[slug]/page.tsx` (8)
- `app/(site)/attractions/page.tsx` (4)
- `app/(site)/blog/[slug]/page.tsx` (4)
- `app/(site)/blog/page.tsx` (2)
- `app/(site)/mauritius-travel-guide/page.tsx` (17)

- [ ] **Step 4: Batch D — errors, empty states and the long tail**

Error and not-found screens matter more than their string count suggests: they are what a French
visitor sees when something has already gone wrong.

- `app/not-found.tsx` (5), `app/(site)/error.tsx` (3), `app/global-error.tsx` (3)
- `app/(site)/activities/[slug]/not-found.tsx`, `app/(site)/airport-transfers/[slug]/not-found.tsx`,
  `app/(site)/blog/[slug]/not-found.tsx`, `app/(site)/destinations/[slug]/not-found.tsx` (2 each)
- `src/components/maps/ItineraryMap.tsx` (3), `src/components/transfers/TransferGuides.tsx` (3)
- `src/components/auth/AuthCallback.tsx`, `src/components/gyg/Rail.tsx`,
  `src/components/site/FeaturedReviews.tsx`, `src/components/transfers/TransferReviews.tsx` (2 each)
- `app/(site)/reviews/write/page.tsx` (2)
- `src/components/auth/AuthProvider.tsx`, `src/components/catalogue/Breadcrumb.tsx`,
  `src/components/maps/MapLinkCard.tsx`, `src/components/maps/PickupMap.tsx`,
  `src/components/maps/RouteMap.tsx`, `src/components/site/Logo.tsx`,
  `src/components/site/PopularSearches.tsx` (1 each)
- The 13 files that already use `t()` but retain a stray literal: `app/(site)/rent/page.tsx` (6),
  `src/components/catalogue/CategoryChips.tsx`, `src/components/checkout/Checkout.tsx`,
  `src/components/gyg/detail/DisruptionBanner.tsx`, `src/components/gyg/GygHero.tsx`,
  `app/(site)/cookies/page.tsx` (2 each), and
  `src/components/gyg/detail/BookingProvider.tsx`, `src/components/gyg/HomeShowcase.tsx`,
  `src/components/gyg/MobileSearch.tsx`, `src/components/gyg/SearchBar.tsx`,
  `src/components/planner/ChatCopilot.tsx`, `src/components/site/SiteFooter.tsx`,
  `app/(site)/activities/page.tsx` (1 each)

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: all exit 0.

---

### Task 11: The French notice on legal pages

Legal text stays English because a mistranslated clause is still binding. A French visitor should be
told that, rather than silently hitting three English pages.

**Files:**

- Modify: `app/(site)/terms/page.tsx`, `app/(site)/privacy/page.tsx`, `app/(site)/refunds/page.tsx`
- Modify: `src/lib/i18n/messages.ts`

- [ ] **Step 1: Add the key**

```ts
  'This page is available in English only. The English text is the legally binding version.':
    'Cette page est disponible en anglais uniquement. Le texte anglais est la version juridiquement contraignante.',
```

- [ ] **Step 2: Render it only for French visitors**

At the top of each of the three pages:

```tsx
import { getLocale, getT } from '@/lib/i18n/server';

// inside the component:
const locale = await getLocale();
const t = await getT();

{
  locale !== 'en' && (
    <p className="mb-6 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
      {t(
        'This page is available in English only. The English text is the legally binding version.',
      )}
    </p>
  );
}
```

- [ ] **Step 3: Verify and commit**

```bash
npm run typecheck && npm test
git add "app/(site)/terms/page.tsx" "app/(site)/privacy/page.tsx" "app/(site)/refunds/page.tsx" src/lib/i18n/messages.ts
git commit -m "feat(legal): tell French visitors the legal pages are English-only

Translating binding clauses creates real liability for no UX gain, so the text
stays English and says so in French.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 5 — SEO prose

### Task 12: The per-field merge helper

**Files:**

- Create: `src/lib/content/localise.ts`
- Test: `tests/unit/content-localise.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/content-localise.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localiseContent } from '@/lib/content/localise';

/**
 * Same per-field rule as the SQL path: French where it exists, English everywhere else. A row-level
 * swap would blank whole sections of a partially translated guide.
 */
describe('localiseContent', () => {
  const en = {
    slug: 'grand-baie',
    name: 'Grand Baie',
    intro: 'A lively hub.',
    highlights: ['Catamaran cruise', 'Dive the reefs'],
  };

  it('returns English untouched for the en locale', () => {
    expect(localiseContent(en, { intro: 'Un pôle animé.' }, 'en')).toEqual(en);
  });

  it('overlays only the fields the French entry defines', () => {
    const out = localiseContent(en, { intro: 'Un pôle animé.' }, 'fr');
    expect(out.intro).toBe('Un pôle animé.');
    expect(out.highlights).toEqual(['Catamaran cruise', 'Dive the reefs']);
    expect(out.slug).toBe('grand-baie');
  });

  it('returns English when there is no French entry at all', () => {
    expect(localiseContent(en, undefined, 'fr')).toEqual(en);
  });

  it('ignores empty strings and empty arrays, which mean untranslated', () => {
    const out = localiseContent(en, { intro: '', highlights: [] }, 'fr');
    expect(out.intro).toBe('A lively hub.');
    expect(out.highlights).toEqual(['Catamaran cruise', 'Dive the reefs']);
  });

  it('never lets a French entry introduce a slug', () => {
    // A translated slug would break every URL and every internal link to this page.
    const out = localiseContent(en, { slug: 'grande-baie', intro: 'Un pôle animé.' }, 'fr');
    expect(out.slug).toBe('grand-baie');
    expect(out.intro).toBe('Un pôle animé.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/content-localise.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/content/localise.ts`:

```ts
import type { Locale } from '@/lib/i18n/config';

/** Fields that identify or structure content and must never come from a translation file. A
 *  translated slug would break every URL and every internal link pointing at the page. */
const NEVER_TRANSLATED = new Set(['slug', 'path', 'region', 'image', 'images']);

function isEmpty(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/**
 * Merge a French entry over its English source, per field. Mirrors the SQL `coalesce(t.f, a.f)`
 * rule: an absent or empty French field keeps the English text, so a partially translated guide
 * degrades gracefully instead of rendering blank sections.
 */
export function localiseContent<T extends object>(
  english: T,
  french: Partial<T> | undefined,
  locale: Locale,
): T {
  if (locale === 'en' || !french) return english;
  const out = { ...english };
  for (const [key, value] of Object.entries(french)) {
    if (NEVER_TRANSLATED.has(key) || isEmpty(value)) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}
```

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/unit/content-localise.test.ts
git add src/lib/content/localise.ts tests/unit/content-localise.test.ts
git commit -m "feat(content): per-field French overlay for the content modules

Mirrors the SQL coalesce rule so a half-translated guide keeps its English
sections rather than rendering blanks. Refuses to overlay slug/path, which
would break every URL pointing at the page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Translate the destination guides

**Files:**

- Create: `src/lib/content/_areas.fr.gen.ts`
- Modify: `src/lib/content/areas.ts`

- [ ] **Step 0: Define the translation type as an ALLOWLIST**

Do this first — it is what makes the rest of the task safe. Add to `src/lib/content/areas.ts`:

```ts
/**
 * The fields of an area guide that may be translated. An ALLOWLIST, deliberately: everything
 * omitted here — `slug`, `region`, `name`, `beaches`, `stayOptions`, `nearbyAttractions` — is a
 * real Mauritian place, beach or hotel name, and a translation file that tried to set one would
 * invent French names for real places. Omitting them makes that a compile error rather than a
 * production defect nobody notices.
 */
export type AreaTranslation = Partial<
  Pick<AreaContent, 'intro' | 'highlights' | 'gettingThere' | 'goodFor' | 'faq'>
>;
```

`localiseContent` also keeps a runtime backstop for `slug`/`path`/`id`, but the type is the real
defence. Do not widen it to `Partial<AreaContent>`.

- [ ] **Step 1: Create the French file**

Keyed by slug, typed `Record<string, AreaTranslation>` so the allowlist is enforced. If you find
yourself wanting to translate a field the type rejects, that is the type working — do not widen it.

```ts
// AUTO-GENERATED French overlay for _areas.gen.ts. MACHINE-DRAFTED — not yet owner-reviewed.
// Translatable prose only: slugs, regions, beach names, hotel names and attraction names are
// deliberately absent, because they are real proper nouns. AreaTranslation enforces this.
import type { AreaTranslation } from './areas';

export const AREAS_FR: Record<string, AreaTranslation> = {
  'grand-baie': {
    intro:
      'Grand Baie est le cœur animé de la côte nord de Maurice, bâti autour d’une baie turquoise abritée qui a donné son nom au village. Autrefois paisible village de pêcheurs, c’est aujourd’hui la station la plus fréquentée de l’île…',
    highlights: [
      'Partez en catamaran ou en hors-bord vers les îles du nord — Gabriel, l’Île Plate et l’Île Ronde — pour du snorkeling et un barbecue sur la plage',
      // …one entry per English highlight, same order
    ],
    gettingThere:
      'L’aéroport SSR se trouve au sud-est ; Grand Baie est donc à environ 55-65 km, soit 1 h à 1 h 15 de route par l’autoroute M1/M2…',
    faq: [
      {
        q: 'À quelle distance Grand Baie se trouve-t-il de l’aéroport ?',
        a: 'L’aéroport SSR est au sud-est, à environ 55-65 km de Grand Baie…',
      },
    ],
  },
  // …one entry per area in _areas.gen.ts
};
```

`faq` is an array of `{q, a}` objects — translate both fields and keep the same order and length as
the English, since the pages render them positionally.

- [ ] **Step 2: Wire the resolver in `areas.ts`**

```ts
import { AREAS_FR } from './_areas.fr.gen';
import { localiseContent } from './localise';
import type { Locale } from '@/lib/i18n/config';

/** An area guide in the visitor's language, falling back to English per field. */
export function localisedArea(area: Area, locale: Locale): Area {
  return localiseContent(area, AREAS_FR[area.slug], locale);
}
```

- [ ] **Step 3: Use it in the destination page**

In `app/(site)/destinations/[slug]/page.tsx`, wrap the resolved area:

```tsx
const area = localisedArea(rawArea, await getLocale());
```

- [ ] **Step 4: Verify and commit**

```bash
npm run typecheck && npm test
git add src/lib/content/_areas.fr.gen.ts src/lib/content/areas.ts "app/(site)/destinations/[slug]/page.tsx"
git commit -m "feat(content): French destination guides

Prose only — slugs, regions, beach names and attraction names stay English
because they are real proper nouns.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Translate attractions, transfer guides and the blog

Repeat Task 13's shape for the remaining three modules. Each is a separate commit.

Each module defines its **own** allowlist translation type first, exactly as Task 13 Step 0 does.
Do not reuse `AreaTranslation` and do not fall back to `Partial<TheWholeInterface>` — the whole
point is that each type names only its prose fields. Note the allowlists genuinely differ: an area's
`name` is a place name and must NOT be translatable, whereas a blog post's `title` is our own copy
and MUST be. Read each interface before writing its type.

- [ ] **Step 1: Attractions** — create `src/lib/content/_additional-attractions.fr.gen.ts`
      (395 lines of source), define `AttractionTranslation`, add `localisedAttraction` to
      `src/lib/content/attractions.ts`, use it in `app/(site)/attractions/[slug]/page.tsx`. Commit.

- [ ] **Step 2: Transfer guides** — create `src/lib/content/_transfers.fr.gen.ts` (2,080 lines),
      define `TransferTranslation`, add `localisedTransfer` to `src/lib/content/transfers.ts`, use it
      in the transfer pages. Hotel, resort and place names must be outside the allowlist. Commit.

- [ ] **Step 3: Blog** — create `src/lib/content/_blog.fr.gen.ts` (3,078 lines, the largest single
      chunk in the project), define `PostTranslation`, add `localisedPost` to
      `src/lib/content/blog.ts`, use it in `app/(site)/blog/[slug]/page.tsx`. Allowlist `title`,
      `excerpt` and body prose; leave `slug`, `date`, author names and image paths out of it. Commit.

- [ ] **Step 4: Confirm reviews were left alone**

```bash
ls src/lib/content/_reviews.fr.gen.ts src/lib/content/_review-pool.fr.gen.ts 2>/dev/null
```

Expected: "No such file". These are real reviews by real named people; translating them and still
attributing them by name would misrepresent what those people wrote. If either file exists, delete it.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm run lint && npm test
```

---

# Phase 6 — Outbound

### Task 15: Record the guest's language on the booking

**Files:**

- Create: `supabase/migrations/20260901000200_booking_locale.sql`
- Modify: `supabase/catch-up.sql`, the checkout booking path

- [ ] **Step 1: Write the migration**

```sql
-- The language the guest booked in. Outbound email and PDFs are rendered later, often by a cron
-- worker with no request context, so the locale has to be stored rather than inferred at send time.
alter table bookings
  add column if not exists locale content_locale not null default 'en';
```

- [ ] **Step 2: Persist it in `api_book`**

Copy the current `api_book` body from `supabase/setup.sql` (search for
`create or replace function api_book`) into the same migration file, then add `locale` to the
`insert into bookings` column list and to its `values`, reading it from the payload:

```sql
  -- in the column list
  insert into bookings (..., locale)
  -- in the values list
  values (..., coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale)
```

`coalesce(nullif(...))` rather than a bare cast: an absent key yields SQL NULL and an empty string
fails the enum cast, so both must collapse to `'en'` or an older client would break booking creation.

- [ ] **Step 2b: Send the locale from the service layer**

In `src/lib/services/bookings.ts`, add `locale: ctx.locale` to the `api_book` payload:

```ts
const data = await callRpc(ctx, 'api_book', {
  // …existing fields unchanged…
  locale: ctx.locale,
});
```

Because checkout runs through an API route, `buildServiceContext(req)` (Task 4) has already read the
locale off the request cookie, so no checkout component changes.

- [ ] **Step 3: Append to catch-up.sql, regenerate, verify**

```bash
npm run setup:sql && npx vitest run tests/integration
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260901000200_booking_locale.sql supabase/catch-up.sql supabase/setup.sql src/lib/services/bookings.ts
git commit -m "feat(bookings): record the language the guest booked in

Email and PDFs render later from a cron worker with no request context, so the
locale must be stored on the booking rather than inferred at send time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 16: Localise the confirmation email and PDFs

**Files:**

- Modify: `src/lib/email/booking-confirmation.ts`, `src/lib/invoice/voucher-pdf.ts`,
  `src/lib/invoice/pdf.ts`
- Test: `tests/unit/outbound-locale.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { renderBookingConfirmation } from '@/lib/email/booking-confirmation';

/**
 * The guest's language, not the sender's. These are rendered by a cron worker whose own locale is
 * meaningless, so the booking's stored locale is the only correct source.
 */
describe('booking confirmation email', () => {
  const booking = {
    ref: 'BM12345678',
    locale: 'fr' as const,
    activityTitle: 'Croisière',
    date: '2026-08-14',
    guests: 2,
    totalEur: 240,
  };

  it('renders French for a French booking', () => {
    const out = renderBookingConfirmation({ ...booking, locale: 'fr' });
    expect(out.subject).toContain('Votre réservation');
    expect(out.html).not.toContain('Your booking is confirmed');
  });

  it('renders English for an English booking', () => {
    const out = renderBookingConfirmation({ ...booking, locale: 'en' });
    expect(out.subject).toContain('Your booking');
  });

  it('formats the date for the locale', () => {
    expect(renderBookingConfirmation({ ...booking, locale: 'fr' }).html).toContain('août');
    expect(renderBookingConfirmation({ ...booking, locale: 'en' }).html).toContain('Aug');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/unit/outbound-locale.test.ts
```

- [ ] **Step 3: Implement**

Thread `locale: Locale` through each template's props. Inside, use
`translate(locale, 'English source')` from `@/lib/i18n/translate` (these run outside React, so
neither `useT` nor `getT` applies), and `formatLocaleDate(value, locale)` from `@/lib/i18n/format`.

Fix the hardcoded format at `src/lib/invoice/voucher-pdf.ts:46`:

```ts
// Before: new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { … })
return formatLocaleDate(`${ymd}T00:00:00Z`, locale, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
```

Add every new English source string to `src/lib/i18n/messages.ts`.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/unit/outbound-locale.test.ts && npm test
git add src/lib/email src/lib/invoice src/lib/i18n/messages.ts tests/unit/outbound-locale.test.ts
git commit -m "feat(outbound): render email and PDFs in the guest's language

Replaces the hardcoded en-GB date format in the voucher. Uses translate()
directly because these render outside React.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 17: Localise SEO metadata, then finish

**Files:**

- Modify: `app/(site)/activities/[slug]/page.tsx` (`generateMetadata`)
- Modify: `docs/HANDBOOK.md`

- [ ] **Step 1: Use the resolved SEO fields**

`generateMetadata` already receives a `TourDetail`. Because Task 5 resolves `seoTitle` and
`seoDescription` per locale in SQL, it only needs to build its context with the locale:

```tsx
const activity = await getActivity(publicServiceContext(await getLocale()), slug);
```

Set the document language too:

```tsx
export async function generateMetadata(...) {
  const locale = await getLocale();
  // …
  return { title, description, openGraph: { locale: locale === 'fr' ? 'fr_FR' : 'en_GB' } };
}
```

- [ ] **Step 2: Update the handbook**

Add a "French localisation" section to `docs/HANDBOOK.md` covering: the gettext-style key system, the
apostrophe landmine, where the locale enters (`ServiceContext`), the per-field coalesce rule, the
machine-draft review workflow in admin, and what is deliberately English (legal pages, scraped
reviews, admin). Note that cookie-switched French earns no French search traffic and that `/fr/`
routing with hreflang is the separate project that would.

- [ ] **Step 3: Full gate**

```bash
npm run typecheck && npm run lint && npm run format:check && npm test && npm run build
```

Expected: all exit 0. Run the **full** suite, not a filtered subset — CI fails fast, and a red CI
silently stops the Cloudflare deploy.

- [ ] **Step 4: Manual verification**

```bash
npm run dev -- --turbopack
```

Switch to Français and walk: home → `/activities` → an activity → checkout → an emailed voucher.
Confirm every visible string is French except place names, prices, brand names and the three legal
pages (which should show the French English-only notice).

- [ ] **Step 5: Commit**

```bash
git add "app/(site)/activities/[slug]/page.tsx" docs/HANDBOOK.md
git commit -m "feat(seo): localise activity metadata; document the French system

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Verification checklist

- [ ] `npx vitest run tests/unit/i18n-coverage.test.ts` — green (the standing guard rail)
- [ ] Per-field fallback proven: a half-translated activity shows a French title and an English
      description, never a blank
- [ ] A re-run of `seed-fr-catalogue.sql` does not overwrite owner-reviewed rows
- [ ] Cards, search and home rails are French, not just the detail page
- [ ] `app/sitemap.ts` still renders without a request context
- [ ] Legal pages show the French English-only notice and remain English
- [ ] No `_reviews.fr.gen.ts` or `_review-pool.fr.gen.ts` exists
- [ ] `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build` all green
