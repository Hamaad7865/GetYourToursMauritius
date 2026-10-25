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
 * Normalise whatever the database returned into an AdminAccess — FAIL CLOSED, and never throws, because
 * `permissions` arrives from an untyped jsonb RPC. The Owner (role 'admin') gets every key. A team
 * member ('staff') gets their role's known keys; a content member ('seo') additionally loses any
 * non-content key (the database refuses to store one, this is the second lock). Everyone else — a
 * customer, nobody, an unknown role — gets nothing.
 *
 * `base` is derived from the role, not read from the row: the database's pairing rule guarantees
 * staff ↔ team and seo ↔ content, so `profiles.role` is the single source of truth. The team role's
 * id and name are only carried for staff and seo; for anyone else they are null.
 */
export function buildAccess(input: {
  role: string | null;
  teamRoleId?: string | null;
  teamRoleName?: string | null;
  permissions?: readonly string[] | null;
}): AdminAccess {
  const role = input.role ?? null;
  const isOwner = role === 'admin';
  const isMember = role === 'staff' || role === 'seo';
  const base: RoleBase | null = role === 'staff' ? 'team' : role === 'seo' ? 'content' : null;
  let keys: PermissionKey[] = [];
  if (isOwner) keys = [...ALL_PERMISSIONS];
  else if (isMember) {
    // Runtime guard: the type says string[], the wire says whatever jsonb held.
    const raw: unknown[] = Array.isArray(input.permissions) ? input.permissions : [];
    keys = raw.filter((k): k is PermissionKey => typeof k === 'string' && isPermissionKey(k));
    if (role === 'seo') keys = keys.filter((k) => CONTENT.has(k));
  }
  return {
    role,
    isOwner,
    teamRoleId: isMember ? (input.teamRoleId ?? null) : null,
    teamRoleName: isMember ? (input.teamRoleName ?? null) : null,
    base,
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
  return access.teamRoleName || 'No role yet';
}
