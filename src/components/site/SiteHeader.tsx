import Link from 'next/link';
import { Logo } from './Logo';
import { CATEGORIES } from '@/lib/seo/site';
import { IconChevron, IconSearch } from '@/components/ui/icons';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-ink/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-shell items-center gap-5 px-6 py-3">
        <Logo />

        <Link
          href="/activities"
          className="hidden flex-1 items-center gap-3 rounded-xl border border-ink/12 bg-cream/60 px-3 py-2.5 text-left md:flex"
        >
          <IconSearch className="text-teal" />
          <span className="flex-1 text-sm font-medium text-ink-muted">
            Search activities, locations…
          </span>
          <span className="rounded-lg bg-coral px-3.5 py-2 text-[13px] font-bold text-white">
            Search
          </span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Link
            href="/account"
            className="rounded-[10px] px-3 py-2.5 text-sm font-semibold text-ink hover:bg-ink/5"
          >
            Log in
          </Link>
          <Link
            href="/account"
            className="rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
          >
            Sign up
          </Link>
        </div>
      </div>

      <nav aria-label="Browse activities" className="border-t border-ink/[0.07] bg-white/60">
        <div className="no-bar mx-auto flex max-w-shell items-center gap-1 overflow-x-auto px-6">
          <span className="flex items-center gap-1 py-3 pr-2 text-sm font-semibold text-ink">
            Things to do <IconChevron width={16} height={16} className="text-ink-muted" />
          </span>
          {CATEGORIES.map((category) => (
            <Link
              key={category}
              href={`/activities?category=${encodeURIComponent(category)}`}
              className="whitespace-nowrap rounded-lg px-3 py-3 text-sm font-medium text-ink-muted hover:text-teal"
            >
              {category}
            </Link>
          ))}
        </div>
      </nav>
    </header>
  );
}
