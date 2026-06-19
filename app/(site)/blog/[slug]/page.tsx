import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { InfoPage, EnquireRow } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { getPost, relatedPosts, formatPostDate } from '@/lib/content/blog';
import { articleJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

// Internal paths the writers wove into the prose → turned into real links with friendly labels.
const LINK_LABELS: Record<string, string> = {
  '/airport-transfers': 'airport transfers',
  '/ai-road-trip-planner': 'AI trip planner',
  '/attractions': 'things to do in Mauritius',
  '/activities': 'tours & activities',
};
const LINK_RE = /(\/airport-transfers|\/ai-road-trip-planner|\/attractions|\/activities)/g;

function renderWithLinks(text: string): ReactNode[] {
  return text.split(LINK_RE).map((part, i) =>
    LINK_LABELS[part] ? (
      <Link key={i} href={part} className="font-semibold text-teal underline underline-offset-2 hover:text-teal-dark">
        {LINK_LABELS[part]}
      </Link>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) return { title: 'Article not found' };
  const title = p.metaTitle || p.title;
  const description = p.metaDescription;
  return {
    title,
    description,
    alternates: { canonical: p.path },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `${SITE.url}${p.path}`,
      locale: 'en_GB',
      publishedTime: p.datePublished,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const p = getPost(slug);
  if (!p) notFound();
  const related = relatedPosts(p.slug, 3);

  return (
    <>
      <JsonLd data={articleJsonLd({ title: p.title, description: p.metaDescription, path: p.path, datePublished: p.datePublished })} />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Blog', path: '/blog' },
          { name: p.title, path: p.path },
        ])}
      />
      {p.faq.length > 0 && <JsonLd data={faqPageJsonLd(p.faq)} />}

      <InfoPage
        eyebrow={`Mauritius travel blog · ${p.readMins} min read`}
        title={p.title}
        intro={p.excerpt}
        meta={`Published ${formatPostDate(p.datePublished)} by ${SITE.operator}`}
      >
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
          <Link href="/" className="hover:text-teal">Home</Link>
          <span className="text-ink/25">/</span>
          <Link href="/blog" className="hover:text-teal">Blog</Link>
          <span className="text-ink/25">/</span>
          <span className="font-semibold text-ink">{p.title}</span>
        </nav>

        <article className="max-w-3xl">
          {p.sections.map((section) => (
            <section key={section.heading} className="mt-8 first:mt-0">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">{section.heading}</h2>
              <div className="mt-3 flex flex-col gap-3.5">
                {section.paragraphs.map((para, i) => (
                  <p key={i} className="m-0 text-[15.5px] leading-relaxed text-ink/80">
                    {renderWithLinks(para)}
                  </p>
                ))}
              </div>
            </section>
          ))}

          {p.faq.length > 0 && (
            <section className="mt-10 border-t border-ink/10 pt-8">
              <h2 className="text-[22px] font-extrabold tracking-tight text-ink">Frequently asked questions</h2>
              <div className="mt-4 flex flex-col gap-2.5">
                {p.faq.map((f) => (
                  <details key={f.q} className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40">
                    <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">{f.q}</summary>
                    <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </article>

        {related.length > 0 && (
          <section className="mt-12 border-t border-ink/10 pt-8">
            <h2 className="text-[20px] font-extrabold tracking-tight text-ink">Keep reading</h2>
            <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-3">
              {related.map((r) => (
                <Link
                  key={r.slug}
                  href={r.path}
                  className="group rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
                >
                  <div className="text-[12px] font-semibold text-ink-muted">{r.readMins} min read</div>
                  <h3 className="mt-1.5 text-[15.5px] font-extrabold leading-snug text-ink group-hover:text-teal">{r.title}</h3>
                </Link>
              ))}
            </div>
          </section>
        )}

        <EnquireRow message={`Hi Belle Mare Tours! I read your guide "${p.title}" and I'd like to plan a trip.`} />
      </InfoPage>
    </>
  );
}
