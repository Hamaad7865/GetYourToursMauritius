# Admin Roles & Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner-only `/admin/roles` module where the owner creates roles (admin sections + money switches), puts team members into them by email, and the database refuses price, currency and refund changes to anyone whose role lacks them.

**Architecture:** Roles are permission bundles (`team_roles`) layered on today's `user_role` enum, which stays the data floor (`staff` = team base, `seo` = content base, `admin` = Owner). One SQL migration adds the catalogue, `is_admin()` / `has_permission()`, an owner-only profile guard, the team RPCs and the money locks. The browser loads the caller's access once (`api_my_access`) into an `AdminAccessProvider`; navigation, a page guard in `AdminShell` and the money widgets read it. Server routes use one helper that reads `profiles` + `team_roles` through the service-role client.

**Tech Stack:** Postgres (plpgsql, RLS) via Supabase; PGlite for integration tests; Next.js 15 (edge runtime) + React client components; Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-25-admin-roles-design.md`](../specs/2026-10-25-admin-roles-design.md)

---

## Ground rules for this plan (read before Task 1)

- **Work on `main` in this checkout — no branches, no worktrees — commit after every task, never
  `git add -A`** (owner's rule). This holds whichever execution skill runs the plan. Stage the exact
  files listed.
- **Do NOT `git push` until Task 17.** A push to `main` deploys the web app AND runs `supabase db push`
  on production. The migration file is built up across Tasks 2–7; once a version is pushed it is
  immutable (see `docs/handbook/database.md` "appending to a migration that has already run").
- Commit from the **Bash** tool with a heredoc (PowerShell heredocs are a parse error and PowerShell
  adds a BOM to commit subjects). End every message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before Task 2, confirm the migration name still sorts last:
  `ls supabase/migrations | tail -1` must print `20261025130000_reschedule_transfer_return_date.sql`.
  If something newer exists, pick a timestamp after it and use that name everywhere this plan says
  `20261025140000_admin_roles`.
- Single test file: `npx vitest run <path>`. Single test: `npx vitest run <path> -t "<name>"`.

## File structure

**Create**

| File                                                 | Responsibility                                                                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/20261025140000_admin_roles.sql` | Catalogue, `team_roles`, guards, RPCs, money locks, refund guards, Content backfill                              |
| `src/lib/admin/permissions.ts`                       | The permission catalogue as data; `AdminAccess`, `buildAccess`, `can`, `roleLabel` (pure, no React)              |
| `src/lib/admin/team.ts`                              | Browser calls: `loadMyAccess`, `loadRoles`, `saveRole`, `deleteRole`, `loadTeam`, `assignMember`, `removeMember` |
| `src/lib/http/access.ts`                             | Server: `loadCallerAccess(db, userId)` through the service-role client                                           |
| `src/components/admin/AdminAccessProvider.tsx`       | Loads access once; `useAdminAccess()`                                                                            |
| `src/components/admin/AdminRoles.tsx`                | The Roles + Team screen                                                                                          |
| `app/(site)/admin/roles/page.tsx`                    | Route                                                                                                            |
| `tests/db/team.ts`                                   | `seedTeamRole()` test helper                                                                                     |
| `tests/unit/admin-permissions.test.ts`               | Catalogue, access, nav, page coverage                                                                            |
| `tests/integration/admin-roles.test.ts`              | Every database rule in the migration                                                                             |
| `tests/integration/admin-team-lib.test.ts`           | `src/lib/admin/team.ts` + `src/lib/http/access.ts` against PGlite                                                |

**Modify**

| File                                                                                                                                                                                                                                                             | Change                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `supabase/catch-up.sql`, `supabase/backfill-migration-ledger.sql`, `supabase/setup.sql`                                                                                                                                                                          | Mirror / ledger / regenerate                               |
| `src/lib/supabase/types.ts`                                                                                                                                                                                                                                      | `team_roles`, `profiles.team_role_id`, new functions       |
| `tests/db/rpc.ts`                                                                                                                                                                                                                                                | `ALLOWED` += 4 RPCs                                        |
| `tests/integration/definer-grants-lockdown.test.ts`, `rpc-grants.test.ts`, `resolved-function-bodies.test.ts`                                                                                                                                                    | New guards                                                 |
| `tests/integration/admin-mark-refunded.test.ts`, `quote-deposit-refund.test.ts`, `booking-change-option.test.ts`, `admin-quote-send.test.ts`, `admin-quote-balance.test.ts`, `admin-quote-draft-from-email.test.ts`                                              | Staff fixtures get a team role                             |
| `app/api/v1/admin/assistant/route.ts`, `.../installments/[seq]/remind/route.ts`, `.../quotes/send/route.ts`, `.../quotes/[ref]/balance/route.ts`, `.../quotes/draft-from-email/route.ts`, `.../documents/[id]/pdf/route.ts`, `.../documents/[id]/email/route.ts` | Permission check via `loadCallerAccess`                    |
| `app/(site)/admin/layout.tsx`                                                                                                                                                                                                                                    | Mount `AdminAccessProvider`                                |
| `src/components/admin/nav.ts`, `AdminShell.tsx`                                                                                                                                                                                                                  | Permission per item, `navFor`, page guard                  |
| `tests/unit/admin-quotes-editor.test.ts`                                                                                                                                                                                                                         | `navForRole` → `navFor`                                    |
| `src/lib/admin/dashboard.ts`, `src/components/admin/AdminDashboard.tsx`                                                                                                                                                                                          | Revenue + pending total behind `money.revenue`             |
| `src/components/admin/AdminBookings.tsx`, `BookingChangePanel.tsx`                                                                                                                                                                                               | CSV behind `money.reports`; refunds behind `money.refunds` |
| `src/components/admin/AdminQuotes.tsx`, `documents/DetailsPane.tsx`                                                                                                                                                                                              | Internal notes behind `money.notes`                        |
| `src/lib/admin/activity-write.ts`, `src/components/admin/ActivityForm.tsx`                                                                                                                                                                                       | `pricingLocked` save path                                  |
| `src/components/admin/AdminVehiclePricing.tsx`, `AdminRentalFleet.tsx`                                                                                                                                                                                           | Fares/currency/rates by permission                         |
| Docs: `docs/handbook/database.md`, `operations.md`, `services.md`, `docs/db-prod-test-split.md`, `CLAUDE.md`, the spec                                                                                                                                           | Roles now managed in `/admin/roles`                        |

---

### Task 1: The permission catalogue (TypeScript)

> **Built, then hardened after review (f00059a3):** `buildAccess` takes no `base` input — it derives
> `base` from `role` (`staff` → team, `seo` → content), nulls the team fields for every other role, and
> ignores a malformed `permissions` value instead of throwing. Later tasks below call it without `base`.

**Files:**

- Create: `src/lib/admin/permissions.ts`
- Test: `tests/unit/admin-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/admin-permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  CONTENT_PERMISSIONS,
  MONEY_PERMISSIONS,
  NO_ACCESS,
  SECTION_PERMISSIONS,
  buildAccess,
  can,
  isPermissionKey,
  roleLabel,
} from '@/lib/admin/permissions';

describe('the permission catalogue', () => {
  it('has unique keys, sections first then money', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    expect(ALL_PERMISSIONS).toHaveLength(SECTION_PERMISSIONS.length + MONEY_PERMISSIONS.length);
    expect(ALL_PERMISSIONS.every((k) => k.startsWith('section.') || k.startsWith('money.'))).toBe(
      true,
    );
  });

  it('lets content-only roles hold exactly the five content sections', () => {
    expect([...CONTENT_PERMISSIONS].sort()).toEqual([
      'section.blog',
      'section.places',
      'section.redirects',
      'section.seo',
      'section.tours',
    ]);
    expect(MONEY_PERMISSIONS.some((p) => p.contentAllowed)).toBe(false);
  });

  it('recognises only catalogue keys', () => {
    expect(isPermissionKey('money.refunds')).toBe(true);
    expect(isPermissionKey('money.everything')).toBe(false);
  });
});

describe('buildAccess', () => {
  it('gives the Owner every permission', () => {
    const a = buildAccess({ role: 'admin' });
    expect(a.isOwner).toBe(true);
    expect([...a.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());
    expect(roleLabel(a)).toBe('Owner');
  });

  it('gives a team member only their keys, dropping unknown ones', () => {
    const a = buildAccess({
      role: 'staff',
      teamRoleId: 'r1',
      teamRoleName: 'Reservations',
      base: 'team',
      permissions: ['section.bookings', 'section.quotes', 'money.everything'],
    });
    expect(a.isOwner).toBe(false);
    expect([...a.permissions].sort()).toEqual(['section.bookings', 'section.quotes']);
    expect(roleLabel(a)).toBe('Reservations');
  });

  it('never lets a content member hold a guest or money key, whatever the row says', () => {
    const a = buildAccess({
      role: 'seo',
      teamRoleId: 'r2',
      teamRoleName: 'Content',
      base: 'content',
      permissions: ['section.blog', 'section.bookings', 'money.reports'],
    });
    expect([...a.permissions]).toEqual(['section.blog']);
  });

  it('fails closed: staff with no team role, customers and nobody get nothing', () => {
    expect(buildAccess({ role: 'staff' }).permissions.size).toBe(0);
    expect(
      buildAccess({ role: 'customer', permissions: ['section.bookings'] }).permissions.size,
    ).toBe(0);
    expect(buildAccess({ role: null }).permissions.size).toBe(0);
    expect(NO_ACCESS.permissions.size).toBe(0);
    expect(roleLabel(buildAccess({ role: 'staff' }))).toBe('No role yet');
  });
});

describe('can', () => {
  const a = buildAccess({
    role: 'staff',
    teamRoleId: 'r',
    base: 'team',
    permissions: ['money.prices'],
  });

  it('checks one key', () => {
    expect(can(a, 'money.prices')).toBe(true);
    expect(can(a, 'money.currency')).toBe(false);
  });

  it('treats a list as any-of', () => {
    expect(can(a, ['money.currency', 'money.prices'])).toBe(true);
    expect(can(a, ['money.currency', 'money.refunds'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/admin-permissions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/admin/permissions"`.

- [ ] **Step 3: Write the module**

Create `src/lib/admin/permissions.ts`:

```ts
/**
 * The back office's permission catalogue, as DATA.
 *
 * A role (`team_roles`) is a list of these keys. The list is fixed here and mirrored, key for key, by
 * `permission_catalogue()` / `content_permission_catalogue()` in 20261025140000_admin_roles.sql, which
 * the `team_roles.permissions` CHECK uses — tests/integration/admin-roles.test.ts asserts the two lists
 * are identical, so adding a key means a migration as well as an entry here.
 *
 * `contentAllowed` marks the keys a "Content only" role (profiles.role = 'seo') may hold. It is exactly
 * the set the old `seo: true` nav flag covered, so the SEO account keeps what it had.
 *
 * Pure on purpose (no React, no Supabase): the browser, the server routes and the tests share it.
 */
export const SECTION_PERMISSIONS = [
  {
    key: 'section.bookings',
    label: 'Bookings',
    hint: 'Guests, payments status, the booking drawer',
    contentAllowed: false,
  },
  {
    key: 'section.calendar',
    label: 'Calendar',
    hint: 'Departures and guest day sheets',
    contentAllowed: false,
  },
  {
    key: 'section.quotes',
    label: 'Quotes',
    hint: 'Build, send and follow up offers',
    contentAllowed: false,
  },
  {
    key: 'section.documents',
    label: 'Documents',
    hint: 'Standalone quotes, invoices and receipts',
    contentAllowed: false,
  },
  { key: 'section.leads', label: 'Leads', hint: 'Enquiries from the site', contentAllowed: false },
  {
    key: 'section.reviews',
    label: 'Reviews',
    hint: 'Approve guest reviews',
    contentAllowed: false,
  },
  {
    key: 'section.assistant',
    label: 'AI assistant',
    hint: 'The “Ask Gemini” panel',
    contentAllowed: false,
  },
  {
    key: 'section.tours',
    label: 'Tours',
    hint: 'Tour pages, photos, French',
    contentAllowed: true,
  },
  {
    key: 'section.categories',
    label: 'Categories',
    hint: 'Catalogue categories',
    contentAllowed: false,
  },
  {
    key: 'section.content',
    label: 'Standard content',
    hint: 'Default inclusions and highlights',
    contentAllowed: false,
  },
  { key: 'section.rental', label: 'Rental', hint: 'Car and scooter fleet', contentAllowed: false },
  { key: 'section.places', label: 'Places', hint: 'Planner places', contentAllowed: true },
  { key: 'section.seo', label: 'SEO', hint: 'Page titles and descriptions', contentAllowed: true },
  { key: 'section.blog', label: 'Blog', hint: 'Posts', contentAllowed: true },
  {
    key: 'section.redirects',
    label: 'Redirects',
    hint: 'Old URLs to live pages',
    contentAllowed: true,
  },
] as const;

export const MONEY_PERMISSIONS = [
  {
    key: 'money.reports',
    label: 'Reports & exports',
    hint: 'P&L, VAT and the CSV downloads',
    contentAllowed: false,
  },
  {
    key: 'money.revenue',
    label: 'Dashboard revenue',
    hint: 'Revenue and pending-payment totals on the dashboard',
    contentAllowed: false,
  },
  {
    key: 'money.prices',
    label: 'Edit prices & fares',
    hint: 'Tour prices, supplements, transfer fares, rental rates',
    contentAllowed: false,
  },
  {
    key: 'money.currency',
    label: 'Currency & exchange rate',
    hint: 'Charge in MUR or EUR, and the EUR→MUR rate',
    contentAllowed: false,
  },
  {
    key: 'money.refunds',
    label: 'Refunds',
    hint: 'Mark a booking refunded, record a change-of-tour refund',
    contentAllowed: false,
  },
  {
    key: 'money.notes',
    label: 'Internal notes',
    hint: 'Margin notes on quotes and documents',
    contentAllowed: false,
  },
] as const;

export type PermissionKey =
  | (typeof SECTION_PERMISSIONS)[number]['key']
  | (typeof MONEY_PERMISSIONS)[number]['key'];

export interface PermissionMeta {
  key: PermissionKey;
  label: string;
  hint: string;
  contentAllowed: boolean;
}

const ALL_META: readonly PermissionMeta[] = [...SECTION_PERMISSIONS, ...MONEY_PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionKey[] = ALL_META.map((p) => p.key);
export const CONTENT_PERMISSIONS: readonly PermissionKey[] = ALL_META.filter(
  (p) => p.contentAllowed,
).map((p) => p.key);

const KNOWN = new Set<string>(ALL_PERMISSIONS);
const CONTENT = new Set<string>(CONTENT_PERMISSIONS);

export function isPermissionKey(value: string): value is PermissionKey {
  return KNOWN.has(value);
}

export type RoleBase = 'team' | 'content';

/** What the signed-in person may open and do in /admin. */
export interface AdminAccess {
  /** profiles.role — 'admin' (Owner), 'staff' (team base), 'seo' (content base), or 'customer'. */
  role: string | null;
  isOwner: boolean;
  teamRoleId: string | null;
  teamRoleName: string | null;
  base: RoleBase | null;
  permissions: ReadonlySet<PermissionKey>;
}

export const NO_ACCESS: AdminAccess = {
  role: null,
  isOwner: false,
  teamRoleId: null,
  teamRoleName: null,
  base: null,
  permissions: new Set(),
};

/**
 * Normalise whatever the database returned into an AdminAccess. The Owner gets every key; a team
 * member gets their role's known keys; a content member additionally loses any non-content key (the
 * database refuses to store one, this is the second lock); everyone else gets nothing — FAIL CLOSED.
 */
export function buildAccess(input: {
  role: string | null;
  teamRoleId?: string | null;
  teamRoleName?: string | null;
  base?: string | null;
  permissions?: readonly string[] | null;
}): AdminAccess {
  const role = input.role ?? null;
  const isOwner = role === 'admin';
  const base: RoleBase | null =
    input.base === 'team' || input.base === 'content' ? input.base : null;
  let keys: PermissionKey[] = [];
  if (isOwner) keys = [...ALL_PERMISSIONS];
  else if (role === 'staff' || role === 'seo') {
    keys = (input.permissions ?? []).filter(isPermissionKey);
    if (role === 'seo') keys = keys.filter((k) => CONTENT.has(k));
  }
  return {
    role,
    isOwner,
    teamRoleId: isOwner ? null : (input.teamRoleId ?? null),
    teamRoleName: isOwner ? null : (input.teamRoleName ?? null),
    base: isOwner ? null : base,
    permissions: new Set(keys),
  };
}

/** True when the access holds `need` — or, for a list, ANY of it. */
export function can(access: AdminAccess, need: PermissionKey | readonly PermissionKey[]): boolean {
  const keys = typeof need === 'string' ? [need] : need;
  return keys.some((k) => access.permissions.has(k));
}

/** The label shown under the person's name in the sidebar. */
export function roleLabel(access: AdminAccess): string {
  if (access.isOwner) return 'Owner';
  return access.teamRoleName ?? 'No role yet';
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/admin-permissions.test.ts`
Expected: PASS (9 tests).

Then `npx prettier --write src/lib/admin/permissions.ts tests/unit/admin-permissions.test.ts` (the
catalogue rows are long; let Prettier wrap them).

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/permissions.ts tests/unit/admin-permissions.test.ts
git commit -F - <<'EOF'
feat(admin): permission catalogue for owner-managed roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Migration §1–2 — catalogue, `team_roles`, `is_admin()`, `has_permission()`

