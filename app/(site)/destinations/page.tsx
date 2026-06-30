import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { areas, AREA_REGION_ORDER, type Area } from '@/lib/content/areas';
import { breadcrumbListJsonLd, itemListJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const TITLE = 'Mauritius Destinations — Area Guides by Region';
const DESCRIPTION =
  'Where to go in Mauritius: local guides to the island’s top areas — Grand Baie, Flic-en-Flac, Belle Mare, Le Morne, Tamarin and more. Things to do, beaches, what each area is good for, and how to get there with Belle Mare Tours.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: ['Mauritius destinations', 'where to stay in Mauritius', 'Mauritius areas', 'Grand Baie', 'Flic-en-Flac', 'Belle Mare'],
  alternates: { canonical: '/destinations' },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: `${SITE.url}/destinations`, locale: 'en_GB', images: [OG_IMAGE] },
};

function AreaCard({ a }: { a: Area }) {
  return (
    <Link
      href={a.path}
      className="group flex flex-col rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="text-[11px] font-bold uppercase tracking-wide text-teal">{a.region} coast</div>
      <h3 className="mt-1 text-[17px] font-extrabold leading-snug text-ink group-hover:text-teal">{a.name}</h3>
      <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-ink/70">{a.intro}</p>
      {a.goodFor.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {a.goodFor.slice(0, 3).map((g) => (
            <span key={g} className="rounded-full bg-teal-tint px-2.5 py-0.5 text-[11px] font-semibold text-teal-dark">
              {g}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}

export default function DestinationsIndexPage() {
  const groups = AREA_REGION_ORDER.map((region) => ({ region, items: areas.filter((a) => a.region === region) })).filter(
    (g) => g.items.length > 0,
  );
  const breadcrumb = breadcrumbListJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Destinations', path: '/destinations' },
  ]);
  const itemList = itemListJsonLd(areas.map((a) => ({ name: `${a.name}, Mauritius`, path: a.path })));

  return (
    <>
      <JsonLd data={breadcrumb} />
      <JsonLd data={itemList} />
      <InfoPage eyebrow="Mauritius destinations" title="Where to go in Mauritius" intro={DESCRIPTION}>
        {groups.map((g) => (
          <section key={g.region} className="border-t border-ink/10 py-9 first:border-t-0 first:pt-0">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">{g.region} coast</h2>
            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((a) => (
                <AreaCard key={a.slug} a={a} />
              ))}
            </div>
          </section>
        ))}
      </InfoPage>
    </>
  );
}
