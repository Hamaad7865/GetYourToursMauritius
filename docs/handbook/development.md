# Development — making a change

[← Handbook](../HANDBOOK.md)

---

## Local setup

```bash
git clone <repo> && cd GetYourToursMauritius
npm install                 # .npmrc forces legacy-peer-deps — do NOT delete it
cp .env.example .env.local  # then fill it in (see below)
npm run dev                 # → http://localhost:3000
```

**Minimum `.env.local` to see real data:**

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # needed for admin + booking work
```

Without Supabase credentials the app **still boots** — it silently serves an in-memory seed fixture, so
the catalogue renders but nothing persists. That's deliberate (it lets CI build with no accounts) but it
means _"the site loads"_ is not evidence that your config is correct.

In `next dev`, payments and email always use **stubs**, even with real credentials, because
`NODE_ENV=development` exempts the app from the production fail-closed gate.

> **Windows note.** If `next dev` misbehaves, use `npx next dev --turbopack`.

### If you want the real Cloudflare edge runtime locally

`wrangler pages dev` reads **`.dev.vars`**, not `.env.local`. Copy `.dev.vars.example` and mirror your
server-only values into it.

---

## The gate: run this before every push

CI runs **six** checks and **fails fast**. A failure at step 3 means steps 4–6 never run — so a single
formatting error can hide a broken build and a broken Cloudflare bundle.

```bash
npm run typecheck && \
npm run lint && \
npm run format:check && \
npm run test:coverage && \
npm run build
```

| Step            | Catches                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `typecheck`     | Type errors (the build also fails on these)                                                         |
| `lint`          | Including the services-layer import boundary                                                        |
| `format:check`  | Prettier drift. **The most commonly forgotten step.**                                               |
| `test:coverage` | Tests **+ coverage floors** (statements/lines 80, functions/branches 68) **+ all the drift guards** |
| `build`         | Next.js build                                                                                       |
| `pages:build`   | **The actual Cloudflare artifact — CI ONLY, see below**                                             |

If `format:check` fails: `npm run format`, then re-run.

### ⚠️ You cannot build the deployable artifact on Windows

`npm run pages:build` fails on Windows with `spawn npx ENOENT` (an upstream `@cloudflare/next-on-pages`
bug). A green `next build` does **not** prove the edge bundle builds.

**Therefore: CI is the only trustworthy build gate.** Never call a change done until the GitHub Actions
`verify` job's final step (_Edge bundle_) is green. `npm run test:coverage` locally does catch the most
common cause (an API route missing `export const runtime = 'edge'`).

### The drift guards inside the test suite

Three tests fail if you changed something without regenerating its companion file:

| Test fails         | Fix                                                                |
| ------------------ | ------------------------------------------------------------------ |
| `setup-sql-parity` | `npm run seed:gen && npm run setup:sql`                            |
| `openapi-fresh`    | `npm run openapi:write`                                            |
| `catch-up-parity`  | See [database.md](database.md) — you shipped a stale function body |

---

## Recipes

### Change an API request or response shape

1. Edit the schema in `src/lib/validation/`.
2. `npm run openapi:write` and commit `openapi.json`.

### Add a new API route

Create `app/api/v1/<thing>/route.ts`, and **it must start with**:

```ts
export const runtime = 'edge';
```

Keep the handler thin: authenticate → rate-limit → call a service → return. Put logic in
`src/lib/services/`.

### Add a new public page whose title the SEO hire can edit

Two steps — **both required**, or the editor shows a row that silently does nothing:

1. Add `{ path, label, defaultTitle, defaultDescription }` to `SEO_PAGES` in
   `src/lib/seo/page-registry.ts`.
2. In the page, return `overrideMetadata('/your-path', DEFAULT_METADATA)` from `generateMetadata`.

> If your default title already contains the brand, it **must** be `title: { absolute: … }` — otherwise
> the root template appends a second one: _"Contact Belle Mare Tours | Belle Mare Tours"_.

### Change how something is priced

Prices are computed in SQL. Do **not** move the calculation into TypeScript.

1. Edit the pricing SQL (`create_booking`, or the relevant fare function) in a **new migration**, and
   mirror it into `supabase/catch-up.sql`. Read [database.md](database.md) first — re-defining a function
   is the single most dangerous edit in this repo.
2. Mirror the same maths in `src/lib/services/pricing.ts` so the widget _displays_ what the server will
   charge. This mirror is cosmetic; the server figure always wins.
3. Never add a `price` or `total` field to a request payload.

### Add a field to the activity editor

`activities.extra` is a JSON blob. Adding a key means touching **three** places — miss one and the field
silently doesn't persist:

1. `activityExtraSchema` in `src/lib/validation/tours.ts`
2. `buildExtra()` **and** `loadActivity()` in `src/lib/admin/activity-write.ts`
3. `ActivityForm.tsx`

And add the key to `MANAGED_EXTRA_KEYS`. `buildExtra()` deliberately **merges** rather than rebuilds,
because rebuilding once silently wiped keys that a SQL patch had set.

### Add a translation

French only. The lookup is an **exact match on the English source string** — including curly apostrophes
(`’`) and em-dashes (`—`). A near-miss falls back to English with no error. This shipped as a real P1
once: French customers saw English on the checkout flow.

When you change a string passed to `t(...)`, update the key in `src/lib/i18n/messages.ts` in the same
commit.

---

## Testing

```bash
npm test              # everything
npm run test:watch    # while developing
npm run test:coverage # what CI runs
npm run test:e2e      # Playwright smoke
```

**Integration tests run against real Postgres** — PGlite, in-process. `createTestDb()` applies the auth
shim and then every migration in filename order, so RLS policies, plpgsql and constraints behave exactly
as in production.

```ts
const db = await createTestDb();
await db.as({ sub: USER_ID, role: 'authenticated' }); // become a user — RLS applies
await db.asOwner(); // bypass RLS to seed
```

**Its one limitation:** a single connection. It proves logic (capacity maths, idempotency, policies) but
**not** race conditions. Oversell and double-charge races must be prevented by `SELECT FOR UPDATE` and
unique constraints in SQL — not by tests.

Calling a new RPC from a service? Add its name to `ALLOWED` in `tests/db/rpc.ts`, or every test that
touches it fails with `unknown rpc <fn>`.

---

## Git

This project **commits directly to `main`** (the owner's explicit preference). No feature branches.

Cloudflare Pages deploys whatever lands on `main`, so: run the gate, push, **watch CI**, then check
`/api/v1/health`.