**Files:**

- Create: `supabase/migrations/20261025140000_admin_roles.sql`
- Create: `tests/db/team.ts`
- Test: `tests/integration/admin-roles.test.ts`

- [ ] **Step 1: Write the test helper**

Create `tests/db/team.ts`:

```ts
import type { TestDb } from './pglite';
import type { PermissionKey } from '@/lib/admin/permissions';

/**
 * Give `userId` a team role holding exactly `permissions`, as the table owner (RLS bypassed), and set
 * the matching profiles.role ('staff' for a team role, 'seo' for a content one). The profile row must
 * already exist. Returns the new role's id. Leaves the session in the OWNER context — call db.as(...)
 * afterwards to act as someone.
 */
export async function seedTeamRole(
  db: TestDb,
  userId: string,
  permissions: readonly PermissionKey[],
  base: 'team' | 'content' = 'team',
): Promise<string> {
  await db.asOwner();
  const name = `Test role ${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await db.pg.query<{ id: string }>(
    `insert into team_roles (name, base, permissions)
     values ($1, $2, (select coalesce(array_agg(k), '{}') from jsonb_array_elements_text($3::jsonb) k))
     returning id`,
    [name, base, JSON.stringify(permissions)],
  );
  const id = rows[0]!.id;
  await db.pg.query(`update profiles set role = $2::user_role, team_role_id = $3 where id = $1`, [
    userId,
    base === 'content' ? 'seo' : 'staff',
    id,
  ]);
  return id;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/integration/admin-roles.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedTeamRole } from '../db/team';
import { ALL_PERMISSIONS, CONTENT_PERMISSIONS } from '@/lib/admin/permissions';

/**
 * Every database rule behind /admin/roles (20261025140000_admin_roles). Real Postgres: the RLS, the
 * triggers and the definer RPCs run exactly as in production. The rule that matters most is the one
 * the old schema got wrong — any is_staff() caller could change any profile's role, so a staff member
 * could make themselves admin.
 */

const OWNER = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a';
const OWNER2 = '0b0b0b0b-0b0b-0b0b-0b0b-0b0b0b0b0b0b';
const WORKER = '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a';
const WRITER = '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a';
const BARE = '3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a';
const GUEST = '4a4a4a4a-4a4a-4a4a-4a4a-4a4a4a4a4a4a';

const PEOPLE: Array<[string, string, string]> = [
  [OWNER, 'owner@example.com', 'admin'],
  [WORKER, 'worker@example.com', 'staff'],
  [WRITER, 'writer@example.com', 'seo'],
  [BARE, 'bare@example.com', 'staff'],
  [GUEST, 'guest@example.com', 'customer'],
];

async function seedPeople(db: TestDb, people = PEOPLE): Promise<void> {
  await db.asOwner();
  for (const [id, email, role] of people) {
    await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, $2, $3::user_role)`, [
      id,
      email.split('@')[0],
      role,
    ]);
  }
}

const asUser = (db: TestDb, sub: string) => db.as({ sub, role: 'authenticated' });

/** The error message a statement raised, or '' when it succeeded. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

async function one<T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.pg.query<{ v: T }>(sql, params);
  return rows[0]!.v;
}

describe('the permission catalogue in SQL matches src/lib/admin/permissions.ts', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.close());

  it('permission_catalogue() lists exactly ALL_PERMISSIONS', async () => {
    const sql = await one<string[]>(db, `select permission_catalogue() as v`);
    expect([...sql].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('content_permission_catalogue() lists exactly CONTENT_PERMISSIONS', async () => {
    const sql = await one<string[]>(db, `select content_permission_catalogue() as v`);
    expect([...sql].sort()).toEqual([...CONTENT_PERMISSIONS].sort());
  });
});

describe('has_permission / is_admin', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    await seedTeamRole(db, WORKER, ['section.bookings', 'money.prices']);
    await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  });
  afterAll(async () => db.close());

  const has = (key: string) => one<boolean>(db, `select has_permission($1) as v`, [key]);

  it('the Owner holds every key and is_admin()', async () => {
    await asUser(db, OWNER);
    expect(await has('money.refunds')).toBe(true);
    expect(await one<boolean>(db, `select is_admin() as v`)).toBe(true);
  });

  it('a team member holds only their role’s keys', async () => {
    await asUser(db, WORKER);
    expect(await has('section.bookings')).toBe(true);
    expect(await has('money.prices')).toBe(true);
    expect(await has('money.refunds')).toBe(false);
    expect(await one<boolean>(db, `select is_admin() as v`)).toBe(false);
  });

  it('a content member holds their content keys', async () => {
    await asUser(db, WRITER);
    expect(await has('section.blog')).toBe(true);
    expect(await has('section.tours')).toBe(false);
  });

  it('fails closed for staff without a role, customers and anonymous callers', async () => {
    await asUser(db, BARE);
    expect(await has('section.bookings')).toBe(false);
    await asUser(db, GUEST);
    expect(await has('section.bookings')).toBe(false);
    await db.as(null);
    expect(await has('section.bookings')).toBe(false);
  });
});

describe('team_roles', () => {
  let db: TestDb;
  let workerRole: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    workerRole = await seedTeamRole(db, WORKER, ['section.quotes']);
  });
  afterAll(async () => db.close());

  const insertRole = (name: string, base: string, perms: string[]) =>
    db.pg.query<{ id: string; permissions: string[] }>(
      `insert into team_roles (name, base, permissions)
       values ($1, $2, (select coalesce(array_agg(k), '{}') from jsonb_array_elements_text($3::jsonb) k))
       returning id, permissions`,
      [name, base, JSON.stringify(perms)],
    );

  it('only the Owner may create a role', async () => {
    await asUser(db, WORKER);
    expect(await failure(insertRole('Sneaky', 'team', ['money.refunds']))).toMatch(
      /row-level security/,
    );
    await asUser(db, OWNER);
    const { rows } = await insertRole('  Reservations  ', 'team', [
      'section.quotes',
      'section.bookings',
      'section.quotes',
    ]);
    // Trimmed name, de-duplicated and sorted keys.
    const row = (
      await db.pg.query<{ name: string; permissions: string[] }>(
        `select name, permissions from team_roles where id = $1`,
        [rows[0]!.id],
      )
    ).rows[0]!;
    expect(row.name).toBe('Reservations');
    expect(row.permissions).toEqual(['section.bookings', 'section.quotes']);
  });

  it('refuses an unknown key and a duplicate name', async () => {
    await asUser(db, OWNER);
    expect(await failure(insertRole('Bad key', 'team', ['money.everything']))).toMatch(/check/i);
    await insertRole('Drivers', 'team', []);
    expect(await failure(insertRole('drivers ', 'team', []))).toMatch(/team_roles_name_key/);
  });

  it('a content-only role cannot hold a guest or money key', async () => {
    await asUser(db, OWNER);
    expect(await failure(insertRole('Writers+', 'content', ['section.bookings']))).toMatch(
      /content_role_permission/,
    );
    expect(await failure(insertRole('Writers$', 'content', ['money.reports']))).toMatch(
      /content_role_permission/,
    );
    expect(await failure(insertRole('Writers', 'content', ['section.blog']))).toBe('');
  });

  it('base access cannot change after creation', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update team_roles set base = 'content' where id = $1`, [workerRole]),
      ),
    ).toMatch(/team_role_base_immutable/);
  });

  it('a role with members cannot be deleted; an empty one can', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(db.pg.query(`delete from team_roles where id = $1`, [workerRole])),
    ).toMatch(/team_role_id_fkey/);
    const { rows } = await insertRole('Temporary', 'team', []);
    expect(await failure(db.pg.query(`delete from team_roles where id = $1`, [rows[0]!.id]))).toBe(
      '',
    );
  });

  it('a member reads their own role only; anonymous callers have no privilege at all', async () => {
    await asUser(db, WORKER);
    const { rows } = await db.pg.query<{ id: string }>(`select id from team_roles`);
    expect(rows.map((r) => r.id)).toEqual([workerRole]);
    await db.asOwner();
    expect(
      await one<boolean>(
        db,
        `select has_table_privilege('anon', 'public.team_roles', 'select') as v`,
      ),
    ).toBe(false);
    expect(
      await one<boolean>(
        db,
        `select has_table_privilege('authenticated', 'public.team_roles', 'insert') as v`,
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: FAIL — `function permission_catalogue() does not exist` (and `relation "team_roles" does not exist`).

- [ ] **Step 4: Write migration §1–2**

Create `supabase/migrations/20261025140000_admin_roles.sql`:

```sql
-- 20261025140000_admin_roles
--
-- Owner-managed roles for the back office. Spec: docs/superpowers/specs/2026-10-25-admin-roles-design.md
--
-- Until now `staff` and `admin` were identical everywhere (is_staff() = role in ('staff','admin')), so
-- the owner could not give the people who work with them access to quotes and bookings without also
-- giving them revenue, the P&L/VAT report, fares, the exchange rate and refunds. And enforce_profile_role
-- let ANY is_staff() caller set ANY profile's role — a staff member could make themselves admin.
--
-- This migration:
--   1. a fixed permission catalogue (mirrored by src/lib/admin/permissions.ts; a test pins the two);
--   2. team_roles — owner-defined bundles of those keys; profiles.team_role_id points at one;
--      is_admin() / has_permission(key) for RLS and RPCs;
--   3. the profile guard: only the Owner (role 'admin') changes role / team_role_id; a team role must
--      match its base; the last Owner can never be demoted or deleted;
--   4. the owner-only team RPCs (api_my_access, api_team_list, api_team_assign, api_team_remove);
--   5. money locks: price tables need money.prices to write; price columns on mixed tables need it too;
--      the charge currency and rate need money.currency;
--   6. refunds need money.refunds (api_mark_refunded, api_record_change_refund);
--   7. a "Content" role for the existing seo account(s).
--
-- user_role stays the DATA floor: a team role's members are 'staff' (base 'team', is_staff()) or 'seo'
-- (base 'content', is_content_editor() only). Nothing here widens what any role could read before.
-- Role comparisons use role::text: Postgres forbids USING an enum value added in the same transaction
-- ('seo' was added by 20260810000000), and catch-up.sql runs as one script.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

-- ── 1) The permission catalogue ─────────────────────────────────────────────────────────────────
create or replace function permission_catalogue()
returns text[]
language sql
immutable
as $$
  select array[
    'section.bookings', 'section.calendar', 'section.quotes', 'section.documents',
    'section.leads', 'section.reviews', 'section.assistant', 'section.tours',
    'section.categories', 'section.content', 'section.rental', 'section.places',
    'section.seo', 'section.blog', 'section.redirects',
    'money.reports', 'money.revenue', 'money.prices', 'money.currency', 'money.refunds',
    'money.notes'
  ]::text[];
$$;

-- The keys a content-only role may hold — the sections the seo role could already reach.
create or replace function content_permission_catalogue()
returns text[]
language sql
immutable
as $$
  select array['section.tours', 'section.places', 'section.seo', 'section.blog', 'section.redirects']::text[];
$$;

-- ── 2) team_roles + profiles.team_role_id ───────────────────────────────────────────────────────
create table if not exists team_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 60),
  description text check (description is null or length(description) <= 300),
  base text not null check (base in ('team', 'content')),
  permissions text[] not null default '{}' check (permissions <@ permission_catalogue()),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id) on delete set null
);
create unique index if not exists team_roles_name_key on team_roles (lower(btrim(name)));

-- ON DELETE RESTRICT is the "a role with members cannot be deleted" rule.
alter table profiles
  add column if not exists team_role_id uuid references team_roles (id) on delete restrict;
create index if not exists profiles_team_role_idx on profiles (team_role_id)
  where team_role_id is not null;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role::text = 'admin');
$$;

-- True for the Owner; for a 'staff'/'seo' member, when their team role holds the key; false for
-- everyone else (no profile, no team role, a customer, anonymous) — fail closed.
create or replace function has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select pr.role::text = 'admin'
           or (pr.role::text in ('staff', 'seo')
               and p_key = any(coalesce(tr.permissions, '{}'::text[])))
      from profiles pr
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.id = auth.uid()
  ), false);
$$;

-- Both are read inside RLS policies, which anon and authenticated evaluate, so both may execute them.
-- They only ever answer about the caller.
revoke execute on function is_admin() from public;
revoke execute on function has_permission(text) from public;
grant execute on function is_admin() to anon, authenticated, service_role;
grant execute on function has_permission(text) to anon, authenticated, service_role;

-- Normalise and police every team_roles write: trimmed name, de-duplicated sorted keys, a content role
-- holds only content keys, and `base` is fixed once the role exists (its members' profiles.role
-- depends on it).
create or replace function enforce_team_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.base is distinct from old.base then
    raise exception 'team_role_base_immutable';
  end if;
  new.name := btrim(new.name);
  new.permissions := array(
    select distinct k from unnest(coalesce(new.permissions, '{}'::text[])) k order by k
  );
  if new.base = 'content' and not (new.permissions <@ content_permission_catalogue()) then
    raise exception 'content_role_permission'
      using detail = 'a content-only role can hold only Tours, Places, SEO, Blog and Redirects';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists team_roles_guard on team_roles;
create trigger team_roles_guard
  before insert or update on team_roles
  for each row execute function enforce_team_role();

revoke execute on function enforce_team_role() from public, anon, authenticated;
grant execute on function enforce_team_role() to service_role;

alter table team_roles enable row level security;

-- The Owner reads every role; a member reads their own (the browser shows its name).
drop policy if exists team_roles_read on team_roles;
create policy team_roles_read on team_roles for select using (
  (select is_admin())
  or id = (select pr.team_role_id from profiles pr where pr.id = auth.uid())
);
drop policy if exists team_roles_owner_write on team_roles;
create policy team_roles_owner_write on team_roles for all
  using ((select is_admin())) with check ((select is_admin()));

-- A table created after 20260615120800's one-time blanket grant states its own privileges. Supabase's
-- default privileges hand anon ALL on a new table (DELETE included), so revoke it explicitly.
revoke all on team_roles from anon;
grant select, insert, update, delete on team_roles to authenticated;
grant all on team_roles to service_role;
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: PASS (all tests in the three describe blocks).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/db/team.ts tests/integration/admin-roles.test.ts
git commit -F - <<'EOF'
feat(db): team_roles, is_admin() and has_permission() for admin roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Migration §3 — the profile guard (no self-promotion, pairing, last Owner)

**Files:**

- Modify: `supabase/migrations/20261025140000_admin_roles.sql` (append)
- Test: `tests/integration/admin-roles.test.ts` (append a describe)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/admin-roles.test.ts`:

```ts
describe('the profile guard', () => {
  let db: TestDb;
  let workerRole: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [...PEOPLE, [OWNER2, 'owner2@example.com', 'customer']]);
    workerRole = await seedTeamRole(db, WORKER, ['section.bookings']);
  });
  afterAll(async () => db.close());

  const roleOf = async (id: string) => {
    await db.asOwner();
    return (
      await db.pg.query<{ role: string; team_role_id: string | null }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [id],
      )
    ).rows[0]!;
  };

  it('a staff member cannot make themselves admin', async () => {
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set role = 'admin' where id = $1`, [WORKER]);
    expect((await roleOf(WORKER)).role).toBe('staff');
  });

  it('a staff member cannot change their own or anyone’s team role', async () => {
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set team_role_id = null where id = $1`, [WORKER]);
    expect((await roleOf(WORKER)).team_role_id).toBe(workerRole);
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set role = 'staff' where id = $1`, [GUEST]);
    expect((await roleOf(GUEST)).role).toBe('customer');
  });

  it('a staff member cannot delete a profile or edit the Owner’s', async () => {
    await asUser(db, WORKER);
    const del = await db.pg.query(`delete from profiles where id = $1`, [GUEST]);
    expect(del.affectedRows).toBe(0);
    const upd = await db.pg.query(`update profiles set full_name = 'x' where id = $1`, [OWNER]);
    expect(upd.affectedRows).toBe(0);
  });

  it('a signed-up customer still cannot insert themselves as admin', async () => {
    const NEWBIE = '5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a';
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [NEWBIE]);
    await asUser(db, NEWBIE);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [NEWBIE]);
    expect((await roleOf(NEWBIE)).role).toBe('customer');
  });

  it('a team role must match the profile’s base', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update profiles set role = 'admin', team_role_id = $2 where id = $1`, [
          GUEST,
          workerRole,
        ]),
      ),
    ).toMatch(/team_role_mismatch/);
    expect(
      await failure(
        db.pg.query(`update profiles set role = 'seo', team_role_id = $2 where id = $1`, [
          GUEST,
          workerRole,
        ]),
      ),
    ).toMatch(/team_role_mismatch/);
  });

  it('the last Owner cannot be demoted or deleted — not even by themselves', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(db.pg.query(`update profiles set role = 'customer' where id = $1`, [OWNER])),
    ).toMatch(/last_owner/);
    await db.asOwner();
    expect(await failure(db.pg.query(`delete from profiles where id = $1`, [OWNER]))).toMatch(
      /last_owner/,
    );
  });

  it('with a second Owner, one may step down', async () => {
    await asUser(db, OWNER);
    await db.pg.query(`update profiles set role = 'admin' where id = $1`, [OWNER2]);
    expect((await roleOf(OWNER2)).role).toBe('admin');
    await asUser(db, OWNER2);
    await db.pg.query(`update profiles set role = 'customer' where id = $1`, [OWNER2]);
    expect((await roleOf(OWNER2)).role).toBe('customer');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts -t "the profile guard"`
Expected: FAIL — `a staff member cannot make themselves admin` (the role became `admin`), and the
pairing / last-owner tests (no error raised).

- [ ] **Step 3: Append migration §3**

First confirm the winning body: `grep -ln "function enforce_profile_role" supabase/migrations/*.sql`
must print only `20260615121000_security_integrity_fixes.sql` (plus our file, once written). Then
append to `supabase/migrations/20261025140000_admin_roles.sql`:

```sql

-- ── 3) The profile guard ────────────────────────────────────────────────────────────────────────
-- Replaces 20260615121000's body, which let any is_staff() caller assign roles.
create or replace function enforce_profile_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_base text;
begin
  -- 1) WHO MAY CHANGE ACCESS: only the Owner, from a client. Everyone else's insert is forced to a
  --    plain customer and their updates keep the old values. service_role and the table owner (the
  --    definer RPCs below, migrations) pass through to the checks that bind everyone.
  if current_user in ('anon', 'authenticated') and not is_admin() then
    if tg_op = 'INSERT' then
      new.role := 'customer';
      new.team_role_id := null;
    else
      new.role := old.role;
      new.team_role_id := old.team_role_id;
    end if;
  end if;

  -- 2) THE PAIRING RULE, for every writer: a team role sits only on a 'staff' (base 'team') or 'seo'
  --    (base 'content') profile; Owner and customer profiles never carry one. v_base is null only when
  --    the caller cannot read the role (a non-admin re-saving someone else's unchanged row).
  if new.team_role_id is not null then
    select base into v_base from team_roles where id = new.team_role_id;
    if not (   (v_base = 'team' and new.role::text = 'staff')
            or (v_base = 'content' and new.role::text = 'seo')
            or (v_base is null and new.role::text in ('staff', 'seo'))) then
      raise exception 'team_role_mismatch';
    end if;
  end if;

  -- 3) THE LAST OWNER: nobody — the Owner included — demotes the only remaining Owner.
  if tg_op = 'UPDATE' and old.role::text = 'admin' and new.role::text <> 'admin'
     and not exists (select 1 from profiles where role::text = 'admin' and id <> old.id) then
    raise exception 'last_owner';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_role_guard on profiles;
create trigger profiles_role_guard
  before insert or update on profiles
  for each row execute function enforce_profile_role();

create or replace function enforce_last_owner_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.role::text = 'admin'
     and not exists (select 1 from profiles where role::text = 'admin' and id <> old.id) then
    raise exception 'last_owner';
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_last_owner_guard on profiles;
create trigger profiles_last_owner_guard
  before delete on profiles
  for each row execute function enforce_last_owner_delete();

revoke execute on function enforce_last_owner_delete() from public, anon, authenticated;
grant execute on function enforce_last_owner_delete() to service_role;

-- Policies. profiles_staff (FOR ALL using is_staff()) let staff DELETE any profile — including the
-- Owner's, which AuthProvider would then re-create as a customer. Reads stay with profiles_select;
-- updates move into profiles_update, which no longer reaches an Owner's row unless you are an Owner;
-- deletes are Owner-only.
drop policy if exists profiles_staff on profiles;
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or (is_staff() and (role::text <> 'admin' or (select is_admin()))))
  with check (id = auth.uid() or is_staff());
drop policy if exists profiles_owner_delete on profiles;
create policy profiles_owner_delete on profiles for delete using ((select is_admin()));
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: PASS (every describe so far).

- [ ] **Step 5: Run the existing profile/RLS suites — they must stay green**

Run: `npx vitest run tests/integration/rls.test.ts tests/integration/authz-integrity.test.ts tests/integration/gdpr-erase.test.ts`
Expected: PASS. If `gdpr-erase` fails with `last_owner`, the test erases its only admin: give its
fixture a second `admin` profile rather than weakening the guard.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/integration/admin-roles.test.ts
git commit -F - <<'EOF'
fix(db): only the owner can change roles; the last owner cannot be removed

Before this any is_staff() caller could set any profile's role, so a
staff member could promote themselves to admin or delete the owner's
profile row.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Migration §4 — the team RPCs

**Files:**

- Modify: `supabase/migrations/20261025140000_admin_roles.sql` (append)
- Test: `tests/integration/admin-roles.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/admin-roles.test.ts`:

```ts
describe('team RPCs', () => {
  let db: TestDb;
  let reservations: string;
  let content: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    reservations = await seedTeamRole(db, WORKER, ['section.bookings', 'section.quotes']);
    content = await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  });
  afterAll(async () => db.close());

  const call = <T>(fn: string, p: unknown) =>
    one<T>(db, `select ${fn}($1::jsonb) as v`, [JSON.stringify(p)]);

  it('api_my_access describes the caller', async () => {
    await asUser(db, OWNER);
    const owner = await call<{ role: string; permissions: string[] }>('api_my_access', {});
    expect(owner.role).toBe('admin');
    expect([...owner.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());

    await asUser(db, WORKER);
    const worker = await call<{ role: string; teamRoleId: string; permissions: string[] }>(
      'api_my_access',
      {},
    );
    expect(worker).toMatchObject({ role: 'staff', teamRoleId: reservations });
    expect(worker.permissions).toEqual(['section.bookings', 'section.quotes']);

    await asUser(db, GUEST);
    expect((await call<{ permissions: string[] }>('api_my_access', {})).permissions).toEqual([]);
  });

  it('api_team_list is Owner-only and lists everyone but customers, with email', async () => {
    await asUser(db, WORKER);
    expect(await failure(call('api_team_list', {}))).toMatch(/forbidden/);
    await asUser(db, OWNER);
    const team = await call<Array<{ userId: string; email: string; role: string }>>(
      'api_team_list',
      {},
    );
    expect(team.map((m) => m.userId).sort()).toEqual([OWNER, WORKER, WRITER, BARE].sort());
    expect(team[0]!.role).toBe('admin'); // Owners first
    expect(team.find((m) => m.userId === WORKER)!.email).toBe('worker@example.com');
  });

  it('api_team_assign puts an account into a role by email, and sets the matching base', async () => {
    await asUser(db, OWNER);
    await call('api_team_assign', { email: 'GUEST@example.com ', teamRoleId: reservations });
    await db.asOwner();
    let p = (
      await db.pg.query<{ role: string; team_role_id: string }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [GUEST],
      )
    ).rows[0]!;
    expect(p).toEqual({ role: 'staff', team_role_id: reservations });

    await asUser(db, OWNER);
    await call('api_team_assign', { userId: GUEST, teamRoleId: content });
    await db.asOwner();
    p = (
      await db.pg.query<{ role: string; team_role_id: string }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [GUEST],
      )
    ).rows[0]!;
    expect(p).toEqual({ role: 'seo', team_role_id: content });
  });

  it('api_team_assign can make an Owner, and refuses bad input', async () => {
    await asUser(db, OWNER);
    await call('api_team_assign', { userId: BARE, teamRoleId: 'owner' });
    await db.asOwner();
    expect(
      await one<string>(db, `select role::text as v from profiles where id = $1`, [BARE]),
    ).toBe('admin');
    await asUser(db, OWNER);
    expect(
      await failure(call('api_team_assign', { email: 'nobody@example.com', teamRoleId: content })),
    ).toMatch(/not_found/);
    expect(
      await failure(call('api_team_assign', { userId: GUEST, teamRoleId: 'not-a-role' })),
    ).toMatch(/team_role_not_found/);
    await asUser(db, WORKER);
    expect(await failure(call('api_team_assign', { userId: WORKER, teamRoleId: 'owner' }))).toMatch(
      /forbidden/,
    );
  });

  it('api_team_remove turns a member back into a customer, but never the last Owner', async () => {
    await asUser(db, OWNER);
    await call('api_team_remove', { userId: WRITER });
    await db.asOwner();
    expect(
      await one<string>(db, `select role::text as v from profiles where id = $1`, [WRITER]),
    ).toBe('customer');
    // BARE became a second Owner above; remove them, then try the last one.
    await asUser(db, OWNER);
    await call('api_team_remove', { userId: BARE });
    expect(await failure(call('api_team_remove', { userId: OWNER }))).toMatch(/last_owner/);
    expect(
      await failure(call('api_team_remove', { userId: '9f9f9f9f-9f9f-9f9f-9f9f-9f9f9f9f9f9f' })),
    ).toMatch(/not_found/);
  });

  it('anonymous callers cannot execute any of them', async () => {
    await db.asOwner();
    for (const fn of ['api_my_access', 'api_team_list', 'api_team_assign', 'api_team_remove']) {
      expect(
        await one<boolean>(db, `select has_function_privilege('anon', $1, 'execute') as v`, [
          `public.${fn}(jsonb)`,
        ]),
        fn,
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts -t "team RPCs"`
Expected: FAIL — `function api_my_access(jsonb) does not exist`.

- [ ] **Step 3: Append migration §4**

Append to `supabase/migrations/20261025140000_admin_roles.sql`:

```sql

-- ── 4) The team RPCs ────────────────────────────────────────────────────────────────────────────
-- What the signed-in caller may do in /admin. The browser loads this once per admin visit.
create or replace function api_my_access(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_build_object(
      'role', pr.role::text,
      'teamRoleId', pr.team_role_id,
      'teamRoleName', tr.name,
      'base', tr.base,
      'permissions', case
        when pr.role::text = 'admin' then to_jsonb(permission_catalogue())
        -- Same rule as has_permission(): a team role counts only when its base matches the profile.
        when (pr.role::text = 'staff' and tr.base = 'team')
          or (pr.role::text = 'seo' and tr.base = 'content') then to_jsonb(tr.permissions)
        else '[]'::jsonb
      end
    )
      from profiles pr
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.id = auth.uid()
  ), jsonb_build_object(
    'role', null, 'teamRoleId', null, 'teamRoleName', null, 'base', null, 'permissions', '[]'::jsonb
  ));
$$;

-- Everyone in the back office, with their sign-in email (auth.users — profiles has no email). Owner only.
create or replace function api_team_list(p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'userId', pr.id,
             'fullName', pr.full_name,
             'email', u.email,
             'role', pr.role::text,
             'teamRoleId', pr.team_role_id,
             'teamRoleName', tr.name
           ) order by (pr.role::text = 'admin') desc, lower(coalesce(pr.full_name, u.email, '')))
      from profiles pr
      join auth.users u on u.id = pr.id
      left join team_roles tr on tr.id = pr.team_role_id
     where pr.role::text <> 'customer'
  ), '[]'::jsonb);
