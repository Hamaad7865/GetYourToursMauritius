import type { ReactNode } from 'react';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { AccountNav } from '@/components/account/AccountChrome';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="bg-white">
        {/* grid-cols-1 (= minmax(0,1fr)) + min-w-0 let the columns SHRINK below their content so the
            mobile nav's overflow-x-auto can scroll instead of expanding the page (grid min-width:auto trap). */}
        <div className="mx-auto grid max-w-shell grid-cols-1 gap-8 px-6 py-10 sm:grid-cols-[200px_1fr]">
          <aside className="min-w-0 sm:pt-1">
            <AccountNav />
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
