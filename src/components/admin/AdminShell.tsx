'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useDialog } from '@/lib/a11y/useDialog';
import { Logo } from '@/components/site/Logo';
import { AdminBell } from '@/components/admin/AdminBell';
import { avatar } from '@/lib/admin/dashboard';
import {
  IconGrid,
  IconBookings,
  IconTag,
  IconSliders,
  IconWallet,
  IconCar,
  IconPin,
  IconUsers,
  IconSearch,
  IconPlus,
  IconMenu,
  IconX,
  IconArrowRight,
  IconLogOut,
  IconTrendUp,
  IconDocument,
  IconSwap,
  IconChart,
  IconCalendar,
} from '@/components/ui/icons';

interface NavItem {
  href: string;
  label: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
  /** When true the item is also shown to the restricted 'seo' content role. */
  seo?: boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconGrid, exact: true },
  { href: '/admin/bookings', label: 'Bookings', icon: IconBookings },
  // Operations calendar — shows guest names, so deliberately NOT seo-flagged (RLS locks that role
  // out of bookings/occurrences anyway; this is just navigation).
  { href: '/admin/calendar', label: 'Calendar', icon: IconCalendar },
  // Financial — deliberately NOT seo-flagged; the seo content role is RLS-locked out of bookings/payments.
  { href: '/admin/reports', label: 'Reports', icon: IconChart },
  { href: '/admin/activities', label: 'Tours', icon: IconTag, seo: true },
  { href: '/admin/categories', label: 'Categories', icon: IconSliders },
  { href: '/admin/content', label: 'Standard content', icon: IconDocument },
  { href: '/admin/vehicle-pricing', label: 'Pricing', icon: IconWallet },
  { href: '/admin/rental', label: 'Rental', icon: IconCar },
  { href: '/admin/planner-places', label: 'Places', icon: IconPin, seo: true },
  { href: '/admin/seo', label: 'SEO', icon: IconTrendUp, seo: true },
  { href: '/admin/blog', label: 'Blog', icon: IconDocument, seo: true },
  { href: '/admin/redirects', label: 'Redirects', icon: IconSwap, seo: true },
  { href: '/admin/leads', label: 'Leads', icon: IconUsers },
];

/** Sections visible to a role: the 'seo' content role sees only the seo-flagged items; staff/admin
 *  see everything. RLS enforces the same boundary server-side — this is just navigation. */
function navForRole(role: string | undefined): NavItem[] {
  return role === 'seo' ? NAV.filter((n) => n.seo) : NAV;
}

const BOTTOM_NAV_HREFS = ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'];
const BOTTOM_NAV_HREFS_SEO = ['/admin/seo', '/admin/blog', '/admin/activities', '/admin/redirects'];

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** The dark-teal back-office shell: sticky sidebar (desktop), frosted top bar, and a slide-in
 *  drawer + bottom nav on mobile. Renders the active screen as `children`. */