end;
$$;

-- Put an account into a role (or make it an Owner: teamRoleId = 'owner'). The account is named by
-- userId, or by the email it signed up with. role + team_role_id are set together so the pairing rule
-- always holds; the profile guard's last-Owner check still applies (this runs as the table owner).
create or replace function api_team_assign(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_text text := nullif(btrim(coalesce(p ->> 'userId', '')), '');
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_target text := nullif(btrim(coalesce(p ->> 'teamRoleId', '')), '');
  v_user uuid;
  v_role team_roles;
  v_new_role text;
  v_new_team uuid;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  if v_target is null or (v_user_text is null and v_email = '') then
    raise exception 'invalid_request' using detail = 'team_assign: teamRoleId and userId or email required';
  end if;

  if v_user_text is not null then
    select id into v_user from auth.users where id::text = v_user_text;
  else
    select id into v_user from auth.users where lower(email) = v_email order by created_at limit 1;
  end if;
  if v_user is null then
    raise exception 'not_found' using detail = 'no account with that email';
  end if;

  if v_target = 'owner' then
    v_new_role := 'admin';
    v_new_team := null;
  else
    select * into v_role from team_roles where id::text = v_target;
    if not found then
      raise exception 'team_role_not_found';
    end if;
    v_new_role := case when v_role.base = 'content' then 'seo' else 'staff' end;
    v_new_team := v_role.id;
  end if;

  insert into profiles (id, role, team_role_id)
  values (v_user, v_new_role::user_role, v_new_team)
  on conflict (id) do update set role = excluded.role, team_role_id = excluded.team_role_id;

  return jsonb_build_object('ok', true, 'userId', v_user, 'role', v_new_role, 'teamRoleId', v_new_team);
end;
$$;

-- Take someone out of the back office: back to an ordinary customer account.
create or replace function api_team_remove(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_text text := nullif(btrim(coalesce(p ->> 'userId', '')), '');
  v_user uuid;
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  update profiles set role = 'customer', team_role_id = null
   where id::text = v_user_text
  returning id into v_user;
  if v_user is null then
    raise exception 'not_found';
  end if;
  return jsonb_build_object('ok', true, 'userId', v_user);
end;
$$;

revoke execute on function api_my_access(jsonb) from public, anon;
revoke execute on function api_team_list(jsonb) from public, anon;
revoke execute on function api_team_assign(jsonb) from public, anon;
revoke execute on function api_team_remove(jsonb) from public, anon;
grant execute on function api_my_access(jsonb) to authenticated, service_role;
grant execute on function api_team_list(jsonb) to authenticated, service_role;
grant execute on function api_team_assign(jsonb) to authenticated, service_role;
grant execute on function api_team_remove(jsonb) to authenticated, service_role;
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/integration/admin-roles.test.ts
git commit -F - <<'EOF'
feat(db): owner-only team RPCs (my access, list, assign by email, remove)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Migration §5 — money locks on prices and the charge currency

**Files:**

- Modify: `supabase/migrations/20261025140000_admin_roles.sql` (append)
- Test: `tests/integration/admin-roles.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/admin-roles.test.ts`:

```ts
describe('money locks', () => {
  let db: TestDb;
  const PRICER = '6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a';
  const CASHIER = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a';
  let optionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [
      ...PEOPLE,
      [PRICER, 'pricer@example.com', 'staff'],
      [CASHIER, 'cashier@example.com', 'staff'],
    ]);
    await seedTeamRole(db, WORKER, ['section.tours', 'section.rental']);
    await seedTeamRole(db, PRICER, ['section.tours', 'money.prices']);
    await seedTeamRole(db, CASHIER, ['money.currency']);
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const activityId = await one<string>(
      db,
      `insert into activities (operator_id, slug, title, category, status)
       select id, 'lock-test', 'Lock test', 'Island tours', 'draft' from operators limit 1
       returning id as v`,
    );
    optionId = await one<string>(
      db,
      `insert into activity_options
         (activity_id, name, position, private_base_minor, private_included, private_extra_minor, private_max_guests)
       values ($1, 'Private', 0, 20000, 4, 3000, 8) returning id as v`,
      [activityId],
    );
  });
  afterAll(async () => db.close());

  it('a price-only table: refused without money.prices, allowed with it', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
           values ($1, 'Adult', 5000, 0)`,
          [optionId],
        ),
      ),
    ).toMatch(/row-level security/);
    const upd = await db.pg.query(`update transport_band_pricing set sedan_minor = 1`);
    expect(upd.affectedRows).toBe(0);

    await asUser(db, PRICER);
    expect(
      await failure(
        db.pg.query(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
           values ($1, 'Adult', 5000, 0)`,
          [optionId],
        ),
      ),
    ).toBe('');
  });

  it('a mixed table: other columns stay editable, a changed price is refused', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(`update activity_options set name = 'Private trip' where id = $1`, [optionId]),
      ),
    ).toBe('');
    // An unchanged re-save of the price columns passes (the tour editor sends them back as loaded).
    expect(
      await failure(
        db.pg.query(
          `update activity_options set private_base_minor = 20000, private_extra_minor = 3000 where id = $1`,
          [optionId],
        ),
      ),
    ).toBe('');
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 1 where id = $1`, [optionId]),
      ),
    ).toMatch(/forbidden/);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_included = 8 where id = $1`, [optionId]),
      ),
    ).toMatch(/forbidden/);

    await asUser(db, PRICER);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 25000 where id = $1`, [
          optionId,
        ]),
      ),
    ).toBe('');
  });

  it('rental: a new priced vehicle needs money.prices', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(
          `insert into rental_vehicles (slug, name, daily_rate_minor) values ('lock-car', 'Lock car', 3600)`,
        ),
      ),
    ).toMatch(/forbidden/);
  });

  it('business_settings: WhatsApp stays editable, the rate needs money.currency', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(db.pg.query(`update business_settings set whatsapp_number = '+230 5772 9919'`)),
    ).toBe('');
    expect(await failure(db.pg.query(`update business_settings set eur_mur_rate = 51`))).toMatch(
      /forbidden/,
    );
    await asUser(db, CASHIER);
    // CASHIER is staff (is_staff() passes the row policy) and holds money.currency.
    expect(await failure(db.pg.query(`update business_settings set eur_mur_rate = 51`))).toBe('');
  });

  it('the Owner and the service role are never blocked', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 30000 where id = $1`, [
          optionId,
        ]),
      ),
    ).toBe('');
    await db.as({ role: 'service_role' });
    expect(await failure(db.pg.query(`update business_settings set charge_currency = 'EUR'`))).toBe(
      '',
    );
  });
});
```

(`rental_vehicles` needs only `slug`, `name` and `daily_rate_minor`; every other column has a default.
`business_settings` is a singleton row its own migration inserts, so the updates above always match it.)

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts -t "money locks"`
Expected: FAIL — the WORKER's `activity_option_prices` insert succeeds, and `private_base_minor = 1`
raises nothing.

- [ ] **Step 3: Append migration §5**

Append to `supabase/migrations/20261025140000_admin_roles.sql`:

```sql

-- ── 5) Money locks ──────────────────────────────────────────────────────────────────────────────
-- (a) Tables that are nothing but prices: writing needs money.prices. Reads are unchanged — each
--     table keeps its own `_read` policy (public, or published-or-staff).
drop policy if exists aop_staff on activity_option_prices;
create policy aop_staff on activity_option_prices for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists activity_supplements_staff on activity_supplements;
create policy activity_supplements_staff on activity_supplements for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists sightseeing_pricing_staff on sightseeing_pricing;
create policy sightseeing_pricing_staff on sightseeing_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists planner_pricing_staff on planner_pricing;
create policy planner_pricing_staff on planner_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists transport_band_pricing_staff on transport_band_pricing;
create policy transport_band_pricing_staff on transport_band_pricing for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists airport_transfer_fare_staff on airport_transfer_fare;
create policy airport_transfer_fare_staff on airport_transfer_fare for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists hotel_transfer_fare_staff on hotel_transfer_fare;
create policy hotel_transfer_fare_staff on hotel_transfer_fare for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists airport_transfer_config_staff on airport_transfer_config;
create policy airport_transfer_config_staff on airport_transfer_config for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists hotel_transfer_config_staff on hotel_transfer_config;
create policy hotel_transfer_config_staff on hotel_transfer_config for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

