import Link from 'next/link';
import type { Crumb } from '@/lib/catalogue/detail';

/** Breadcrumb trail with the current page title rendered as the (non-link) last item. */
export function Breadcrumb({ trail, current }: { trail: Crumb[]; current: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted"
    >
      {trail.map((crumb) => (
        <span key={crumb.href} className="flex items-center gap-2">
          <Link href={crumb.href} className="text-ink-muted hover:text-teal">
            {crumb.label}
          </Link>
          <span aria-hidden className="text-ink/25">
            /
          </span>
        </span>
      ))}
      <span className="font-semibold text-ink">{current}</span>
    </nav>
  );
}
