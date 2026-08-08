'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
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
  BOTTOM_NAV_HREFS,
  BOTTOM_NAV_HREFS_SEO,
  isActive,
  navForRole,
} from '@/components/admin/nav';
import {
  IconSearch,
  IconPlus,
  IconMenu,
  IconX,
  IconArrowRight,
  IconLogOut,
} from '@/components/ui/icons';

// The assistant column is loaded on demand and never on the server: it is reachable from every
// admin screen, so a static import would put the whole chat in the first paint of each of them.
const AssistantPanel = dynamic(
  () => import('@/components/admin/assistant/AssistantPanel').then((m) => m.AssistantPanel),
  { ssr: false },
);

/** The dark-teal back-office shell: sticky sidebar (desktop), frosted top bar, and a slide-in
 *  drawer + bottom nav on mobile. Renders the active screen as `children`, beside the assistant. */
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
    // min-h-0 + overflow-y-auto: with this many items the nav can exceed the viewport, and this is a
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
            {!isSeoRole && <AssistantLauncher />}
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

        {/* Screen content. `max-w-[1320px]` is a cap, not a width, so when the assistant column
            opens this simply reflows narrower — nothing is occluded (the owner's note: the centre
            should diminish, not get covered). */}
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

      {/* ===== The assistant column =====
          A SIBLING of the main column, not an overlay: from lg it animates its own width, so the
          content beside it reflows. Below lg it fixes itself over the screen (no room to split). */}
      {!isSeoRole && <AssistantPanel />}
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