drop policy if exists region_zone_distance_staff on region_zone_distance;
create policy region_zone_distance_staff on region_zone_distance for all
  using (is_staff() and (select has_permission('money.prices')))
  with check (is_staff() and (select has_permission('money.prices')));

-- (b) Tables that mix prices with fields a worker may edit: RLS cannot split columns, so a trigger
--     refuses a client caller without the permission who CHANGES a price column (update: new value
--     differs; insert: a non-null, non-zero value). Unchanged re-saves pass — the editors send rows
--     back whole. TG_ARGV[0] is the permission, the rest are the guarded columns.
create or replace function enforce_money_columns()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_perm text := tg_argv[0];
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_col text;
  i int;
begin
  if current_user not in ('anon', 'authenticated') or has_permission(v_perm) then
    return new;
  end if;
  for i in 1 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if (tg_op = 'INSERT' and nullif(v_new ->> v_col, '0') is not null)
       or (tg_op = 'UPDATE' and (v_new -> v_col) is distinct from (v_old -> v_col)) then
      raise exception 'forbidden'
        using detail = format('changing %s needs the %s permission', v_col, v_perm);
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function enforce_money_columns() from public, anon, authenticated;
grant execute on function enforce_money_columns() to service_role;

drop trigger if exists activity_options_money_guard on activity_options;
create trigger activity_options_money_guard
  before insert or update on activity_options
  for each row execute function enforce_money_columns(
    'money.prices', 'private_base_minor', 'private_included', 'private_extra_minor');

drop trigger if exists activities_money_guard on activities;
create trigger activities_money_guard
  before insert or update on activities
  for each row execute function enforce_money_columns('money.prices', 'supplement_minor');

drop trigger if exists rental_vehicles_money_guard on rental_vehicles;
create trigger rental_vehicles_money_guard
  before insert or update on rental_vehicles
  for each row execute function enforce_money_columns('money.prices', 'daily_rate_minor', 'deposit_minor');

drop trigger if exists business_settings_money_guard on business_settings;
create trigger business_settings_money_guard
  before insert or update on business_settings
  for each row execute function enforce_money_columns('money.currency', 'charge_currency', 'eur_mur_rate');
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/integration/admin-roles.test.ts
git commit -F - <<'EOF'
feat(db): price, fare and exchange-rate writes need the matching permission

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Migration §6 — refunds need `money.refunds`

**Files:**

- Modify: `supabase/migrations/20261025140000_admin_roles.sql` (append, generated)
- Modify: `tests/integration/resolved-function-bodies.test.ts`
- Modify: `tests/integration/admin-mark-refunded.test.ts`, `tests/integration/quote-deposit-refund.test.ts`, `tests/integration/booking-change-option.test.ts`
- Test: `tests/integration/admin-roles.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/admin-roles.test.ts`:

```ts
describe('refund guards', () => {
  let db: TestDb;
  const REFUNDER = '8a8a8a8a-8a8a-8a8a-8a8a-8a8a8a8a8a8a';
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [...PEOPLE, [REFUNDER, 'refunder@example.com', 'staff']]);
    await seedTeamRole(db, WORKER, ['section.bookings']);
    await seedTeamRole(db, REFUNDER, ['section.bookings', 'money.refunds']);
  });
  afterAll(async () => db.close());

  const MISSING = '9e9e9e9e-9e9e-9e9e-9e9e-9e9e9e9e9e9e';

  it('api_mark_refunded refuses staff without money.refunds, before reading anything', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(`select api_mark_refunded($1::jsonb)`, [
          JSON.stringify({ bookingId: MISSING }),
        ]),
      ),
    ).toMatch(/forbidden/);
    await asUser(db, REFUNDER);
    // Past the guard: the next check is the booking lookup.
    expect(
      await failure(
        db.pg.query(`select api_mark_refunded($1::jsonb)`, [
          JSON.stringify({ bookingId: MISSING }),
        ]),
      ),
    ).toMatch(/booking_not_found/);
  });

  it('api_record_change_refund refuses staff without money.refunds', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(`select api_record_change_refund($1::jsonb)`, [
          JSON.stringify({ requestId: MISSING }),
        ]),
      ),
    ).toMatch(/forbidden/);
    await asUser(db, REFUNDER);
    expect(
      await failure(
        db.pg.query(`select api_record_change_refund($1::jsonb)`, [
          JSON.stringify({ requestId: MISSING }),
        ]),
      ),
    ).toMatch(/change_request_not_found/);
  });
});
```

Add two rows to `CONTRACTS` in `tests/integration/resolved-function-bodies.test.ts`, directly before
the closing `];` of the array (currently line 354):

```ts
  // Refunds are an owner-grantable permission (20261025140000_admin_roles). Both bodies are long
  // money-path definitions that have been re-declared from stale copies before; a later one forked from
  // a pre-roles body would quietly hand every staff member the refund buttons again.
  {
    fn: 'api_mark_refunded',
    must: 'refuse a staff member whose role lacks money.refunds',
    code: /\bif\s+not\s+is_staff\(\)\s+or\s+not\s+has_permission\('money\.refunds'\)\s+then\b/,
    why: 'any staff member could record a refund and email the guest a refund confirmation',
  },
  {
    fn: 'api_record_change_refund',
    must: 'refuse a staff member whose role lacks money.refunds',
    code: /\bif\s+not\s+is_staff\(\)\s+or\s+not\s+has_permission\('money\.refunds'\)\s+then\b/,
    why: 'any staff member could record a change-of-tour refund in the ledger',
  },
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts -t "refund guards" tests/integration/resolved-function-bodies.test.ts`
Expected: FAIL — WORKER's call reaches `booking_not_found` instead of `forbidden`; the two new
contracts fail.

- [ ] **Step 3: Confirm the winning bodies have not moved**

Run:

```bash
grep -ln "function api_mark_refunded" supabase/migrations/*.sql | tail -1
grep -ln "function api_record_change_refund" supabase/migrations/*.sql | tail -1
```

Expected: `supabase/migrations/20260916000000_quote_deposit_forfeit.sql` and
`supabase/migrations/20261006000000_booking_change_option.sql`. If either prints a later file, use that
file and its line range in the next step instead (the script refuses a range that does not start and
end where it should).

- [ ] **Step 4: Append the two bodies verbatim, changing only the guard line**

Run from the repo root (Bash tool):

```bash
node - <<'EOF'
const fs = require('fs');
const MIGRATION = 'supabase/migrations/20261025140000_admin_roles.sql';
const take = (file, from, to) => fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(from - 1, to).join('\n');
const GUARD = '  if not is_staff() then';
const NEW_GUARD = "  if not is_staff() or not has_permission('money.refunds') then";
function guarded(sql, fn) {
  if (!sql.startsWith(`create or replace function ${fn}(p jsonb)`)) throw new Error(`${fn}: range does not start at the function`);
  if (!sql.trimEnd().endsWith('$$;')) throw new Error(`${fn}: range does not end at $$;`);
  const n = sql.split(GUARD).length - 1;
  if (n !== 1) throw new Error(`${fn}: expected exactly one staff guard, found ${n}`);
  return sql.replace(GUARD, NEW_GUARD);
}
const mark = guarded(take('supabase/migrations/20260916000000_quote_deposit_forfeit.sql', 49, 184), 'api_mark_refunded');
const change = guarded(take('supabase/migrations/20261006000000_booking_change_option.sql', 1047, 1116), 'api_record_change_refund');
const out = [
  '',
  '-- ── 6) Refunds need money.refunds ───────────────────────────────────────────────────────────────',
  '-- Both bodies are the WINNING definitions VERBATIM (20260916000000 and 20261006000000), with exactly',
  "-- one change each: the staff guard also requires has_permission('money.refunds'). Pinned by",
  '-- tests/integration/resolved-function-bodies.test.ts.',
  mark,
  '',
  'revoke execute on function api_mark_refunded(jsonb) from public, anon;',
  'grant execute on function api_mark_refunded(jsonb) to authenticated, service_role;',
  '',
  change,
  '',
  'revoke execute on function api_record_change_refund(jsonb) from public, anon;',
  'grant execute on function api_record_change_refund(jsonb) to authenticated, service_role;',
  '',
].join('\n');
fs.appendFileSync(MIGRATION, out);
console.log('appended', out.split('\n').length, 'lines');
EOF
```

Expected output: `appended <n> lines` (about 220). Then verify the copy differs from its source in
exactly the guard line:

```bash
diff <(sed -n '49,184p' supabase/migrations/20260916000000_quote_deposit_forfeit.sql | tr -d '\r') \
     <(awk '/^create or replace function api_mark_refunded/,/^\$\$;/' supabase/migrations/20261025140000_admin_roles.sql)
```

Expected: one changed line (`if not is_staff() then` → `if not is_staff() or not has_permission('money.refunds') then`).
Repeat for `api_record_change_refund` with lines `1047,1116` of `20261006000000_booking_change_option.sql`.

- [ ] **Step 5: Run the new tests — they pass**

Run: `npx vitest run tests/integration/admin-roles.test.ts tests/integration/resolved-function-bodies.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing refund suites — fix their staff fixtures**

Run: `npx vitest run tests/integration/admin-mark-refunded.test.ts tests/integration/quote-deposit-refund.test.ts tests/integration/booking-change-option.test.ts`
Expected: FAIL with `forbidden` wherever a test refunds as `STAFF` — that staff account has no team role now.

Fix each file the same way: add `import { seedTeamRole } from '../db/team';` and, directly after the
line that inserts the `STAFF` profile (`insert into profiles (id, role) values ($1, 'staff')` — line 77,
159 and 149 respectively), add:

```ts
await seedTeamRole(db, STAFF, ['section.bookings', 'money.refunds']);
```

(`seedTeamRole` leaves the session in the owner context, which is what those `beforeAll` blocks are
in already.) Re-run the three files. Expected: PASS. The refusal itself is pinned by the
"refund guards" describe in `admin-roles.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/integration/admin-roles.test.ts tests/integration/resolved-function-bodies.test.ts tests/integration/admin-mark-refunded.test.ts tests/integration/quote-deposit-refund.test.ts tests/integration/booking-change-option.test.ts
git commit -F - <<'EOF'
feat(db): recording a refund needs the money.refunds permission

api_mark_refunded and api_record_change_refund are re-declared from their
winning bodies verbatim; only the staff guard changes.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Migration §7 — a "Content" role for the existing SEO account

**Files:**

- Modify: `supabase/migrations/20261025140000_admin_roles.sql` (append)
- Test: `tests/integration/admin-roles.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/admin-roles.test.ts`:

```ts
describe('the Content role backfill', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.close());

  it('creates a content-base "Content" role holding the five content sections', async () => {
    await db.asOwner();
    const row = (
      await db.pg.query<{ base: string; permissions: string[] }>(
        `select base, permissions from team_roles where lower(name) = 'content'`,
      )
    ).rows[0];
    expect(row?.base).toBe('content');
    expect([...(row?.permissions ?? [])].sort()).toEqual([...CONTENT_PERMISSIONS].sort());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-roles.test.ts -t "Content role backfill"`
Expected: FAIL — `row` is undefined.

- [ ] **Step 3: Append migration §7**

Append to `supabase/migrations/20261025140000_admin_roles.sql`:

```sql

-- ── 7) Backfill: the existing seo account(s) keep exactly what they had ─────────────────────────
insert into team_roles (name, description, base, permissions)
select 'Content',
       'Tour pages, places, SEO, blog and redirects. Never sees guests or money.',
       'content',
       content_permission_catalogue()
 where not exists (select 1 from team_roles where lower(btrim(name)) = 'content');

update profiles
   set team_role_id = (select id from team_roles where lower(btrim(name)) = 'content')
 where role::text = 'seo' and team_role_id is null;
```

- [ ] **Step 4: Run the whole file — it passes**

