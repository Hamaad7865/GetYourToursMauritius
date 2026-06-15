import type { ReactNode } from 'react';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { AccountNav } from '@/components/account/AccountChrome';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="bg-white">
        <div className="mx-auto grid max-w-shell gap-8 px-6 py-10 sm:grid-cols-[200px_1fr]">
          <aside className="sm:pt-1">
            <AccountNav />
          </aside>
          <section>{children}</section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
