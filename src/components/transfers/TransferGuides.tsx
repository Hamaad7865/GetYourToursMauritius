import Link from 'next/link';
import { posts, formatPostDate } from '@/lib/content/blog';

/** Surface the transfer-relevant guides first, then fill up to `count` with the newest posts. */
const PREFERRED = ['mauritius-airport-transfer-guide', 'getting-around-mauritius', 'best-time-to-visit-mauritius'];

/** "Mauritius Airport Transfer Tips & Guides" — links to our own travel guides. */
export function TransferGuides({ count = 3 }: { count?: number }) {
  const preferred = PREFERRED.map((slug) => posts.find((p) => p.slug === slug)).filter(
    (p): p is (typeof posts)[number] => Boolean(p),
  );
  const seen = new Set(preferred.map((p) => p.slug));
  const picked = [...preferred, ...posts.filter((p) => !seen.has(p.slug))].slice(0, count);
  if (picked.length === 0) return null;
  return (
    <section className="mt-12 border-t border-ink/10 pt-9">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Mauritius airport transfer tips &amp; guides</h2>
        <Link href="/blog" className="text-sm font-bold text-teal hover:text-teal-dark">
          Read all guides →
        </Link>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {picked.map((p) => (
          <Link
            key={p.slug}
            href={p.path}
            className="group flex flex-col rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
          >
            <div className="text-[12px] font-semibold text-ink-muted">
              {formatPostDate(p.datePublished)} · {p.readMins} min read
            </div>
            <h3 className="mt-2 text-[17px] font-extrabold leading-snug text-ink group-hover:text-teal">{p.title}</h3>
            <p className="mt-2 text-[14px] leading-snug text-ink/70">{p.excerpt}</p>
            <span className="mt-4 text-sm font-bold text-teal">Read guide →</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