Run: `npx vitest run tests/integration/admin-roles.test.ts`
Expected: PASS. (The `team_roles` describe's "a member reads their own role only" still sees only
`workerRole`: the WORKER is not in the Content role.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261025140000_admin_roles.sql tests/integration/admin-roles.test.ts
git commit -F - <<'EOF'
feat(db): move the existing seo account into a "Content" role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: Ship the migration everywhere it must go

**Files:**

- Modify: `supabase/catch-up.sql`, `supabase/backfill-migration-ledger.sql`, `supabase/setup.sql`
- Modify: `src/lib/supabase/types.ts`, `tests/db/rpc.ts`
- Modify: `tests/integration/definer-grants-lockdown.test.ts`, `tests/integration/rpc-grants.test.ts`

- [ ] **Step 1: Mirror into catch-up.sql**

```bash
{ printf '\n-- ---- 20261025140000_admin_roles ----------------------------------------------------------\n'; cat supabase/migrations/20261025140000_admin_roles.sql; } >> supabase/catch-up.sql
```

- [ ] **Step 2: Add the ledger row**

In `supabase/backfill-migration-ledger.sql`, replace

```sql
  ('20261025130000', 'reschedule_transfer_return_date')
on conflict (version) do nothing;
```

with

```sql
  ('20261025130000', 'reschedule_transfer_return_date'),
  ('20261025140000', 'admin_roles')
on conflict (version) do nothing;
```

- [ ] **Step 3: Regenerate setup.sql**

Run: `npm run seed:gen && npm run setup:sql`
Expected: `supabase/setup.sql` changes (the migration is now inside it). Then run
`git diff --stat supabase/seed.sql` — it must print **nothing**: this migration adds no seed data. If
`seed.sql` changed, STOP and find out why before going on (the seed generator has been lossy before);
do not commit a changed `seed.sql` as part of this task.

- [ ] **Step 4: Lockdown lists and the RPC allowlist**

In `tests/integration/definer-grants-lockdown.test.ts`, add to the `LOCKED` array (before its `];`):

```ts
  // The admin-roles trigger functions (20261025140000). Trigger execution never checks EXECUTE, so the
  // grant buys them nothing; listed so a later re-definition that re-opens them fails CI.
  'enforce_team_role()',
  'enforce_last_owner_delete()',
  'enforce_money_columns()',
```

In `tests/integration/rpc-grants.test.ts`, extend the signed-in-only `it.each` list:

```ts
  it.each([
    'api_create_payment(jsonb)',
    'api_my_access(jsonb)',
    'api_team_list(jsonb)',
    'api_team_assign(jsonb)',
    'api_team_remove(jsonb)',
  ])(
```

In `tests/db/rpc.ts`, add to `ALLOWED` (after `'api_release_pending_booking',`):

```ts
  'api_my_access',
  'api_team_list',
  'api_team_assign',
  'api_team_remove',
```

- [ ] **Step 5: Hand-edit the Supabase types**

In `src/lib/supabase/types.ts`:

Add `team_role_id: string | null;` to `ProfilesRow` after `date_of_birth`, and
`team_role_id?: string | null;` to `ProfilesInsert` after `date_of_birth?`.

After the `ProfilesInsert` type, add:

```ts
type TeamRolesRow = {
  id: string;
  name: string;
  description: string | null;
  base: 'team' | 'content';
  permissions: string[];
  created_at: string;
  updated_at: string;
  updated_by: string | null;
};
type TeamRolesInsert = {
  id?: string;
  name: string;
  description?: string | null;
  base: 'team' | 'content';
  permissions?: string[];
  created_at?: string;
  updated_at?: string;
  updated_by?: string | null;
};
```

In `Tables`, after `document_counters: …;` add `team_roles: TableDef<TeamRolesRow, TeamRolesInsert>;`.

In `Functions`, after `is_staff: …;` add:

```ts
is_admin: {
  Args: Record<string, never>;
  Returns: boolean;
}
has_permission: {
  Args: {
    p_key: string;
  }
  Returns: boolean;
}
api_my_access: {
  Args: {
    p: Json;
  }
  Returns: Json;
}
api_team_list: {
  Args: {
    p: Json;
  }
  Returns: Json;
}
api_team_assign: {
  Args: {
    p: Json;
  }
  Returns: Json;
}
api_team_remove: {
  Args: {
    p: Json;
  }
  Returns: Json;
}
```

- [ ] **Step 6: Run the parity, grant and ledger guards**

Run:

```bash
npx vitest run tests/integration/catch-up-parity.test.ts tests/integration/setup-sql-parity.test.ts tests/integration/setup-sql-executes.test.ts tests/integration/definer-grants-lockdown.test.ts tests/integration/rpc-grants.test.ts tests/unit/migration-ledger.test.ts
npm run typecheck
```

Expected: PASS and no type errors. A catch-up-parity failure means the catch-up copy differs from the
migration — re-run Step 1 from a clean `git checkout supabase/catch-up.sql`.

- [ ] **Step 7: Run the whole integration suite**

Run: `npx vitest run tests/integration`
Expected: PASS. (The quote-route suites still admit their bare `staff` fixture here — the routes change
in Task 9.) Any new failure is a staff fixture that now fails closed on a price table or a refund: give
that fixture the keys the test needs with `seedTeamRole(db, STAFF, [...])` as in Task 6 Step 6 — never
loosen the migration.

- [ ] **Step 8: Commit**

```bash
git add supabase/catch-up.sql supabase/backfill-migration-ledger.sql supabase/setup.sql src/lib/supabase/types.ts tests/db/rpc.ts tests/integration/definer-grants-lockdown.test.ts tests/integration/rpc-grants.test.ts
git commit -F - <<'EOF'
chore(db): mirror the admin-roles migration into catch-up, ledger, setup and types

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: One server-side permission check for the admin routes

**Files:**

- Create: `src/lib/http/access.ts`
- Test: `tests/integration/admin-team-lib.test.ts` (server half)
- Modify: the 7 routes listed in the file structure
- Modify: `tests/integration/admin-quote-send.test.ts`, `admin-quote-balance.test.ts`, `admin-quote-draft-from-email.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/admin-team-lib.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { seedTeamRole } from '../db/team';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';

const OWNER = 'aa000000-0000-0000-0000-000000000001';
const WORKER = 'aa000000-0000-0000-0000-000000000002';
const WRITER = 'aa000000-0000-0000-0000-000000000003';
const BARE = 'aa000000-0000-0000-0000-000000000004';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await db.asOwner();
  for (const [id, email, role] of [
    [OWNER, 'owner@example.com', 'admin'],
    [WORKER, 'worker@example.com', 'staff'],
    [WRITER, 'writer@example.com', 'seo'],
    [BARE, 'bare@example.com', 'staff'],
  ]) {
    await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, $2, $3::user_role)`, [
      id,
      email.split('@')[0],
      role,
    ]);
  }
  await seedTeamRole(db, WORKER, ['section.quotes']);
  await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  hoisted.shim = makeSupabaseShim(db.pg);
});
afterAll(async () => db.close());

describe('loadCallerAccess (server, service-role reads)', () => {
  const access = (id: string) => {
    // Owner context = what the service-role client sees: every row, no RLS.
    return db.asOwner().then(() => loadCallerAccess(hoisted.shim as unknown as AccessClient, id));
  };

  it('the Owner can do everything', async () => {
    const a = await access(OWNER);
    expect(a.isOwner).toBe(true);
    expect(can(a, 'money.refunds')).toBe(true);
  });

  it('a team member gets their role', async () => {
    const a = await access(WORKER);
    expect(can(a, 'section.quotes')).toBe(true);
    expect(can(a, 'section.bookings')).toBe(false);
  });

  it('a content member never passes a guest-data gate', async () => {
    expect(can(await access(WRITER), 'section.quotes')).toBe(false);
  });

  it('fails closed for staff without a role and for an unknown user', async () => {
    expect((await access(BARE)).permissions.size).toBe(0);
    expect((await access('aa000000-0000-0000-0000-00000000ffff')).permissions.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-team-lib.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/http/access"`.

- [ ] **Step 3: Write the helper**

Create `src/lib/http/access.ts`:

```ts
import { buildAccess, type AdminAccess } from '@/lib/admin/permissions';

/**
 * The two reads loadCallerAccess makes, described structurally so the service-role Supabase client and
 * the PGlite shim both satisfy it (routes cast their client to this).
 */
export interface AccessClient {
  from(table: 'profiles' | 'team_roles'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
}

function errorText(error: unknown, fallback: string): string {
  return String((error as { message?: string } | null)?.message ?? fallback);
}

/**
 * The caller's back-office access, read through the SERVICE-ROLE client: `profiles` and `team_roles`
 * are RLS-protected and this must answer for any caller.
 *
 * NEVER derive it from `requireUser(req).role` — that is the JWT's Postgres role selector
 * ('authenticated' for staff and customers alike), not the business role. Fails closed: no profile,
 * no team role or an unknown role all give no permissions.
 */
export async function loadCallerAccess(db: AccessClient, userId: string): Promise<AdminAccess> {
  const profile = await db
    .from('profiles')
    .select('role, team_role_id')
    .eq('id', userId)
    .maybeSingle();
  if (profile.error) throw new Error(errorText(profile.error, 'profile read failed'));
  const row = profile.data as { role?: unknown; team_role_id?: unknown } | null;
  const role = typeof row?.role === 'string' ? row.role : null;
  const teamRoleId = typeof row?.team_role_id === 'string' ? row.team_role_id : null;
  if (!teamRoleId) return buildAccess({ role });

  const team = await db
    .from('team_roles')
    .select('name, permissions')
    .eq('id', teamRoleId)
    .maybeSingle();
  if (team.error) throw new Error(errorText(team.error, 'team role read failed'));
  const t = team.data as { name?: unknown; permissions?: unknown } | null;
  return buildAccess({
    role,
    teamRoleId,
    teamRoleName: typeof t?.name === 'string' ? t.name : null,
    permissions: Array.isArray(t?.permissions)
      ? t.permissions.filter((k): k is string => typeof k === 'string')
      : [],
  });
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/integration/admin-team-lib.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Switch the five role-checking routes to it**

In each route below: add the imports

```ts
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
```

delete the `SENDING_ROLES` constant and the `callerRole` function (and any helper only `callerRole`
used — `npm run lint` flags it), and replace the gate as shown.

`app/api/v1/admin/assistant/route.ts` (gate at lines 125–130):

```ts
const user = await requireUser(req);
const sb = createServiceRoleClient();
const access = await loadCallerAccess(sb as unknown as AccessClient, user.id);
if (!can(access, 'section.assistant')) {
  throw new ForbiddenError('Staff only');
}
```

`app/api/v1/admin/bookings/[ref]/installments/[seq]/remind/route.ts` (lines 83–86):

```ts
const user = await requireUser(req);
const db = createServiceRoleClient() as unknown as RemindClient;
const access = await loadCallerAccess(db as unknown as AccessClient, user.id);
if (!can(access, 'section.bookings')) throw new ForbiddenError('Staff only');
```

`app/api/v1/admin/quotes/send/route.ts` (lines 205–210):

```ts
const user = await requireUser(req);
const db = createServiceRoleClient() as unknown as SendClient;
const access = await loadCallerAccess(db as unknown as AccessClient, user.id);
if (!can(access, 'section.quotes')) {
  throw new ForbiddenError('Staff only');
}
```

`app/api/v1/admin/quotes/[ref]/balance/route.ts` (lines 136–141) — same shape with `BalanceClient` and
`'section.quotes'`.

`app/api/v1/admin/quotes/draft-from-email/route.ts` (lines 97–102):

```ts
const user = await requireUser(req);
const roleDb = createServiceRoleClient() as unknown as RoleClient;
const access = await loadCallerAccess(roleDb as unknown as AccessClient, user.id);
if (!can(access, 'section.quotes')) {
  throw new ForbiddenError('Staff only');
}
```

If a route's `RoleClient` / `RemindClient` / `BalanceClient` / `SendClient` interface still declares a
`from(table: 'profiles')` overload that nothing calls any more, delete that overload.

- [ ] **Step 6: Give the documents routes an explicit check**

In both `app/api/v1/admin/documents/[id]/pdf/route.ts` and `.../email/route.ts`, replace
`await requireUser(req);` with:

```ts
const user = await requireUser(req);
const access = await loadCallerAccess(
  createServiceRoleClient() as unknown as AccessClient,
  user.id,
);
if (!can(access, 'section.documents')) throw new ForbiddenError('Staff only');
```

and add the imports:

```ts
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
```

plus `ForbiddenError` in the existing `@/lib/services/errors` import. Update the doc comment above each
handler: it is now "Staff with the Documents section — checked explicitly, and RLS still scopes the
read to staff."

- [ ] **Step 7: Update the quote-route tests**

In each of `tests/integration/admin-quote-send.test.ts`, `admin-quote-balance.test.ts` and
`admin-quote-draft-from-email.test.ts`: add `import { seedTeamRole } from '../db/team';` and, directly
after the `insert into profiles (id, full_name, role) values (…)` statement in `beforeAll`, add:

```ts
await seedTeamRole(db, STAFF, ['section.quotes']);
```

Then, next to each file's "admits a staff account" test, add a refusal test that gives a fresh staff
account a role WITHOUT Quotes. The setup lines are the same in all three files:

```ts
const DRIVER = 'f6f6f6f6-f6f6-f6f6-f6f6-f6f6f6f6f6f6';
await db.asOwner();
await db.pg.query(`insert into auth.users (id) values ($1)`, [DRIVER]);
await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [DRIVER]);
await seedTeamRole(db, DRIVER, ['section.calendar']);
hoisted.users.set('driver-token', DRIVER);
```

`admin-quote-send.test.ts`:

```ts
it('refuses a staff account whose role does not include Quotes', async () => {
  // …the six setup lines above…
  const quote = await seedQuote();
  expect((await send(quote.id, 'driver-token')).status).toBe(403);
  expect(hoisted.sent).toHaveLength(0);
});
```

`admin-quote-balance.test.ts`:

```ts
it('refuses a staff account whose role does not include Quotes', async () => {
  // …the six setup lines above…
  const { quoteRef } = await depositConfirmed(100000, 1000);
  expect((await sendBalance(quoteRef, 'driver-token')).status).toBe(403);
});
```

`admin-quote-draft-from-email.test.ts`:

```ts
it('refuses a staff account whose role does not include Quotes', async () => {
  // …the six setup lines above…
  expect((await draft(EMAIL, 'driver-token')).status).toBe(403);
});
```

If a file resets `hoisted.sent` (or similar) in a `beforeEach`, the `toHaveLength(0)` line holds; if
it does not, drop that line rather than asserting on mail from earlier tests.

- [ ] **Step 8: Run the route suites and the type check**

Run: `npx vitest run tests/integration/admin-quote-send.test.ts tests/integration/admin-quote-balance.test.ts tests/integration/admin-quote-draft-from-email.test.ts tests/integration/admin-team-lib.test.ts && npm run typecheck && npm run lint`
Expected: PASS, no type or lint errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/http/access.ts tests/integration/admin-team-lib.test.ts app/api/v1/admin/assistant/route.ts "app/api/v1/admin/bookings/[ref]/installments/[seq]/remind/route.ts" app/api/v1/admin/quotes/send/route.ts "app/api/v1/admin/quotes/[ref]/balance/route.ts" app/api/v1/admin/quotes/draft-from-email/route.ts "app/api/v1/admin/documents/[id]/pdf/route.ts" "app/api/v1/admin/documents/[id]/email/route.ts" tests/integration/admin-quote-send.test.ts tests/integration/admin-quote-balance.test.ts tests/integration/admin-quote-draft-from-email.test.ts
git commit -F - <<'EOF'
feat(api): admin routes check the caller's role permissions

One helper (src/lib/http/access.ts) replaces five copies of callerRole.
The documents routes gain an explicit check on top of RLS.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: The browser's team library

**Files:**

- Create: `src/lib/admin/team.ts`
- Test: `tests/integration/admin-team-lib.test.ts` (append the browser half)

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/admin-team-lib.test.ts` (the browser mock at the top already routes
`getBrowserSupabase()` to the shim). Add this import next to the others at the top:

```ts
import {
  assignMember,
  deleteRole,
  loadMyAccess,
  loadRoles,
  loadTeam,
  removeMember,
  saveRole,
  teamErrorMessage,
} from '@/lib/admin/team';
```

and append:

```ts
describe('src/lib/admin/team.ts (the Roles screen’s calls)', () => {
  const asOwnerUser = () => db.as({ sub: OWNER, role: 'authenticated' });

  it('loadMyAccess returns the caller’s access', async () => {
    await db.as({ sub: WORKER, role: 'authenticated' });
    const a = await loadMyAccess();
    expect(a.role).toBe('staff');
    expect([...a.permissions]).toEqual(['section.quotes']);
  });

  it('creates, edits and deletes a role', async () => {
    await asOwnerUser();
    const id = await saveRole({
      id: null,
      name: 'Drivers',
      description: '',
      base: 'team',
      permissions: ['section.calendar'],
    });
    await saveRole({
      id,
      name: 'Drivers',
      description: 'Day sheets only',
      base: 'team',
      permissions: ['section.calendar', 'section.bookings'],
    });
    const role = (await loadRoles()).find((r) => r.id === id)!;
    expect(role.description).toBe('Day sheets only');
    expect(role.permissions).toEqual(['section.bookings', 'section.calendar']);
    await deleteRole(id);
    expect((await loadRoles()).some((r) => r.id === id)).toBe(false);
  });

  it('assigns by email, changes, and removes a member', async () => {
    await asOwnerUser();
    const id = await saveRole({
      id: null,
      name: 'Desk',
      description: '',
      base: 'team',
      permissions: [],
    });
    await assignMember({ email: 'bare@example.com' }, id);
    let member = (await loadTeam()).find((m) => m.userId === BARE)!;
    expect(member.teamRoleName).toBe('Desk');
    await removeMember(BARE);
    member = (await loadTeam()).find((m) => m.userId === BARE)!;
    expect(member).toBeUndefined();
  });

  it('turns database refusals into sentences', async () => {
    await asOwnerUser();
    await expect(assignMember({ email: 'nobody@example.com' }, 'owner')).rejects.toThrow(
      /sign up on the website first/,
    );
    await expect(removeMember(OWNER)).rejects.toThrow(/at least one Owner/);
    expect(
      teamErrorMessage('duplicate key value violates unique constraint "team_roles_name_key"', 'x'),
    ).toMatch(/already exists/);
    expect(teamErrorMessage('something else', 'Could not save.')).toBe('Could not save.');
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/integration/admin-team-lib.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/admin/team"`.

- [ ] **Step 3: Write the library**

Create `src/lib/admin/team.ts`:

```ts
import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  buildAccess,
  isPermissionKey,
  type AdminAccess,
  type PermissionKey,
  type RoleBase,
} from '@/lib/admin/permissions';

/** One owner-defined role, as the Roles screen shows it. */
export interface TeamRole {
  id: string;
  name: string;
  description: string | null;
  base: RoleBase;
  permissions: PermissionKey[];
}

/** Someone in the back office (any non-customer profile). */
export interface TeamMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  teamRoleId: string | null;
  teamRoleName: string | null;
}

export interface RoleInput {
  id: string | null;
  name: string;
  description: string;
  base: RoleBase;
  permissions: readonly PermissionKey[];
}

/**
 * Database refusals → sentences for the owner. A supabase-js error is a PLAIN OBJECT (not an Error), so
 * the raw message is matched here. Longer codes first: 'team_role_not_found' contains 'not_found'.
 */
const TEAM_ERRORS: Array<[string, string]> = [
  ['team_role_not_found', 'That role no longer exists — reload the page.'],
  ['team_role_mismatch', 'That role doesn’t fit this account.'],
  [
    'team_role_base_immutable',
    'Base access can’t change once a role exists. Create a new role instead.',
  ],
  [
    'content_role_permission',
    'A content-only role can only open Tours, Places, SEO, Blog and Redirects.',
  ],
  ['team_roles_name_key', 'A role with that name already exists.'],
  ['team_role_id_fkey', 'People still have this role. Move them to another role first.'],
  ['last_owner', 'There must always be at least one Owner. Make someone else Owner first.'],
  [
    'not_found',
    'No account with that email. Ask them to sign up on the website first, then add them.',
  ],
  ['forbidden', 'Only the owner can do that.'],
];

export function teamErrorMessage(raw: string, fallback: string): string {
  return TEAM_ERRORS.find(([code]) => raw.includes(code))?.[1] ?? fallback;
}

function fail(error: { message?: string } | null, fallback: string): Error {
  return new Error(teamErrorMessage(error?.message ?? '', fallback));
}

/** The signed-in person's access (api_my_access). */
export async function loadMyAccess(): Promise<AdminAccess> {
  const { data, error } = await getBrowserSupabase().rpc('api_my_access', { p: {} });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as {
    role?: string | null;
    teamRoleId?: string | null;
    teamRoleName?: string | null;
    permissions?: string[] | null;
  };
  return buildAccess({
    role: d.role ?? null,
    teamRoleId: d.teamRoleId ?? null,
    teamRoleName: d.teamRoleName ?? null,
    permissions: d.permissions ?? [],
  });
}

export async function loadRoles(): Promise<TeamRole[]> {
  const { data, error } = await getBrowserSupabase()
    .from('team_roles')
    .select('id, name, description, base, permissions')
    .order('name');
  if (error) throw fail(error, 'Could not load roles.');
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    base: r.base === 'content' ? 'content' : 'team',
    permissions: (r.permissions ?? []).filter(isPermissionKey),
  }));
}

/** Create (id null) or update a role; returns its id. `base` is only sent on create. */
export async function saveRole(input: RoleInput): Promise<string> {
  const sb = getBrowserSupabase();
  const row = {
    name: input.name.trim(),
    description: input.description.trim() || null,
    permissions: [...input.permissions],
  };
  if (input.id) {
    const { error } = await sb.from('team_roles').update(row).eq('id', input.id);
    if (error) throw fail(error, 'Could not save the role.');
    return input.id;
  }
  const { data, error } = await sb
    .from('team_roles')
    .insert({ ...row, base: input.base })
    .select('id')
    .single();
  if (error) throw fail(error, 'Could not create the role.');
  return data.id;
}

export async function deleteRole(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('team_roles').delete().eq('id', id);
  if (error) throw fail(error, 'Could not delete the role.');
}

export async function loadTeam(): Promise<TeamMember[]> {
  const { data, error } = await getBrowserSupabase().rpc('api_team_list', { p: {} });
  if (error) throw fail(error, 'Could not load the team.');
  return ((data ?? []) as TeamMember[]).map((m) => ({
    userId: m.userId,
    fullName: m.fullName ?? null,
    email: m.email ?? null,
    role: m.role,
    teamRoleId: m.teamRoleId ?? null,
    teamRoleName: m.teamRoleName ?? null,
  }));
}

/** Put an account into a role — `target` is a team role id, or 'owner'. */
export async function assignMember(
  who: { email?: string; userId?: string },
  target: string,
): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_team_assign', {
    p: { ...who, teamRoleId: target },
  });
  if (error) throw fail(error, 'Could not change their role.');
}

export async function removeMember(userId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_team_remove', { p: { userId } });
  if (error) throw fail(error, 'Could not remove them.');
}
```

