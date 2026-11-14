'use client';

import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { Logo } from '@/components/site/Logo';
import { AdminBell } from '@/components/admin/AdminBell';
import { AiSparkButton } from '@/components/admin/quotes/AiSpark';
import { AssistantProvider, useAssistant } from '@/components/admin/assistant/AssistantProvider';
import { avatar } from '@/lib/admin/dashboard';
import {
  bottomNavFor,
  crumbFor,
  groupedNav,
  isActive,
  navFor,
  pageAllowedFor,
  type NavItem,
} from '@/components/admin/nav';
import { useAdminAccess, useAdminAccessStatus } from '@/components/admin/AdminAccessProvider';
import { NoAccess } from '@/components/admin/NoAccess';
import { buttonClass } from '@/components/admin/ui';
import { can, roleLabel } from '@/lib/admin/permissions';
import {
  IconSearch,
  IconPlus,
  IconMenu,
  IconX,
  IconExternalLink,
  IconLogOut,
} from '@/components/ui/icons';

// The assistant column is loaded on demand and never on the server: it is reachable from every
// admin screen, so a static import would put the whole chat in the first paint of each of them.
const AssistantPanel = dynamic(
  () => import('@/components/admin/assistant/AssistantPanel').then((m) => m.AssistantPanel),
  { ssr: false },
);

/* The ink sidebar's own text colours (bo.css `.side`), used nowhere else: body #C9D9DC (9.9:1 on
   ink), labels #9DBBC0 (7.1:1), the active item's icon #7FE0E4 (5.9:1 on ink-raised). */
const SIDE_TEXT = 'text-[#C9D9DC]';
const SIDE_LABEL = 'text-[#9DBBC0]';

/** A 36px square icon button for the light top bar (`.ib`), and its borderless twin (`.ib.q`). Two
 *  strings, not one plus overrides: `border-transparent` cannot beat `border-line` by being appended. */
const ICON_BTN =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white text-ink-muted transition-colors hover:border-[#C2CED1] hover:text-ink motion-reduce:transition-none';
const ICON_BTN_QUIET =
  'grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-line-soft hover:text-ink motion-reduce:transition-none';

/** The back-office shell: the ink sidebar in groups (desktop), the white top bar with the breadcrumb,
 *  and a slide-in drawer + bottom bar on a phone. Renders the active screen as `children`, beside the
 *  assistant. Look: design-reference/backoffice-redesign (Nav, Shell, Main). */
export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AssistantProvider>
      <AdminShellInner>{children}</AdminShellInner>
    </AssistantProvider>
  );
}

/** The launcher, in the top bar of every admin screen. Staff only — it reads guests and money. */
function AssistantLauncher() {
  const assistant = useAssistant();
  if (!assistant) return null;
  return <AiSparkButton label="Ask Gemini" expanded={assistant.open} onClick={assistant.toggle} />;
}

function AdminShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  // Focus-in (to the close button), Tab-trap, Escape-to-close, and focus-restore for the mobile drawer —
  // the shared modal hook. Restores to whichever trigger (top bar or bottom-nav "More") opened it.
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useDialog(
    drawer,
    () => setDrawer(false),
    () => drawerCloseRef.current,
  );

  // Global search → the Bookings screen (which filters by ref / name / email and seeds from ?q=).
  // Customers live on bookings too, so this covers "bookings & customers"; Tours has its own on-page search.
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(`/admin/bookings?q=${encodeURIComponent(q)}`);
  };

  const access = useAdminAccess();
  const { loadFailed, retry } = useAdminAccessStatus();
  const name = profile?.fullName || user?.email?.split('@')[0] || 'Staff';
  const items = navFor(access);
  const bottomNav = bottomNavFor(access);
  // Permissions that could not be read are not the same as a role with none: say so, offer a retry,
  // and don't show even Today as if that were everything this person may open. (The Owner's
  // role-only fallback is complete, so the Owner is never held up by this.)
  const permissionsFailed = loadFailed && !access.isOwner;
  const role = permissionsFailed ? 'Permissions didn’t load' : roleLabel(access);
  // The PAGE guard: a section the role lacks shows "No access" instead of the screen.
  const pageAllowed = pageAllowedFor(access, pathname);
  const fullBleed =
    pageAllowed &&
    !permissionsFailed &&
    (pathname === '/admin/calendar' || pathname.startsWith('/admin/calendar/'));
  const canBookings = can(access, 'section.bookings');
  const canAssistant = can(access, 'section.assistant');
  const canTours = can(access, 'section.tours');
  const { initials } = avatar(name);
  const closeDrawer = () => setDrawer(false);

  return (
    // The ground is the page grey every white card sits on. The base text size is set on the main
    // column below, not here, so the assistant panel (a sibling of it) keeps its own typography.
    <div className="flex min-h-dvh bg-ground text-ink">
      {/* ===== Desktop sidebar ===== */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col bg-ink lg:flex print:hidden">
        <SidebarBrand />
        <SidebarNav items={items} pathname={pathname} />
        <SidebarFoot name={name} role={role} initials={initials} onSignOut={() => void signOut()} />
      </aside>

      {/* ===== Mobile drawer ===== */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/50" onClick={closeDrawer} aria-hidden />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="absolute inset-y-0 left-0 flex w-[264px] max-w-[85%] flex-col bg-ink shadow-2xl"
          >
            <div className="flex items-center justify-between pr-2">
              <SidebarBrand />
              <button
                ref={drawerCloseRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close menu"
                className={`grid h-9 w-9 place-items-center rounded-lg ${SIDE_TEXT} transition-colors hover:bg-white/10 hover:text-white motion-reduce:transition-none`}
              >
                <IconX width={18} height={18} />
              </button>
            </div>
            <SidebarNav items={items} pathname={pathname} onNavigate={closeDrawer} />
            <SidebarFoot
              name={name}
              role={role}
              initials={initials}
              onSignOut={() => void signOut()}
            />
          </div>
        </div>
      )}

      {/* ===== Main column =====
          13px medium with tabular figures is the back office's base text (bo.css `.app`); a screen's
          own sizes still win. */}
      <div className="flex min-w-0 flex-1 flex-col text-[13px] font-medium tabular-nums">
        {/* Top bar. `data-admin-topbar` is read by the calendar to dock its day panel under it. */}
        <header
          data-admin-topbar
          className="sticky top-0 z-40 flex min-h-14 items-center gap-2.5 border-b border-line bg-white px-4 py-2 sm:px-6 print:hidden"
        >
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            aria-expanded={drawer}
            className={`${ICON_BTN} lg:hidden`}
          >
            <IconMenu width={18} height={18} />
          </button>
          <Breadcrumb pathname={pathname} />
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2.5">
            {canBookings && (
              <form
                onSubmit={submitSearch}
                role="search"
                className="hidden min-w-0 flex-[0_1_400px] sm:block"
              >
                <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-ground px-2.5 text-ink-soft transition-[border-color,box-shadow,background-color] focus-within:border-teal-dark focus-within:bg-white focus-within:ring-[3px] focus-within:ring-teal-dark/20 motion-reduce:transition-none">
                  <IconSearch width={16} height={16} className="shrink-0" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    type="search"
                    enterKeyHint="search"
                    aria-label="Search bookings and customers"
                    placeholder="Search bookings, customers…"
                    className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium text-ink outline-none placeholder:text-ink-soft"
                  />
                </label>
              </form>
            )}
            {/* "New", neutral, as in the mock-ups. Until the menu of things to start arrives (a later
                phase) it does what it did before, start a tour, and its name and tooltip say so. */}
            {canTours && (
              <Link
                href="/admin/activities/new"
                aria-label="New tour"
                title="New tour"
                className={`${buttonClass('ghost')} hidden sm:inline-flex`}
              >
                <IconPlus width={16} height={16} /> New
              </Link>
            )}
            {canBookings && <AdminBell />}
            {canAssistant && <AssistantLauncher />}
            <Link
              href="/"
              aria-label="View the site"
              title="View the site"
              className={`${ICON_BTN_QUIET} hidden md:grid`}
            >
              <IconExternalLink width={17} height={17} />
            </Link>
            <span
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-ink-raised text-[11px] font-bold text-white"
              aria-hidden
            >
              {initials}
            </span>
          </div>
        </header>

        {/* Screen content. `max-w-[1320px]` is a cap, not a width, so when the assistant column
            opens this simply reflows narrower — nothing is occluded (the owner's note: the centre
            should diminish, not get covered). The calendar is full-bleed: its day panel docks
            against the right edge, and it pads its own content. */}
        <main
          className={
            fullBleed
              ? 'w-full min-w-0 flex-1 pb-24 lg:pb-0'
              : 'mx-auto w-full max-w-[1320px] flex-1 px-4 pb-24 pt-[22px] sm:px-6 lg:pb-7'
          }
        >
          {permissionsFailed ? (
            <NoAccess loadFailed onRetry={retry} />
          ) : pageAllowed ? (
            children
          ) : (
            <NoAccess />
          )}
        </main>

        {/* Mobile bottom bar: the usual four this person may open, in sidebar order, plus More. */}
        <nav
          aria-label="Main sections"
          className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
        >
          {bottomNav.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10.5px] font-semibold transition-colors motion-reduce:transition-none ${
                  active ? 'text-teal-dark' : 'text-ink-muted hover:text-ink'
                }`}
              >
                <Icon width={20} height={20} />
                <span className="max-w-full truncate">{item.short ?? item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-haspopup="dialog"
            aria-expanded={drawer}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[10.5px] font-semibold text-ink-muted transition-colors hover:text-ink motion-reduce:transition-none"
          >
            <IconMenu width={20} height={20} />
            More
          </button>
        </nav>
      </div>

      {/* ===== The assistant column =====
          A SIBLING of the main column, not an overlay: from lg it animates its own width, so the
          content beside it reflows. Below lg it fixes itself over the screen (no room to split). */}
      {canAssistant && <AssistantPanel />}
    </div>
  );
}

/** Where you are: the group, then the section ("Catalogue / Tours"). On a section's deeper page (a
 *  tour's editor) the section links back to its list. Nothing for a path no section owns. */
function Breadcrumb({ pathname }: { pathname: string }) {
  const crumb = crumbFor(pathname);
  if (!crumb) return null;
  const deep = pathname !== crumb.href;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13px] text-ink-soft">
      <ol className="flex min-w-0 items-center gap-1.5">
        {crumb.group && (
          <li className="hidden shrink-0 items-center gap-1.5 sm:flex">
            {crumb.group}
            <span aria-hidden="true">/</span>
          </li>
        )}
        <li className="min-w-0 truncate">
          {deep ? (
            <Link
              href={crumb.href}
              className="font-semibold text-ink underline-offset-2 hover:text-teal-dark hover:underline"
            >
              {crumb.label}
            </Link>
          ) : (
            <span aria-current="page" className="font-semibold text-ink">
              {crumb.label}
            </span>
          )}
        </li>
      </ol>
    </nav>
  );
}

function SidebarBrand() {
  // The real brand logo (white-script `logo-dark.svg`, made for this dark sidebar), linking to the
  // back office's home rather than the public one. The artwork carries the wordmark, so the only text
  // beside it is the small caption.
  return (
    <div className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
      <Logo
        tone="dark"
        href="/admin"
        className="h-10 w-auto"
        label="Belle Mare Tours — back office home"
      />
      <span className={`text-[11px] font-medium leading-tight ${SIDE_LABEL}`}>Back office</span>
    </div>
  );
}

/**
 * The grouped section list (Nav.dc.html): Today alone, then each group under its label. Only what
 * this person may open is passed in, and a group left empty by that shows no label (`groupedNav`).
 *
 * A component of its own, not a closure inside the shell: defined inline it was a NEW component type
 * on every render, so React remounted the list (and lost its scroll) on each keystroke in the search.
 *
 * min-h-0 + overflow-y-auto: with this many items the nav can exceed the viewport, and this is a flex
 * child of an h-dvh column — without min-h-0 it refuses to shrink and clips Today and the sign-out
 * chip off the top and bottom with no way to scroll to them.
 */
function SidebarNav({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  // The desktop sidebar and the phone drawer can both be in the DOM: ids must not collide.
  const idBase = useId();
  return (
    <nav
      aria-label="Back office sections"
      className="slim-bar-dark flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3"
    >
      {groupedNav(items).map(({ group, items: sectionItems }) => {
        const headingId = group ? `${idBase}-${group.toLowerCase()}` : undefined;
        return (
          <div key={group ?? 'today'}>
            {group && (
              <p
                id={headingId}
                className={`px-2.5 pb-[5px] pt-[13px] text-[11px] font-semibold tracking-[0.02em] ${SIDE_LABEL}`}
              >
                {group}
              </p>
            )}
            <ul aria-labelledby={headingId} className="flex flex-col gap-0.5">
              {sectionItems.map((item) => {
                const active = isActive(pathname, item);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors motion-reduce:transition-none ${
                        active
                          ? 'bg-ink-raised font-semibold text-white'
                          : `font-medium ${SIDE_TEXT} hover:bg-white/5 hover:text-white`
                      }`}
                    >
                      <span className={`flex shrink-0 ${active ? 'text-[#7FE0E4]' : ''}`}>
                        <Icon width={17} height={17} />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Who is signed in, their role, and sign out, at the foot of the sidebar. */
function SidebarFoot({
  name,
  role,
  initials,
  onSignOut,
}: {
  name: string;
  role: string;
  initials: string;
  onSignOut: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3">
      <span
        aria-hidden="true"
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-ink-raised text-[11px] font-bold text-white"
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-semibold text-white">{name}</span>
        <span className={`block truncate text-[11px] font-medium ${SIDE_LABEL}`}>{role}</span>
      </span>
      <button
        type="button"
        onClick={onSignOut}
        aria-label="Sign out"
        className={`grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg ${SIDE_TEXT} transition-colors hover:bg-white/10 hover:text-white motion-reduce:transition-none`}
      >
        <IconLogOut width={16} height={16} />
      </button>
    </div>
  );
}
