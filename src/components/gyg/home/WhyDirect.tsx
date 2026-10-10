import { getT } from '@/lib/i18n/server';
import { SITE } from '@/lib/seo/site';

/**
 * Why book here rather than through a marketplace — the one thing this site can say that a reseller
 * cannot. Set as a statement and a plain list of facts rather than a row of icon badges.
 *
 * Every line restates a claim the site already made (the old trust strip, the meta description).
 * Add a fact here only when it is true and the owner has confirmed it.
 */
export async function WhyDirect() {
  const t = await getT();
  // The rating is deliberately absent: the hero states it and the reviews section directly below
  // this one opens with it. A third copy here would be the page repeating itself.
  const facts: { term: string; detail: string }[] = [
    {
      term: t('Licensed and registered'),
      detail: t('Mauritius business registration {brn}', { brn: SITE.brn }),
    },
    {
      term: t('Book and pay online'),
      detail: t('Instant confirmation'),
    },
    {
      term: t('No commission stops'),
      detail: t('Transparent fixed pricing'),
    },
    {
      term: t('Since the early 2000s'),
      detail: t('A local Mauritian operator, based in Belle Mare'),
    },
  ];

  return (
    <section aria-labelledby="direct-heading" className="mx-auto mt-16 max-w-shell px-6 sm:mt-24">
      <div className="grid gap-x-16 gap-y-8 border-t border-ink/10 pt-10 sm:pt-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <div>
          <h2
            id="direct-heading"
            className="max-w-[16ch] text-[clamp(26px,3.4vw,40px)] font-extrabold leading-[1.08] tracking-[-0.03em] text-ink [text-wrap:balance]"
          >
            {t('Book direct with the local operator')}
          </h2>
          <p className="mt-4 max-w-[44ch] text-[16px] leading-relaxed text-ink/80 [text-wrap:pretty]">
            {t(
              'Belle Mare Tours is the operator, not a marketplace. The price you see is ours, with no reseller markup.',
            )}
          </p>
        </div>

        <dl className="grid content-start gap-x-10 sm:grid-cols-2">
          {facts.map((fact) => (
            <div key={fact.term} className="border-b border-ink/10 py-4">
              <dt className="text-[16px] font-bold leading-snug text-ink">{fact.term}</dt>
              <dd className="mt-1 text-[14px] leading-relaxed text-ink-muted">{fact.detail}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
