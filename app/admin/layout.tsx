import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { Logo } from '@/components/site/Logo';
import { IconArrowRight } from '@/components/ui/icons';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-ink/10 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <Logo tone="light" />
          <span className="rounded-full bg-teal/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-teal-dark">
            Admin
          </span>
          <nav className="ml-auto flex items-center gap-1 text-sm font-bold">
            <Link href="/admin/bookings" className="rounded-lg px-3 py-1.5 text-ink hover:bg-cream hover:text-teal">
              Bookings
            </Link>
            <Link href="/admin/activities" className="rounded-lg px-3 py-1.5 text-ink hover:bg-cream hover:text-teal">
              Activities
            </Link>
            <Link href="/admin/categories" className="rounded-lg px-3 py-1.5 text-ink hover:bg-cream hover:text-teal">
              Categories
            </Link>
            <Link href="/admin/leads" className="rounded-lg px-3 py-1.5 text-ink hover:bg-cream hover:text-teal">
              Leads
            </Link>
            <Link
              href="/"
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-ink-muted hover:text-teal"
            >
              View site <IconArrowRight width={14} height={14} />
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <AdminGuard>{children}</AdminGuard>
      </main>
    </div>
  );
}