export function AdminShell({ children }: { children: ReactNode }) {
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

  const name = profile?.fullName || user?.email?.split('@')[0] || 'Staff';
  const isSeoRole = profile?.role === 'seo';
  const items = navForRole(profile?.role);
  const bottomHrefs = isSeoRole ? BOTTOM_NAV_HREFS_SEO : BOTTOM_NAV_HREFS;
  const bottomNav = items.filter((n) => bottomHrefs.includes(n.href));
  const role = profile?.role
    ? isSeoRole
      ? 'SEO'
      : profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : 'Staff';
  const { initials, hue } = avatar(name);

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    // min-h-0 + overflow-y-auto: with 14 items the nav can exceed the viewport, and this is a
    // flex child of an h-dvh column — without min-h-0 it refuses to shrink and clips Dashboard and
    // the sign-out chip off the top and bottom with no way to scroll to them.
    <nav className="slim-bar-dark flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-3">
      {items.map((item) => {
        const active = isActive(pathname, item);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
              active ? 'bg-teal text-white' : 'text-cream/55 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon width={19} height={19} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const userChip = (
    <div className="flex items-center gap-3 rounded-xl bg-white/5 p-2.5">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{ background: `hsl(${hue} 42% 46%)` }}
      >
        {initials}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13.5px] font-bold text-white">{name}</span>
        <span className="block text-[11.5px] text-cream/45">{role} · Belle Mare</span>
      </span>
      <button
        onClick={() => void signOut()}
        aria-label="Sign out"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cream/55 hover:bg-white/10 hover:text-white"
      >
        <IconLogOut width={17} height={17} />
      </button>
    </div>
  );

  return (
    <div className="flex min-h-dvh bg-[#F7F8FA]">
      {/* ===== Desktop sidebar ===== */}
      <aside className="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col bg-ink text-cream/70 lg:flex print:hidden">
        <SidebarHeader />
        <NavList />
        <div className="border-t border-white/10 p-3">{userChip}</div>
      </aside>

      {/* ===== Mobile drawer ===== */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/50"
            onClick={() => setDrawer(false)}
            aria-hidden
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            className="absolute inset-y-0 left-0 flex w-[260px] max-w-[82%] flex-col bg-ink text-cream/70 shadow-2xl"
          >
            <div className="flex items-center justify-between pr-2">
              <SidebarHeader />
              <button
                ref={drawerCloseRef}
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-cream/60 hover:bg-white/10 hover:text-white"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
            <NavList onNavigate={() => setDrawer(false)} />
            <div className="border-t border-white/10 p-3">{userChip}</div>
          </div>
        </div>
      )}

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-[#E7EBEE] bg-white/90 px-4 py-3 backdrop-blur sm:px-6 print:hidden">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E7EA] text-ink lg:hidden"
          >
            <IconMenu width={19} height={19} />
          </button>
          {!isSeoRole && (
            <form
              onSubmit={submitSearch}
              role="search"
              className="relative hidden max-w-md flex-1 sm:block"
            >
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
                <IconSearch width={17} height={17} />
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="search"
                enterKeyHint="search"
                aria-label="Search bookings and customers"
                placeholder="Search bookings, customers…"
                className="w-full rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] py-2.5 pl-10 pr-3 text-sm text-ink outline-none focus:border-teal focus:bg-white"
              />
            </form>
          )}
          <div className="ml-auto flex items-center gap-2.5">
            {!isSeoRole && <AdminBell />}
            <Link
              href="/admin/activities/new"
              className="hidden items-center gap-1.5 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white hover:bg-teal-dark sm:flex"
            >
              <IconPlus width={16} height={16} /> New tour
            </Link>
            <Link
              href="/"
              className="hidden items-center gap-1 rounded-xl border border-[#E2E7EA] px-3 py-2.5 text-[13px] font-bold text-ink-muted hover:border-teal hover:text-teal md:flex"
            >
              View site <IconArrowRight width={14} height={14} />
            </Link>
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-[13px] font-bold text-white"
              style={{ background: `hsl(${hue} 42% 46%)` }}
              aria-hidden
            >
              {initials}
            </span>
          </div>
        </header>

        {/* Screen content */}
        <main className="mx-auto w-full max-w-[1320px] flex-1 px-4 pb-24 pt-6 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#E7EBEE] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden print:hidden">
          {bottomNav.map((item) => {
            const active = isActive(pathname, item);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-bold ${
                  active ? 'text-teal' : 'text-ink-muted'
                }`}
              >
                <Icon width={20} height={20} />
                {item.label}
              </Link>
            );
          })}
          <button
            onClick={() => setDrawer(true)}
            className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[10.5px] font-bold text-ink-muted"
          >
            <IconMenu width={20} height={20} />
            More
          </button>
        </nav>
      </div>
    </div>
  );
}

function SidebarHeader() {
  // The real brand logo (white-script `logo-dark.svg`, made for this dark sidebar), linking to the
  // dashboard rather than the public home. The artwork already carries the wordmark, so the only
  // text beside it is the small BACK OFFICE caption.
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
      <Logo
        tone="dark"
        href="/admin"
        className="h-11 w-auto"
        label="Belle Mare Tours — back office home"
      />
      <span className="mt-1 self-start text-[9px] font-bold tracking-[0.32em] text-teal-bright">
        BACK OFFICE
      </span>
    </div>
  );
}
