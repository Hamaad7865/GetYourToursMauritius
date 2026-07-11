import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { posts, formatPostDate, type Post } from '@/lib/content/blog';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const TITLE = 'Mauritius Travel Blog — Guides, Tips & Itineraries';
const DESCRIPTION =
  'Practical Mauritius travel guides from a local tour operator: the best time to visit, things to do, airport transfer advice, day-by-day itineraries, top beaches and waterfalls, and how to save money on tours and transfers.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Mauritius travel blog',
    'Mauritius travel guide',
    'things to do in Mauritius',
    'Mauritius tips',
    'Belle Mare Tours',
  ],
  alternates: { canonical: '/blog' },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}/blog`,
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

function PostCard({ p }: { p: Post }) {
  return (
    <Link
      href={p.path}
      className="group flex flex-col rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="text-[12px] font-semibold text-ink-muted">
        {formatPostDate(p.datePublished)} · {p.readMins} min read
      </div>
      <h2 className="mt-2 text-[18px] font-extrabold leading-snug text-ink group-hover:text-teal">
        {p.title}
      </h2>
      <p className="mt-2 text-[14px] leading-snug text-ink/70">{p.excerpt}</p>
      <span className="mt-4 text-sm font-bold text-teal">Read guide →</span>
    </Link>
  );
}

export default function BlogIndexPage() {
  const breadcrumb = breadcrumbListJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
  ]);
  const itemList = itemListJsonLd(posts.map((p) => ({ name: p.title, path: p.path })));

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <InfoPage
        eyebrow="Mauritius travel blog"
        title="Guides, tips & itineraries for Mauritius"
        intro={DESCRIPTION}
      >
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => (
            <PostCard key={p.slug} p={p} />
          ))}
        </div>
      </InfoPage>
    </>
  );
}
