'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
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
} from '@/components/ui/icons';

interface NavItem {
  href: string;
  label: string;
  icon: (p: { width?: number; height?: number }) => ReactNode;
  exact?: boolean;
}

const NAV: NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: IconGrid, exact: true },
  { href: '/admin/bookings', label: 'Bookings', icon: IconBookings },
  { href: '/admin/activities', label: 'Tours', icon: IconTag },
  { href: '/admin/categories', label: 'Categories', icon: IconSliders },
  { href: '/admin/vehicle-pricing', label: 'Pricing', icon: IconWallet },
  { href: '/admin/rental', label: 'Rental', icon: IconCar },
  { href: '/admin/planner-places', label: 'Places', icon: IconPin },
  { href: '/admin/leads', label: 'Leads', icon: IconUsers },
];

const BOTTOM_NAV = NAV.filter((n) =>
  ['/admin', '/admin/bookings', '/admin/activities', '/admin/leads'].includes(n.href),
);

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

  // Global search → the Bookings screen (which filters by ref / name / email and seeds from ?q=).
  // Customers live on bookings too, so this covers "bookings & customers"; Tours has its own on-page search.
  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(`/admin/bookings?q=${encodeURIComponent(q)}`);
  };

  const name = profile?.fullName || user?.email?.split('@')[0] || 'Staff';
  const role = profile?.role
    ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1)
    : 'Staff';
  const { initials, hue } = avatar(name);

  const NavList = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {NAV.map((item) => {
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
      <aside className="sticky top-0 hidden h-dvh w-[250px] shrink-0 flex-col bg-ink text-cream/70 lg:flex">
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
          <aside className="absolute inset-y-0 left-0 flex w-[260px] max-w-[82%] flex-col bg-ink text-cream/70 shadow-2xl">
            <div className="flex items-center justify-between pr-2">
              <SidebarHeader />
              <button
                onClick={() => setDrawer(false)}
                aria-label="Close menu"
                className="mr-2 flex h-9 w-9 items-center justify-center rounded-lg text-cream/60 hover:bg-white/10 hover:text-white"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
            <NavList onNavigate={() => setDrawer(false)} />
            <div className="border-t border-white/10 p-3">{userChip}</div>
          </aside>
        </div>
      )}

      {/* ===== Main column ===== */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-[#E7EBEE] bg-white/90 px-4 py-3 backdrop-blur sm:px-6">
          <button
            onClick={() => setDrawer(true)}
            aria-label="Open menu"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#E2E7EA] text-ink lg:hidden"
          >
            <IconMenu width={19} height={19} />
          </button>
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
          <div className="ml-auto flex items-center gap-2.5">
            <AdminBell />
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
        <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#E7EBEE] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {BOTTOM_NAV.map((item) => {
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
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-bright to-teal-dark text-white">
        <IconGrid width={20} height={20} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className="whitespace-nowrap text-[15px] font-extrabold tracking-tight text-white">
          Belle Mare Tours
        </span>
        <span className="mt-1 text-[9px] font-bold tracking-[0.32em] text-teal-bright">
          BACK OFFICE
        </span>
      </span>
    </div>
  );
}
