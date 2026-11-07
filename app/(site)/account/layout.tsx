import type { ReactNode } from 'react';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { AccountHero, AccountRail } from '@/components/account/AccountChrome';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <GygHeader sticky showSearch={false} />
      <main className="bg-[#F7F8FA]">
        <AccountHero />
        {/* Pulled up over the hero's bottom edge, so the rail and the first card sit on the band.
            grid-cols-1 (= minmax(0,1fr)) + min-w-0 let the columns SHRINK below their content so the
            mobile nav's overflow-x-auto can scroll instead of expanding the page (grid min-width:auto trap). */}
        <div className="relative mx-auto -mt-14 grid max-w-shell grid-cols-1 gap-5 px-6 pb-16 sm:-mt-16 sm:grid-cols-[220px_1fr] lg:gap-7">
          <aside className="min-w-0 self-start">
            <AccountRail />
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