- [ ] **Step 4: Run them and watch them pass**

Run: `npx vitest run tests/integration/admin-team-lib.test.ts && npm run typecheck`
Expected: PASS. (If `typecheck` complains about `.rpc('api_my_access', …)` argument types, the Task 8
`Functions` entries are missing.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin/team.ts tests/integration/admin-team-lib.test.ts
git commit -F - <<'EOF'
feat(admin): browser calls for roles and team members

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Access in the browser, navigation and the page guard

**Files:**

- Create: `src/components/admin/AdminAccessProvider.tsx`
- Modify: `app/(site)/admin/layout.tsx`, `src/components/admin/nav.ts`, `src/components/admin/AdminShell.tsx`
- Modify: `tests/unit/admin-quotes-editor.test.ts`
- Test: `tests/unit/admin-permissions.test.ts` (append)

- [ ] **Step 1: Write the failing nav tests**

Append to `tests/unit/admin-permissions.test.ts`:

```ts
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { ADMIN_NAV, allows, bottomNavFor, navFor, navItemForPath } from '@/components/admin/nav';

const owner = buildAccess({ role: 'admin' });
const reservations = buildAccess({
  role: 'staff',
  teamRoleId: 'r',
  teamRoleName: 'Reservations',
  permissions: ['section.bookings', 'section.quotes', 'section.calendar'],
});
const writer = buildAccess({
  role: 'seo',
  teamRoleId: 'c',
  teamRoleName: 'Content',
  permissions: CONTENT_PERMISSIONS,
});

function adminPages(dir = join(process.cwd(), 'app', '(site)', 'admin')): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return adminPages(full);
    if (name !== 'page.tsx') return [];
    const rel = relative(join(process.cwd(), 'app', '(site)'), dir)
      .split(sep)
      .join('/');
    // Dynamic segments become a sample value: /admin/activities/[id]/edit -> /admin/activities/x/edit
    return [`/${rel}`.replace(/\[[^\]]+\]/g, 'x')];
  });
}

describe('admin navigation by permission', () => {
  it('every nav item names a known permission, "owner", or null', () => {
    for (const item of ADMIN_NAV) {
      const p = item.permission;
      const keys = p === null || p === 'owner' ? [] : typeof p === 'string' ? [p] : p;
      expect(keys.every(isPermissionKey), item.href).toBe(true);
    }
  });

  it('every admin page belongs to a nav item, so the page guard covers it', () => {
    for (const path of adminPages()) {
      expect(navItemForPath(path), path).not.toBeNull();
    }
  });

  it('the Owner sees everything', () => {
    expect(navFor(owner).map((n) => n.href)).toEqual(ADMIN_NAV.map((n) => n.href));
  });

  it('a team member sees the Dashboard plus their sections, never Reports', () => {
    expect(navFor(reservations).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/bookings',
      '/admin/calendar',
      '/admin/quotes',
    ]);
    expect(allows(reservations, navItemForPath('/admin/reports')!)).toBe(false);
  });

  it('a content member sees the Dashboard plus exactly the old seo sections', () => {
    expect(navFor(writer).map((n) => n.href)).toEqual([
      '/admin',
      '/admin/activities',
      '/admin/planner-places',
      '/admin/seo',
      '/admin/blog',
      '/admin/redirects',
    ]);
  });

  it('resolves deep paths to their section', () => {
    expect(navItemForPath('/admin/activities/x/edit')?.href).toBe('/admin/activities');
    expect(navItemForPath('/admin')?.href).toBe('/admin');
    expect(navItemForPath('/admin/nope')).toBeNull();
  });

  it('the bottom bar keeps to allowed items', () => {
    expect(bottomNavFor(reservations).map((n) => n.href)).toEqual(['/admin', '/admin/bookings']);
    expect(bottomNavFor(writer).map((n) => n.href)).toEqual([
      '/admin/seo',
      '/admin/blog',
      '/admin/activities',
      '/admin/redirects',
    ]);
  });
});
```

Move the three new `import` lines to the top of the file with the others (ES imports must be
top-level; Prettier/ESLint will complain otherwise).

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/unit/admin-permissions.test.ts`
Expected: FAIL — `allows` / `navFor` / `navItemForPath` / `bottomNavFor` are not exported.

- [ ] **Step 3: Rewrite `src/components/admin/nav.ts`**

Replace the file with:

```ts
import type { ReactNode } from 'react';
import {
  IconBookings,
  IconCalendar,
  IconCar,
  IconChart,
  IconDocument,
  IconGrid,
  IconMail,
  IconPin,
  IconSliders,
  IconStar,
  IconSwap,
  IconTag,
  IconTrendUp,
  IconUsers,
  IconWallet,
} from '@/components/ui/icons';
import { can, type AdminAccess, type PermissionKey } from '@/lib/admin/permissions';

/**
 * The back office's sections, as DATA.
 *
 * Extracted from AdminShell so the list can be asserted without mounting the shell. Each item names the
 * permission that opens it (src/lib/admin/permissions.ts); the owner decides who holds which in
 * /admin/roles. AdminShell uses the same item to guard the PAGE, not just the link, so typing a URL
 * shows "No access" — but the guarded data is only locked where the database locks it (prices, the
 * charge currency, refunds, roles). Covered in tests/unit/admin-permissions.test.ts.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
  /** Who sees it: a permission (a list = any of them), 'owner', or null = everyone in the back office. */
  permission: PermissionKey | readonly PermissionKey[] | 'owner' | null;
}

export const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconGrid, exact: true, permission: null },
  {
    href: '/admin/bookings',
    label: 'Bookings',
    icon: IconBookings,
    permission: 'section.bookings',
  },
  {
    href: '/admin/calendar',
    label: 'Calendar',
    icon: IconCalendar,
    permission: 'section.calendar',
  },
  { href: '/admin/quotes', label: 'Quotes', icon: IconMail, permission: 'section.quotes' },
  {
    href: '/admin/documents',
    label: 'Documents',
    icon: IconDocument,
    permission: 'section.documents',
  },
  { href: '/admin/reports', label: 'Reports', icon: IconChart, permission: 'money.reports' },
  { href: '/admin/activities', label: 'Tours', icon: IconTag, permission: 'section.tours' },
  {
    href: '/admin/categories',
    label: 'Categories',
    icon: IconSliders,
    permission: 'section.categories',
  },
  {
    href: '/admin/content',
    label: 'Standard content',
    icon: IconDocument,
    permission: 'section.content',
  },
  // The Pricing page holds the fares AND the charge-currency card; either permission opens it, and the
  // page shows only the half that permission covers.
  {
    href: '/admin/vehicle-pricing',
    label: 'Pricing',
    icon: IconWallet,
    permission: ['money.prices', 'money.currency'],
  },
  { href: '/admin/rental', label: 'Rental', icon: IconCar, permission: 'section.rental' },
  { href: '/admin/planner-places', label: 'Places', icon: IconPin, permission: 'section.places' },
  { href: '/admin/seo', label: 'SEO', icon: IconTrendUp, permission: 'section.seo' },
  { href: '/admin/blog', label: 'Blog', icon: IconDocument, permission: 'section.blog' },
  { href: '/admin/redirects', label: 'Redirects', icon: IconSwap, permission: 'section.redirects' },
  { href: '/admin/leads', label: 'Leads', icon: IconUsers, permission: 'section.leads' },
  { href: '/admin/reviews', label: 'Reviews', icon: IconStar, permission: 'section.reviews' },
];

export function allows(access: AdminAccess, item: NavItem): boolean {
  if (item.permission === null) return true;
  if (item.permission === 'owner') return access.isOwner;
  return can(access, item.permission);
}

export function navFor(access: AdminAccess): NavItem[] {
  return ADMIN_NAV.filter((item) => allows(access, item));
}

export function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The nav item a path belongs to (the longest matching href), or null for a path no item owns. */
export function navItemForPath(pathname: string): NavItem | null {
  let best: NavItem | null = null;
  for (const item of ADMIN_NAV) {
    if (isActive(pathname, item) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

export const BOTTOM_NAV_HREFS = ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'];
export const BOTTOM_NAV_HREFS_CONTENT = [
  '/admin/seo',
  '/admin/blog',
  '/admin/activities',
  '/admin/redirects',
];

/** The mobile bottom bar: the usual four, in that order, minus any the person cannot open. */
export function bottomNavFor(access: AdminAccess): NavItem[] {
  const hrefs = access.base === 'content' ? BOTTOM_NAV_HREFS_CONTENT : BOTTOM_NAV_HREFS;
  const items = navFor(access);
  return hrefs.flatMap((href) => items.filter((n) => n.href === href));
}
```

- [ ] **Step 4: Write the access provider**

Create `src/components/admin/AdminAccessProvider.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { loadMyAccess } from '@/lib/admin/team';
import { buildAccess, NO_ACCESS, type AdminAccess } from '@/lib/admin/permissions';

const AccessContext = createContext<AdminAccess | null>(null);

/**
 * Loads what the signed-in person may do in /admin (api_my_access) once per visit and hands it to every
 * admin screen. Mounted inside AdminGuard, so only back-office profiles ever make the call.
 *
 * If the call fails, falls back to the profile's role alone: the Owner keeps working, everyone else
 * gets nothing (fail closed). The fallback is UI only — the database enforces every money rule.
 */
export function AdminAccessProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const userId = user?.id ?? null;
  const role = profile?.role ?? null;

  useEffect(() => {
    if (!userId) {
      setAccess(null);
      return;
    }
    let active = true;
    loadMyAccess()
      .then((a) => {
        if (active) setAccess(a);
      })
      .catch(() => {
        if (active) setAccess(buildAccess({ role }));
      });
    return () => {
      active = false;
    };
  }, [userId, role]);

  if (!access) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-ink-muted">Loading…</div>
    );
  }
  return <AccessContext.Provider value={access}>{children}</AccessContext.Provider>;
}

/** The current person's admin access. Outside the provider: no access at all (fail closed). */
export function useAdminAccess(): AdminAccess {
  return useContext(AccessContext) ?? NO_ACCESS;
}
```

- [ ] **Step 5: Mount it**

In `app/(site)/admin/layout.tsx`, add
`import { AdminAccessProvider } from '@/components/admin/AdminAccessProvider';` and change the body to:

```tsx
<AdminGuard>
  <AdminAccessProvider>
    <AdminShell>{children}</AdminShell>
  </AdminAccessProvider>
