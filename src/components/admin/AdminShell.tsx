'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { Logo } from '@/components/site/Logo';
import { AdminBell } from '@/components/admin/AdminBell';
import { OrbMark } from '@/components/admin/assistant/AiOrb';
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
  IconChevronLeft,
  IconChevronRight,
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

/** The sidebar's small text buttons at its foot (Search, Hide menu, View site, Sign out). */
const SIDE_TOOL = `flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-[12.5px] font-medium ${SIDE_TEXT} transition-colors hover:bg-white/10 hover:text-white motion-reduce:transition-none`;
/** The same as a square icon button, for the folded rail. */
const SIDE_TOOL_ICON = `grid h-9 w-9 place-items-center rounded-lg ${SIDE_TEXT} transition-colors hover:bg-white/10 hover:text-white motion-reduce:transition-none`;

/** Where the desktop sidebar remembers being folded away: this browser's convenience only. */
const FOLD_KEY = 'bmt-admin-sidebar';
const NAV_ID = 'admin-sidebar-nav';

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

/**
 * The launcher, in the top bar of every admin screen. Staff only — it reads guests and money.
 * The name shows from sm; below that the mark alone, with the same words as its accessible name.
 */
function AssistantLauncher() {
  const assistant = useAssistant();
  if (!assistant) return null;
  return (
    <button
      type="button"
      onClick={assistant.toggle}
      aria-expanded={assistant.open}
      data-assistant-launcher
      aria-label="Belle Mare AI"
      title="Belle Mare AI"
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-2.5 text-[12.5px] font-semibold transition-colors motion-reduce:transition-none sm:pr-3.5 ${
        assistant.open
          ? 'border-[#0A1517] bg-[#0A1517] text-white'
          : 'border-line bg-white text-ink hover:border-[#F4B860]/70 hover:bg-[#FFF8EC]'
      }`}
    >
      <OrbMark size={18} />
      <span className="hidden sm:inline" aria-hidden="true">
        Belle Mare AI
      </span>
    </button>
  );
}

function AdminShellInner({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  // From lg the screen's card scrolls, not the window, so a new screen must start at its top: the
  // router only resets the window.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [pathname]);
  // The desktop sidebar folds to an icon rail ("Hide menu"). Read after mount, not in useState: the
  // server render has no storage, and the two renders must match. `animate` stays off until then so a
  // folded sidebar does not visibly slide shut on every page load.
  const [folded, setFolded] = useState(false);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(FOLD_KEY) === 'folded') setFolded(true);
    } catch {
      /* storage blocked: start open */
    }
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, []);
  const toggleFolded = () => {
    setFolded((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(FOLD_KEY, next ? 'folded' : 'open');
      } catch {
        /* storage blocked: it still folds for this visit */
      }
      return next;
    });
  };
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
    // From lg the shell is one dark ground (the sidebar's ink) holding two cards, the screen and the
    // Belle Mare AI column, each inset by `--bo-inset` (as Gmail sets its mail list and Gemini side by
    // side): the window no longer scrolls, the screen's card does.
    <div className="flex min-h-dvh bg-ground text-ink [--bo-inset:0px] lg:h-dvh lg:overflow-clip lg:bg-ink lg:[--bo-inset:1rem] print:h-auto print:overflow-visible print:bg-white">
      {/* ===== Desktop sidebar ===== */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col bg-ink lg:flex print:hidden ${
          folded ? 'w-[68px]' : 'w-[232px]'
        } ${animate ? 'transition-[width] duration-200 ease-out motion-reduce:transition-none' : ''}`}
      >
        <SidebarBrand folded={folded} />
        <SidebarNav items={items} pathname={pathname} folded={folded} id={NAV_ID} />
        <SidebarFoot
          name={name}
          role={role}
          initials={initials}
          onSignOut={() => void signOut()}
          folded={folded}
          onToggleFold={toggleFolded}
          onSearch={canBookings ? () => searchRef.current?.focus() : undefined}
        />
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
      <div
        ref={scrollRef}
        data-admin-scroll
        className="bo-scroll flex min-w-0 flex-1 flex-col bg-ground text-[13px] font-medium tabular-nums lg:my-2 lg:mr-2 lg:h-[calc(100dvh-var(--bo-inset))] lg:overflow-y-auto lg:rounded-[18px] print:m-0 print:h-auto print:overflow-visible print:rounded-none"
      >
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
                    ref={searchRef}
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

function SidebarBrand({ folded = false }: { folded?: boolean }) {
  // The real brand logo (white-script `logo-dark.svg`, made for this dark sidebar), linking to the
  // back office's home rather than the public one. The artwork carries the wordmark, so the only text
  // beside it is the small caption. Room above and below, and a hairline, so the logo does not crowd
  // Today (the owner's note, 15 Nov). Folded, the logo shrinks to fit the rail and the caption goes.
  return (
    <div
      className={`mx-3 mb-3 flex shrink-0 items-center gap-2.5 border-b border-white/10 pb-4 pt-5 ${
        folded ? 'justify-center' : 'px-1'
      }`}
    >
      <Logo
        tone="dark"
        href="/admin"
        className={folded ? 'h-7 w-auto' : 'h-10 w-auto'}
        label="Belle Mare Tours — back office home"
      />
      {!folded && (
        <span className={`text-[11px] font-medium leading-tight ${SIDE_LABEL}`}>Back office</span>
      )}
    </div>
  );
}

/**
 * The grouped section list (Nav.dc.html): Today alone, then each group under its label. Only what
 * this person may open is passed in, and a group left empty by that shows no label (`groupedNav`).
 * Folded to the rail, every screen shows as an icon, with a hairline between groups. (Groups that
 * open and close were tried on 15 Nov 2026 and taken out at the owner's request.)
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
  folded = false,
  id,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate?: () => void;
  /** The desktop rail: icons only, each still named for a screen reader and on hover. */
  folded?: boolean;
  id?: string;
}) {
  // The desktop sidebar and the phone drawer can both be in the DOM: ids must not collide.
  const idBase = useId();
  return (
    <nav
      id={id}
      aria-label="Back office sections"
      className="slim-bar-dark flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3"
    >
      {groupedNav(items).map(({ group, items: sectionItems }) => {
        const headingId = group ? `${idBase}-${group.toLowerCase()}` : undefined;
        return (
          <div key={group ?? 'today'}>
            {group &&
              (folded ? (
                <>
                  {/* The label stays as the list's name; a hairline marks the group. */}
                  <p id={headingId} className="sr-only">
                    {group}
                  </p>
                  <div aria-hidden="true" className="mx-2 my-2.5 h-px bg-white/10" />
                </>
              ) : (
                <p
                  id={headingId}
                  className={`px-2.5 pb-1.5 pt-[18px] text-[11px] font-semibold tracking-[0.02em] ${SIDE_LABEL}`}
                >
                  {group}
                </p>
              ))}
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
                      title={folded ? item.label : undefined}
                      className={`flex h-9 items-center gap-2.5 rounded-lg text-[13px] transition-colors motion-reduce:transition-none ${
                        folded ? 'justify-center px-0' : 'px-2.5'
                      } ${
                        active
                          ? 'bg-ink-raised font-semibold text-white'
                          : `font-medium ${SIDE_TEXT} hover:bg-white/5 hover:text-white`
                      }`}
                    >
                      <span className={`flex shrink-0 ${active ? 'text-[#7FE0E4]' : ''}`}>
                        <Icon width={18} height={18} />
                      </span>
                      <span className={folded ? 'sr-only' : 'truncate'}>{item.label}</span>
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

/**
 * The sidebar's foot: a row of tools (Search, Hide menu, View site, Sign out), then who is signed in
 * with their role as a small pill. Folded, the tools stack as icon buttons over the initials. The
 * phone drawer passes no `onToggleFold` or `onSearch`: it has no rail, and its search is the top bar.
 */
function SidebarFoot({
  name,
  role,
  initials,
  onSignOut,
  folded = false,
  onToggleFold,
  onSearch,
}: {
  name: string;
  role: string;
  initials: string;
  onSignOut: () => void;
  folded?: boolean;
  onToggleFold?: () => void;
  onSearch?: () => void;
}) {
  const foldLabel = folded ? 'Show menu' : 'Hide menu';
  const FoldIcon = folded ? IconChevronRight : IconChevronLeft;
  const avatarChip = (
    <span
      aria-hidden="true"
      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-raised text-[11px] font-bold text-white"
    >
      {initials}
    </span>
  );

  if (folded) {
    return (
      <div className="flex shrink-0 flex-col items-center gap-1 border-t border-white/10 py-3">
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search"
            title="Search"
            className={SIDE_TOOL_ICON}
          >
            <IconSearch width={17} height={17} />
          </button>
        )}
        {onToggleFold && (
          <button
            type="button"
            onClick={onToggleFold}
            aria-label={foldLabel}
            title={foldLabel}
            aria-expanded={false}
            aria-controls={NAV_ID}
            className={SIDE_TOOL_ICON}
          >
            <FoldIcon width={17} height={17} />
          </button>
        )}
        <button
          type="button"
          onClick={onSignOut}
          aria-label="Sign out"
          title="Sign out"
          className={SIDE_TOOL_ICON}
        >
          <IconLogOut width={16} height={16} />
        </button>
        <span className="mt-1.5" title={`${name}, ${role}`}>
          {avatarChip}
          <span className="sr-only">
            {name}, {role}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-white/10 px-2.5 pb-3 pt-2.5">
      <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
        {onSearch && (
          <button type="button" onClick={onSearch} className={SIDE_TOOL}>
            <IconSearch width={15} height={15} className="shrink-0" />
            <span className="truncate">Search</span>
          </button>
        )}
        {onToggleFold && (
          <button
            type="button"
            onClick={onToggleFold}
            aria-expanded={true}
            aria-controls={NAV_ID}
            className={SIDE_TOOL}
          >
            <FoldIcon width={15} height={15} className="shrink-0" />
            <span className="truncate">{foldLabel}</span>
          </button>
        )}
        <Link href="/" className={SIDE_TOOL}>
          <IconExternalLink width={15} height={15} className="shrink-0" />
          <span className="truncate">View site</span>
        </Link>
        <button type="button" onClick={onSignOut} className={SIDE_TOOL}>
          <IconLogOut width={15} height={15} className="shrink-0" />
          <span className="truncate">Sign out</span>
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5 rounded-xl bg-white/5 px-2.5 py-2">
        {avatarChip}
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[13px] font-semibold text-white">{name}</span>
          <span className="mt-1 inline-block max-w-full truncate rounded-full bg-[#7FE0E4]/15 px-2 py-px text-[11px] font-semibold text-[#7FE0E4]">
            {role}
          </span>
        </span>
      </div>
    </div>
  );
}