</AdminGuard>
```

- [ ] **Step 6: Switch AdminShell to access**

In `src/components/admin/AdminShell.tsx`:

Replace the nav import with:

```ts
import { allows, bottomNavFor, isActive, navFor, navItemForPath } from '@/components/admin/nav';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can, roleLabel } from '@/lib/admin/permissions';
```

Replace lines 77–86 (from `const name = …` through the `role` ternary) with:

```ts
const access = useAdminAccess();
const name = profile?.fullName || user?.email?.split('@')[0] || 'Staff';
const items = navFor(access);
const bottomNav = bottomNavFor(access);
const role = roleLabel(access);
const here = navItemForPath(pathname);
// The PAGE guard: a section the role lacks shows "No access" instead of the screen. A path no nav item
// owns is Owner-only (fail closed); tests/unit/admin-permissions.test.ts keeps every page in the nav.
const pageAllowed = here ? allows(access, here) : access.isOwner;
const canBookings = can(access, 'section.bookings');
const canAssistant = can(access, 'section.assistant');
const canTours = can(access, 'section.tours');
```

Then:

- `{!isSeoRole && ( <form onSubmit={submitSearch} …` → `{canBookings && (`
- `{!isSeoRole && <AssistantLauncher />}` → `{canAssistant && <AssistantLauncher />}`
- `{!isSeoRole && <AdminBell />}` → `{canBookings && <AdminBell />}`
- wrap the "New tour" `<Link href="/admin/activities/new" …>…</Link>` in `{canTours && ( … )}`
- `{children}` inside `<main>` → `{pageAllowed ? children : <NoAccess />}`
- `{!isSeoRole && <AssistantPanel />}` → `{canAssistant && <AssistantPanel />}`

Add at the bottom of the file:

```tsx
function NoAccess() {
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">No access</h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          Your role doesn’t include this section. Ask the owner if you need it.
        </p>
      </div>
    </div>
  );
}
```

Delete the now-unused `BOTTOM_NAV_HREFS` / `BOTTOM_NAV_HREFS_SEO` / `isSeoRole` references (lint flags
them).

- [ ] **Step 7: Update the existing nav test**

In `tests/unit/admin-quotes-editor.test.ts`, replace `import { navForRole } from '@/components/admin/nav';`
with:

```ts
import { navFor } from '@/components/admin/nav';
import { CONTENT_PERMISSIONS, buildAccess } from '@/lib/admin/permissions';
```

Replace `navForRole('admin')` with `navFor(buildAccess({ role: 'admin' }))`, and
`navForRole('seo')` with
`navFor(buildAccess({ role: 'seo', permissions: CONTENT_PERMISSIONS }))`.

- [ ] **Step 8: Run tests, types and lint**

Run: `npx vitest run tests/unit/admin-permissions.test.ts tests/unit/admin-quotes-editor.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean. `grep -rn "navForRole\|BOTTOM_NAV_HREFS_SEO" src app tests` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add src/components/admin/AdminAccessProvider.tsx "app/(site)/admin/layout.tsx" src/components/admin/nav.ts src/components/admin/AdminShell.tsx tests/unit/admin-permissions.test.ts tests/unit/admin-quotes-editor.test.ts
git commit -F - <<'EOF'
feat(admin): navigation and a page guard driven by role permissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: Money on the dashboard, bookings, quotes and documents

**Files:**

- Modify: `src/lib/admin/dashboard.ts`, `src/components/admin/AdminDashboard.tsx`
- Modify: `src/components/admin/AdminBookings.tsx`, `src/components/admin/BookingChangePanel.tsx`
- Modify: `src/components/admin/AdminQuotes.tsx`, `src/components/admin/documents/DetailsPane.tsx`

These are presentational gates over figures the database already serves; there is no React test
harness in this repo (`environment: 'node'`, `.ts` tests only), so they are verified in the browser in
Task 17.

- [ ] **Step 1: Dashboard — revenue and the pending total**

In `src/lib/admin/dashboard.ts`, add to `DashStat`:

```ts
  /** Shown instead of `value` to someone without money.revenue: the count, not the euros. */
  countValue?: string;
```

and in the `pending` stat object (around line 296) add `countValue: String(pendingAll.length),`.

In `src/components/admin/AdminDashboard.tsx`, add the imports

```ts
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import { can } from '@/lib/admin/permissions';
```

at the top of `AdminDashboard()` add:

```ts
const access = useAdminAccess();
// Business totals are owner-grantable (money.revenue).
const showMoney = can(access, 'money.revenue');
// The Dashboard is open to every role, but its booking panels show guest names and per-booking
// amounts — those belong to whoever has Bookings (RLS lets every staff account read bookings, so
// this gate is the only thing keeping a "Calendar only" role from seeing them here).
const showBookings = can(access, 'section.bookings');
// Today's departures name guests too; the Calendar section covers the same day sheet.
const showDepartures = can(access, ['section.bookings', 'section.calendar']);
```

and just before `return (` of the loaded state add:

```ts
// Without money.revenue the revenue card goes and the pending card shows how many, not how much.
const stats = showMoney
  ? data.stats
  : data.stats
      .filter((s) => s.key !== 'revenue')
      .map((s) => (s.countValue ? { ...s, value: s.countValue, hint: 'open' } : s));
```

Then, in the JSX:

- `{data.stats.map((s) => {` → `{stats.map((s) => {`, and wrap the whole stat-cards `<div>` (the one
  under `{/* Stat cards — each drills into a pre-filtered bookings view. */}`) in `{showBookings && ( … )}`
  — every card links into /admin/bookings.
- Wrap the "View all bookings" `<Link>` in the heading in `{showBookings && ( … )}`.
- Wrap the `{/* Today's departures */}` `<Card>` in `{showDepartures && ( … )}`.
- Wrap the `{/* Recent bookings */}` `<Card>` and the `{/* Needs attention */}` `<Card>` each in
  `{showBookings && ( … )}`.
- Wrap the `{/* Revenue … */}` `<Card>` (the one holding `<RevenueChart revenue={data.revenue} />`) in
  `{showMoney && ( … )}`.

The stat grid is `lg:grid-cols-4`; with three cards it leaves one empty column, which is fine. A role
with neither Bookings nor Calendar sees the greeting and the WhatsApp card only.

- [ ] **Step 2: Bookings — CSV export and Mark refunded**

In `src/components/admin/AdminBookings.tsx`, add the same two imports. In `AdminBookings()` after
`const isAdmin = …` add `const canExport = can(useAdminAccess(), 'money.reports');` and wrap the
"Export CSV" `<button>` in `{canExport && ( … )}`.

In `BookingDrawer` add as its first line `const canRefund = can(useAdminAccess(), 'money.refunds');`
and extend the Mark-refunded condition so it starts `{canRefund &&` :

```tsx
              {canRefund &&
                (booking.status === 'refund_pending' ||
                  ((booking.status === 'confirmed' || booking.status === 'completed') &&
                    (booking.paymentState === 'paid' ||
                      booking.paymentState === 'partially_refunded'))) && (
```

- [ ] **Step 3: Booking change panel — Record refund**

In `src/components/admin/BookingChangePanel.tsx`, add the two imports, add
`const canRefund = can(useAdminAccess(), 'money.refunds');` as the first line of `BookingChangePanel`,
and inside the `{refundOwed && (…)}` block render the "Record refund" `<button>` only when `canRefund`;
otherwise render in its place:

```tsx
<p className="mt-2 text-[12px] text-ink-muted">
  The owner records refunds — tell them it’s been sent in Peach.
</p>
```

- [ ] **Step 4: Internal notes**

In `src/components/admin/AdminQuotes.tsx`, add the two imports, add
`const showNotes = can(useAdminAccess(), 'money.notes');` as the first line of `QuoteEditor`, and wrap
`<Card title="Internal note — never sent">…</Card>` in `{showNotes && ( … )}`. The value stays in the
form state, so saving without the field keeps the note unchanged.

In `src/components/admin/documents/DetailsPane.tsx`, add the two imports, add
`const showNotes = can(useAdminAccess(), 'money.notes');` at the top of `DetailsPane`, and wrap the
`<div className="mt-4"><Field label="Internal note — never printed" …>…</Field></div>` in
`{showNotes && ( … )}`.

- [ ] **Step 5: Types, lint, related unit tests**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/admin-quotes-editor.test.ts`
Expected: clean / PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/dashboard.ts src/components/admin/AdminDashboard.tsx src/components/admin/AdminBookings.tsx src/components/admin/BookingChangePanel.tsx src/components/admin/AdminQuotes.tsx src/components/admin/documents/DetailsPane.tsx
git commit -F - <<'EOF'
feat(admin): revenue, exports, refunds and margin notes follow role permissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: The tour editor skips prices for a role without `money.prices`

**Files:**

- Modify: `src/lib/admin/activity-write.ts`, `src/components/admin/ActivityForm.tsx`
- Test: `tests/integration/admin-activity-edit.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/admin-activity-edit.test.ts`, inside the existing `describe` (it reuses
`db`, `seedActivity` and the browser-client shim):

```ts
it('a role without money.prices can save the description; prices are left untouched', async () => {
  const { activityId, optionId } = await seedActivity('locked-pricing');
  const LOCKED = 'a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6';
  await db.asOwner();
  await db.pg.query(`insert into auth.users (id) values ($1)`, [LOCKED]);
  await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [LOCKED]);
  const { seedTeamRole } = await import('../db/team');
  await seedTeamRole(db, LOCKED, ['section.tours']);
  const before = (
    await db.pg.query<{ id: string }>(
      `select id from activity_option_prices where activity_option_id = $1`,
      [optionId],
    )
  ).rows.map((r) => r.id);

  await db.as({ sub: LOCKED, role: 'authenticated' });
  const form = {
    ...EMPTY_ACTIVITY,
    slug: 'locked-pricing',
    title: 'New words only',
    options: [
      {
        id: optionId,
        name: 'Private group',
        prices: [{ label: 'Adult', amountEur: 1, maxGuests: null }],
      },
    ],
  };
  await updateActivity(activityId, form as never, { pricingLocked: true });

  await db.asOwner();
  const after = await db.pg.query<{ id: string; amount_minor: number }>(
    `select id, amount_minor from activity_option_prices where activity_option_id = $1`,
    [optionId],
  );
  expect(after.rows.map((r) => r.id)).toEqual(before); // not replaced
  expect(after.rows[0]!.amount_minor).toBe(7000); // the form's €1 was ignored
  const title = (
    await db.pg.query<{ title: string }>(`select title from activities where id = $1`, [activityId])
  ).rows[0]!.title;
  expect(title).toBe('New words only');
});
```

Check the existing tests in that file to see how they cast the form (`as ActivityFormValues` or
similar) and match it instead of `as never` if the file has a convention. If `seedActivity` leaves the
activity in a category the form must repeat, copy those fields from the existing test's `form`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/integration/admin-activity-edit.test.ts -t "money.prices"`
Expected: FAIL — a type error on `pricingLocked` (unknown option), or the save throws an RLS error
because it still replaces the price tiers.

This is the first test in that file that saves as a signed-in STAFF user rather than the database
owner. If, after Step 3, it fails on something unrelated to prices (reading `operators`, the
materialize RPC, `activity_images`), fix the test's setup — e.g. the role's keys or the seed — and
never loosen the migration to make it pass.

- [ ] **Step 3: Teach the save path to skip prices**

In `src/lib/admin/activity-write.ts`, replace the `SaveOpts` block with:

```ts
/** Save options.
 *  - `contentOnly` — the restricted content role: skip the option/price reconcile (RLS blocks those
 *    tables) and the staff-gated materialize RPC. Content fields, images and itinerary still save.
 *  - `pricingLocked` — a team role without money.prices: skip the option/price/supplement reconcile
 *    (the database refuses price writes for it, and saveing would replace every tier), but still
 *    materialize. The "Pricing & options" pane is hidden for both. */
export interface SaveOpts {
  contentOnly?: boolean;
  pricingLocked?: boolean;
}
```

In `createActivity`, replace `if (!opts.contentOnly) assertPricingValid(v);` with

```ts
const writePricing = !opts.contentOnly && !opts.pricingLocked;
if (writePricing) assertPricingValid(v);
```

and its trailing block with:

```ts
if (writePricing) {
  await reconcileOptions(data.id, v.options);
  await reconcileSupplements(data.id, v.supplements);
}
if (!opts.contentOnly) await materializeActivity(data.id);
```

In `updateActivity`, the same: `const writePricing = !opts.contentOnly && !opts.pricingLocked;`,
`if (writePricing) assertPricingValid(v);`, and:

```ts
let keptWithBookings: string[] = [];
if (writePricing) {
  keptWithBookings = await reconcileOptions(id, v.options);
  await reconcileSupplements(id, v.supplements);
}
// Publishing or adding the first price makes the activity materializable — fill its window now.
if (!opts.contentOnly) await materializeActivity(id);
return { keptWithBookings };
```

- [ ] **Step 4: Hide the pane in the editor**

In `src/components/admin/ActivityForm.tsx`, add the imports
`import { useAdminAccess } from '@/components/admin/AdminAccessProvider';` and
`import { can } from '@/lib/admin/permissions';`. After `const contentOnly = profile?.role === 'seo';`
add:

```ts
// A team role without money.prices edits everything except "Pricing & options": that pane is hidden
// and the save leaves options, tiers and supplements alone (the database would refuse the writes).
const access = useAdminAccess();
const pricingLocked = contentOnly || !can(access, 'money.prices');
```

Then pass `pricingLocked` where the section helpers take `contentOnly`: `isSectionId(requested,
pricingLocked)` (and the effect's dependency `[contentOnly]` → `[pricingLocked]`),
`visibleSections(pricingLocked)`, `defaultSection(pricingLocked)`, both `sectionIssues(v,
pricingLocked)`, and the FrenchSection supplement props `pricingLocked ? undefined : …`. Change the two
save calls to `createActivity(v, { contentOnly, pricingLocked })` and
`updateActivity(id, v, { contentOnly, pricingLocked })`.

In `src/components/admin/activity/sections.ts`, update the `staffOnly` doc comment to: "Hidden when
the person may not edit prices — the content role (RLS blocks the tables) and any role without
money.prices." The helpers' boolean parameter keeps its meaning ("pricing pane hidden"), so
`tests/unit/activity-editor-sections.test.ts` stays as is.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/integration/admin-activity-edit.test.ts tests/unit/activity-editor-sections.test.ts tests/integration/admin-catalogue.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/admin/activity-write.ts src/components/admin/ActivityForm.tsx src/components/admin/activity/sections.ts tests/integration/admin-activity-edit.test.ts
git commit -F - <<'EOF'
feat(admin): tour editor leaves prices alone for roles without money.prices

Saving a tour used to rewrite every price tier; with the price lock that
would have refused every description edit by a worker.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 14: Pricing page and rental rates by permission

**Files:**

- Modify: `src/components/admin/AdminVehiclePricing.tsx`, `src/components/admin/AdminRentalFleet.tsx`

- [ ] **Step 1: Pricing page**

In `src/components/admin/AdminVehiclePricing.tsx`, add the imports
`import { useAdminAccess } from '@/components/admin/AdminAccessProvider';` and
`import { can } from '@/lib/admin/permissions';`. Replace
`const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';` with:

```ts
const access = useAdminAccess();
const canPrices = can(access, 'money.prices');
const canCurrency = can(access, 'money.currency');
```

(remove `const { profile } = useAuth();` and the `useAuth` import if nothing else uses them). Change
the load effect to `if (canPrices) void load();` with deps `[canPrices, load]`; change
`if (!isAdmin) return …` to `if (!canPrices && !canCurrency) return <p className="text-sm text-coral">Access denied.</p>;`.

Wrap the currency card: `{canCurrency && ( <div className="mb-[18px]"> <PaymentCurrencyCard /> </div> )}`.

Wrap the fare sections — insert `{canPrices && (<>` on the line before `{/* Sightseeing tours */}` and
`</>)}` after the final `</section>` that closes the last fare section (the one directly before the
component's closing `</div>` / `);` / `}` at the end of the file).

A currency-only role must not be stuck on "Loading…": with `canPrices` false, `load()` never runs, so
every fare state stays `null`. That is fine only because each fare section's own "Loading…" sits inside
the `{canPrices && …}` wrapper. Check the component has no top-level early return on that state (as of
this plan there is none — the five "Loading…" paragraphs are all inside fare sections); if one exists,
make it `if (canPrices && !sight) …`.

- [ ] **Step 2: Rental**

In `src/components/admin/AdminRentalFleet.tsx`, add the same two imports. In `AdminRentalFleet()` add
`const canPrices = can(useAdminAccess(), 'money.prices');`.

Give `VehicleFields` a `lockPrices` prop:

```tsx
function VehicleFields({
  v,
  patch,
  lockSlug,
  lockPrices = false,
}: {
  v: RentalVehicleInput;
  patch: (p: Partial<RentalVehicleInput>) => void;
  lockSlug: boolean;
  /** Rates are read-only without money.prices — the database refuses a changed rate anyway. */
  lockPrices?: boolean;
}) {
```

and add `disabled={lockPrices}` to the "Daily rate (€)" and "Deposit (€)" `<input>`s. Pass
`lockPrices={!canPrices}` on the edit rows' `<VehicleFields v={fleet[i]!} … lockSlug />`. Wrap the
whole "Add a vehicle" `<Card>` in `{canPrices && ( … )}` (a new vehicle needs a rate).

- [ ] **Step 3: Types and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminVehiclePricing.tsx src/components/admin/AdminRentalFleet.tsx
git commit -F - <<'EOF'
feat(admin): fares, the charge currency and rental rates follow role permissions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 15: The Roles screen

**Files:**

- Create: `src/components/admin/AdminRoles.tsx`
- Create: `app/(site)/admin/roles/page.tsx`
- Modify: `src/components/admin/nav.ts`
- Test: `tests/unit/admin-permissions.test.ts` (append)

- [ ] **Step 0: Write the failing nav test**

Append inside the `admin navigation by permission` describe in `tests/unit/admin-permissions.test.ts`:

```ts
it('Roles is in the nav for the Owner only', () => {
  expect(navFor(owner).map((n) => n.href)).toContain('/admin/roles');
  expect(navFor(reservations).map((n) => n.href)).not.toContain('/admin/roles');
  expect(navFor(writer).map((n) => n.href)).not.toContain('/admin/roles');
  expect(allows(reservations, navItemForPath('/admin/roles')!)).toBe(false);
});
```

Run: `npx vitest run tests/unit/admin-permissions.test.ts -t "Roles is in the nav"`
Expected: FAIL — `/admin/roles` is not in the Owner's nav.

Then in `src/components/admin/nav.ts` add `IconShield` to the icons import (alphabetical, after
`IconPin`) and append to `ADMIN_NAV`, after the Reviews entry:

```ts
  // Owner only: who may open what. The database refuses every write behind it from anyone else.
  { href: '/admin/roles', label: 'Roles', icon: IconShield, permission: 'owner' },
```

- [ ] **Step 1: The route**

Create `app/(site)/admin/roles/page.tsx`:

```tsx
import { AdminRoles } from '@/components/admin/AdminRoles';

export const runtime = 'edge';

export default function AdminRolesPage() {
  return <AdminRoles />;
}
```

- [ ] **Step 2: The screen**

Create `src/components/admin/AdminRoles.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAdminAccess } from '@/components/admin/AdminAccessProvider';
import {
  AdminError,
  AdminHeading,
  BTN_GHOST,
  BTN_PRIMARY,
  Card,
  Field,
  INPUT_CLS,
  SELECT_CLS,
  TEXTAREA_CLS,
} from '@/components/admin/ui';
import {
  CONTENT_PERMISSIONS,
  MONEY_PERMISSIONS,
  SECTION_PERMISSIONS,
  type PermissionKey,
  type PermissionMeta,
  type RoleBase,
} from '@/lib/admin/permissions';
import {
  assignMember,
  deleteRole,
  loadRoles,
  loadTeam,
  removeMember,
  saveRole,
  type TeamMember,
  type TeamRole,
} from '@/lib/admin/team';

const CONTENT_SET = new Set<PermissionKey>(CONTENT_PERMISSIONS);

const BASES: Array<{ value: RoleBase; label: string; hint: string }> = [
  { value: 'team', label: 'Team', hint: 'Can work with guests: bookings, quotes, leads…' },
  {
    value: 'content',
    label: 'Content only',
    hint: 'Never sees guests or money. For writers and SEO help.',
  },
];

interface Draft {
  id: string | null;
  name: string;
  description: string;
  base: RoleBase;
  permissions: PermissionKey[];
}

const BLANK: Draft = { id: null, name: '', description: '', base: 'team', permissions: [] };

function message(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** /admin/roles — the owner builds roles and puts people in them. Owner only (the nav and the page guard
 *  hide it from everyone else; the database refuses every write here from anyone but an Owner). */
export function AdminRoles() {
  const access = useAdminAccess();
  const { user } = useAuth();
  const [tab, setTab] = useState<'roles' | 'team'>('roles');
  const [roles, setRoles] = useState<TeamRole[] | null>(null);
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, t] = await Promise.all([loadRoles(), loadTeam()]);
      setRoles(r);
      setTeam(t);
      setError(null);
    } catch (e) {
      setError(message(e, 'Could not load roles.'));
    }
  }, []);

  useEffect(() => {
    if (access.isOwner) void load();
  }, [access.isOwner, load]);

  const memberCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of team ?? []) {
      if (m.teamRoleId) counts.set(m.teamRoleId, (counts.get(m.teamRoleId) ?? 0) + 1);
    }
    return counts;
  }, [team]);

  if (!access.isOwner) {
    return <p className="text-sm text-coral">Only the owner can manage roles.</p>;
  }

  return (
    <div>
      <AdminHeading
        title="Roles"
        subtitle="Decide what each person in the back office can open, and whether they see the business’s money."
      />
      {error && <AdminError>{error}</AdminError>}

      <div
        role="tablist"
        aria-label="Roles and team"
        className="mb-5 inline-flex rounded-xl border border-[#E2E7EA] bg-white p-1"
      >
        {(['roles', 'team'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-[13.5px] font-bold ${
              tab === t ? 'bg-teal text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {t === 'roles' ? 'Roles' : 'Team'}
          </button>
        ))}
      </div>

      {tab === 'roles' ? (
        <RolesTab roles={roles} memberCount={memberCount} onChanged={load} onError={setError} />
      ) : (
        <TeamTab
          roles={roles ?? []}
          team={team}
          selfId={user?.id ?? null}
          onChanged={load}
          onError={setError}
        />
      )}
    </div>
  );
}

function RolesTab({
  roles,
  memberCount,
  onChanged,
  onError,
}: {
  roles: TeamRole[] | null;
  memberCount: Map<string, number>;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) {
      onError('A role needs a name.');
      return;
    }
    setBusy(true);
    onError(null);
    try {
      await saveRole(draft);
      setDraft(null);
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not save the role.'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft?.id) return;
    if (!window.confirm(`Delete the role “${draft.name}”?`)) return;
    setBusy(true);
    onError(null);
    try {
      await deleteRole(draft.id);
      setDraft(null);
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not delete the role.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="flex flex-col gap-3">
        <Card title="Owner">
          <p className="text-[13px] text-ink-muted">
            Built in. Sees and changes everything, including this page. Can’t be edited.
          </p>
        </Card>
        {roles === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          roles.map((r) => {
            const count = memberCount.get(r.id) ?? 0;
            return (
              <Card key={r.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[14px] font-extrabold text-ink">{r.name}</h2>
                    <p className="mt-0.5 text-[12.5px] text-ink-muted">
                      {r.base === 'content' ? 'Content only' : 'Team'} · {count}{' '}
                      {count === 1 ? 'person' : 'people'} · {r.permissions.length} permissions
                    </p>
                    {r.description && (
                      <p className="mt-1.5 text-[13px] text-ink">{r.description}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={BTN_GHOST}
                    onClick={() =>
                      setDraft({
                        id: r.id,
                        name: r.name,
                        description: r.description ?? '',
                        base: r.base,
                        permissions: [...r.permissions],
                      })
                    }
                  >
                    Edit
                  </button>
                </div>
              </Card>
            );
          })
        )}
        <button type="button" className={BTN_PRIMARY} onClick={() => setDraft({ ...BLANK })}>
          New role
        </button>
      </div>

      {draft && (
        <RoleEditor
          draft={draft}
          setDraft={setDraft}
          busy={busy}
          members={draft.id ? (memberCount.get(draft.id) ?? 0) : 0}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
          onDelete={() => void remove()}
        />
      )}
    </div>
  );
}

function RoleEditor({
  draft,
  setDraft,
  busy,
  members,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  busy: boolean;
  members: number;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const content = draft.base === 'content';
  const toggle = (key: PermissionKey) =>
    setDraft({
      ...draft,
      permissions: draft.permissions.includes(key)
        ? draft.permissions.filter((k) => k !== key)
        : [...draft.permissions, key],
    });
  const setBase = (base: RoleBase) =>
    setDraft({
      ...draft,
      base,
      permissions:
        base === 'content'
          ? draft.permissions.filter((k) => CONTENT_SET.has(k))
          : draft.permissions,
    });
  const locked = (key: PermissionKey) => content && !CONTENT_SET.has(key);

  return (
    <Card title={draft.id ? `Edit “${draft.name || 'role'}”` : 'New role'}>
      <div className="grid gap-4">
        <Field label="Name">
          <input
            className={INPUT_CLS}
            value={draft.name}
            maxLength={60}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Reservations"
          />
        </Field>
        <Field label="Description" hint="Optional — what this role is for.">
          <textarea
            className={TEXTAREA_CLS}
            rows={2}
            maxLength={300}
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </Field>

        <fieldset>
          <legend className="mb-1.5 block text-[12.5px] font-bold text-ink/60">Base access</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {BASES.map((b) => (
              <label
                key={b.value}
                className={`flex gap-2.5 rounded-xl border p-3 ${
                  draft.base === b.value ? 'border-teal bg-teal/5' : 'border-[#E2E7EA]'
                } ${draft.id ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
              >
                <input
                  type="radio"
                  name="role-base"
                  className="mt-0.5 accent-teal"
                  checked={draft.base === b.value}
                  disabled={Boolean(draft.id)}
                  onChange={() => setBase(b.value)}
                />
                <span>
                  <span className="block text-[13.5px] font-bold text-ink">{b.label}</span>
                  <span className="block text-[12px] text-ink-muted">{b.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {draft.id && (
            <p className="mt-1.5 text-[12px] text-ink-muted">
              Base access is fixed once a role exists. Make a new role to change it.
            </p>
          )}
        </fieldset>

        <PermissionGroup
          title="Sections"
          items={SECTION_PERMISSIONS}
          selected={draft.permissions}
          locked={locked}
          onToggle={toggle}
        />
        <PermissionGroup
          title="Money"
          items={MONEY_PERMISSIONS}
          selected={draft.permissions}
          locked={locked}
          onToggle={toggle}
        />
        {content && (
          <p className="text-[12px] text-ink-muted">
            Content-only roles can’t open guest data or money, so those boxes are off.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={onSave}>
            {busy ? 'Saving…' : 'Save role'}
          </button>
          <button type="button" className={BTN_GHOST} disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          {draft.id && (
            <button
              type="button"
              disabled={busy || members > 0}
              onClick={onDelete}
              className="ml-auto text-[13px] font-bold text-coral disabled:opacity-50"
            >
              Delete role
            </button>
          )}
        </div>
        {draft.id && members > 0 && (
          <p className="text-[12px] text-ink-muted">
            {members} {members === 1 ? 'person has' : 'people have'} this role. Move them to another
            role before deleting it.
          </p>
        )}
      </div>
    </Card>
  );
}

function PermissionGroup({
  title,
  items,
  selected,
  locked,
  onToggle,
}: {
  title: string;
  items: readonly PermissionMeta[];
  selected: readonly PermissionKey[];
  locked: (key: PermissionKey) => boolean;
  onToggle: (key: PermissionKey) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[12.5px] font-bold text-ink/60">{title}</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {items.map((p) => {
          const off = locked(p.key);
          return (
            <label
              key={p.key}
              className={`flex gap-2.5 rounded-lg px-2 py-1.5 ${
                off ? 'opacity-50' : 'cursor-pointer hover:bg-[#F7F8FA]'
              }`}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-teal"
                checked={selected.includes(p.key)}
                disabled={off}
                onChange={() => onToggle(p.key)}
              />
              <span>
                <span className="block text-[13.5px] font-semibold text-ink">{p.label}</span>
                <span className="block text-[12px] text-ink-muted">{p.hint}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoleSelect({
  roles,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  roles: TeamRole[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      className={SELECT_CLS}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === '' && <option value="">Choose a role…</option>}
      <option value="owner">Owner — everything</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>
  );
}

function TeamTab({
  roles,
  team,
  selfId,
  onChanged,
  onError,
}: {
  roles: TeamRole[];
  team: TeamMember[] | null;
  selfId: string | null;
  onChanged: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    onError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      onError(message(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  function add() {
    const e = email.trim();
    if (!e || !target) {
      onError('Type their email and pick a role.');
      return;
    }
    void run('add', async () => {
      await assignMember({ email: e }, target);
      setEmail('');
      setTarget('');
    });
  }

  return (
    <div className="flex flex-col gap-[18px]">
      <Card title="Add a member">
        <p className="mb-3 text-[13px] text-ink-muted">
          They sign up on the website first, with the email you type here.
        </p>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto] sm:items-end">
          <Field label="Email">
            <input
              type="email"
              className={INPUT_CLS}
              value={email}
              autoComplete="off"
              placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Role">
            <RoleSelect roles={roles} value={target} onChange={setTarget} />
          </Field>
          <button type="button" className={BTN_PRIMARY} disabled={busy === 'add'} onClick={add}>
            {busy === 'add' ? 'Adding…' : 'Add'}
          </button>
        </div>
      </Card>

      <Card title="Team">
        {team === null ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : (
          <ul className="divide-y divide-[#EEF1F3]">
            {team.map((m) => {
              const current = m.role === 'admin' ? 'owner' : (m.teamRoleId ?? '');
              const self = m.userId === selfId;
              const who = m.email ?? m.fullName ?? 'this person';
              return (
                <li key={m.userId} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold text-ink">
                      {m.fullName || m.email || 'Unnamed account'}
                      {self && (
                        <span className="ml-1.5 text-[12px] font-semibold text-ink-muted">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="truncate text-[12.5px] text-ink-muted">{m.email}</p>
                  </div>
                  <div className="w-full sm:w-[220px]">
                    <RoleSelect
                      roles={roles}
                      value={current}
                      disabled={busy === m.userId}
                      ariaLabel={`Role for ${who}`}
                      onChange={(next) => {
                        if (!next || next === current) return;
                        if (
                          self &&
                          current === 'owner' &&
                          !window.confirm('You are giving up your own Owner access. Continue?')
                        )
                          return;
                        void run(m.userId, () => assignMember({ userId: m.userId }, next));
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={busy === m.userId}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Remove ${who} from the back office? Their account becomes an ordinary customer account.`,
                        )
                      )
                        return;
                      void run(m.userId, () => removeMember(m.userId));
                    }}
                    className="text-[13px] font-bold text-coral disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Format, types, lint, the page-coverage test**

Run: `npx prettier --write src/components/admin/AdminRoles.tsx "app/(site)/admin/roles/page.tsx" && npm run typecheck && npm run lint && npx vitest run tests/unit/admin-permissions.test.ts tests/unit/admin-quotes-editor.test.ts`
Expected: clean / PASS — "Roles is in the nav for the Owner only" passes, and the existing "every nav
entry points at a route that exists" test finds `app/(site)/admin/roles/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminRoles.tsx "app/(site)/admin/roles/page.tsx" src/components/admin/nav.ts tests/unit/admin-permissions.test.ts
git commit -F - <<'EOF'
feat(admin): Roles screen — build roles, add members by email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 16: Documentation

**Files:**

- Modify: `docs/handbook/database.md` (the `## Roles` section), `docs/handbook/operations.md` ("Giving someone access"), `docs/handbook/services.md` (line 182), `docs/db-prod-test-split.md` (line 85 context), `CLAUDE.md` ("Roles / RLS"), the spec

- [ ] **Step 1: `docs/handbook/operations.md`** — replace the "Giving someone access" section (from the
      heading through "To revoke: set the role back to `'customer'`.") with:

````markdown
## Giving someone access

They must **sign up on the website first** (so their account exists). Then, signed in as an Owner:
**Admin → Roles → Team → Add a member** — type their email, pick a role.

- **Roles tab:** create a role, tick the **sections** it can open and the **money** switches (Reports &
  exports, Dashboard revenue, Edit prices & fares, Currency & exchange rate, Refunds, Internal notes).
- **Base access** is chosen when the role is created: **Team** (can work with guests) or **Content
  only** (never sees guests or money — the old `seo` role is now the built-in "Content" role).
- **Owner** is built in and sees everything. There is always at least one Owner; the database refuses
  to remove the last one.
- **Remove** turns the account back into an ordinary customer.

What is enforced where: the database refuses price, fare, exchange-rate and refund changes from a role
without the switch, and only an Owner can change anyone's role. Sections and the revenue totals are
hidden in the back office but not locked in the database — a technical person with a section's data
could still query it.

The very first Owner of a fresh database is still made by SQL:

```sql
update profiles set role = 'admin'
 where id = (select id from auth.users where email = 'them@example.com');
```
````

- [ ] **Step 2: `docs/handbook/database.md`** — replace the `## Roles` section body with:

````markdown
## Roles

Back-office access is managed in **/admin/roles** (spec: `docs/superpowers/specs/2026-10-25-admin-roles-design.md`).
Only the very first Owner of a fresh database is made by hand:

```sql
update profiles set role = 'admin'
 where id = (select id from auth.users where email = 'them@example.com');
```

- `profiles.role` stays the **data floor**: `admin` = Owner, `staff` = a team-base role, `seo` = a
  content-base role, `customer`. `profiles.team_role_id` → `team_roles` (the owner's permission bundles).
- `is_staff()` → `staff | admin`. Gates **money and PII reads** (unchanged).
- `is_content_editor()` → `staff | admin | seo`. Gates **content tables only**.
- `is_admin()` → Owner. Gates `team_roles` writes, the team RPCs, profile deletes, and every change of
  `role` / `team_role_id` (`enforce_profile_role`).
- `has_permission('<key>')` → Owner, or a member whose role holds the key. Gates price-table writes
  (`money.prices`), price columns on mixed tables via `enforce_money_columns(...)` triggers, the charge
  currency/rate (`money.currency`) and the refund RPCs (`money.refunds`). Use it in policies as
  `(select has_permission('…'))`.
- The catalogue lives twice — `src/lib/admin/permissions.ts` and `permission_catalogue()` — and a test
  pins them equal. Adding a key means a migration that redefines both catalogue functions.

`is_content_editor()` compares `role::text`, not the enum literal, because Postgres forbids _using_ a
just-added enum value in the same transaction that added it. Don't "clean that up".
````

- [ ] **Step 3: `docs/handbook/services.md`** line 182 — replace the "Roles are data, not config" bullet with:
      `- **Roles live in /admin/roles** — the owner builds roles and adds people by email; see docs/handbook/operations.md "Giving someone access".`

- [ ] **Step 4: `docs/db-prod-test-split.md`** — leave the SQL (a fresh TEST database still needs its first
      Owner by hand) and add after it: `After that, add anyone else from Admin → Roles.`

- [ ] **Step 5: `CLAUDE.md`** — replace the "Roles / RLS." paragraph with:

```markdown
**Roles / RLS.** `customer` (own bookings) · `admin` = Owner (everything) · `staff` / `seo` = members of an
owner-defined role in `/admin/roles` (team base / content base). The real boundary is the database:
`is_staff()` / `is_content_editor()` for reads, `is_admin()` for anything about roles,
`has_permission('money.*')` for prices, the charge currency and refunds. Sections are hidden in the UI
only. Never add an `seo` grant to any booking / payment / lead / profile / pricing table, and never let a
non-Owner change `profiles.role` or `team_role_id`.
```

- [ ] **Step 6: The spec** — in `docs/superpowers/specs/2026-10-25-admin-roles-design.md` record what
      the build settled:
  - App changes → Tours: "`PricingSection` read-only" becomes "the **Pricing & options** pane is hidden"
    (same mechanism as the content role).
  - App changes: the component-level `role === 'admin' || role === 'staff'` checks stay as a floor; the
    `AdminShell` page guard is the section gate.
  - Database rules → mixed tables: `activity_options.private_included` is guarded too.
  - RPCs: `api_team_assign` takes `userId` **or** `email`.
  - Money table: `money.revenue` also covers the dashboard's pending-payments total.
  - Profiles guard: `profiles_staff` is dropped; staff keep reads (`profiles_select`) and narrowed updates.
  - Access in the browser: loaded by `AdminAccessProvider` inside the admin layout, not by
    `AuthProvider`, so customers browsing the site never make the call.

- [ ] **Step 7: Format and commit**

```bash
npx prettier --write docs/handbook/operations.md docs/handbook/database.md docs/handbook/services.md docs/db-prod-test-split.md CLAUDE.md docs/superpowers/specs/2026-10-25-admin-roles-design.md
git add docs/handbook/operations.md docs/handbook/database.md docs/handbook/services.md docs/db-prod-test-split.md CLAUDE.md docs/superpowers/specs/2026-10-25-admin-roles-design.md
git commit -F - <<'EOF'
docs: roles are managed in /admin/roles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 17: The full gate, a browser check, then the push decision

- [ ] **Step 1: Run the whole gate** (exactly what CI runs, in order)

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
```

Expected: every step green. `test:coverage` runs the FULL suite (it alone catches the Tailwind-opacity
and i18n-coverage checks); a coverage floor miss means `src/lib/admin/team.ts` or
`src/lib/http/access.ts` lost its tests. Also run `git status` — an uncommitted file from another
session can make the local gate pass while CI fails.

- [ ] **Step 2: Bring the DEV database up to date (it ends with this migration)**

`.env.local` points at the **DEV** Supabase project (never production). Confirm first:
`grep SUPABASE_DB_URL .env.local` must NOT contain the production project ref.

Do not apply only the new file: the two refund functions are copies of October bodies and assume the
October schema, so a DEV database that is behind fails in confusing ways. `supabase/catch-up.sql` is
the idempotent sync script and its last section is now this migration, so run it whole:

```bash
npx tsx scripts/db-exec.ts supabase/catch-up.sql
```

Expected: it reports the file applied. If it fails part-way, read the error — `catch-up.sql` is only
half transactional (`docs/handbook/database.md`) — fix the cause and re-run; it is safe to run twice.

- [ ] **Step 3: Check it in the browser** (dev server via the preview tools, `npm run dev`)

Signed in to the DEV site as an Owner test account:

1. `/admin/roles` opens; "Content" is listed. Create "Reservations" (Team) with Bookings, Calendar,
   Quotes, Documents, Leads and **no** money switches.
2. Team → Add a member: a DEV test account's email + Reservations.
3. Sign in as that test account: the sidebar shows Dashboard, Bookings, Calendar, Quotes, Documents,
   Leads; the dashboard has no revenue card, no revenue chart, and the pending card shows a count;
   `/admin/reports` and `/admin/roles` show "No access"; Bookings has no "Export CSV"; a refundable
   booking's drawer has no "Mark refunded"; a quote has no internal-note card.
4. Back as Owner, tick **Edit prices & fares** for Reservations; as the worker, `/admin/vehicle-pricing`
   shows the fares and no currency card.
5. As Owner, Team → try to remove yourself while you are the only Owner: the error says there must
   always be at least one Owner.
6. As Owner, create "Drivers" (Team) with **Calendar only** and move the test account into it. As the
   worker: the Dashboard shows the greeting and today's departures, but **no** stat cards, no
   "Recent bookings", no "Needs attention" and no "View all bookings" link; `/admin/bookings` shows
   "No access".

Take a screenshot of steps 3, 5 and 6 for the owner.

- [ ] **Step 4: Ask the owner before pushing**

Pushing to `main` runs `supabase db push` on **production** and deploys the web app. Before asking,
list what changes for real people on deploy day: nothing for the 4 `admin` accounts (all stay Owner);
the `seo` account keeps its five sections (now via the "Content" role) and additionally gets a
Dashboard link, which shows it only a greeting and the WhatsApp card; nobody else exists in the back
office. After deploy the owner needs to tell us which of the 4 `admin` accounts are theirs; the others
are moved into roles from the Team tab. Push only on the owner's explicit yes, then watch the
`release.yml` run until the `verify` job's final **Edge bundle** step and the deploy jobs are green.
