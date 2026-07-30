import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export default async function PostNotFound() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Blog')}
      title={t('Article not found')}
      intro={t("We couldn't find that guide.")}
    >
      <p className="text-[15px] text-ink/75">
        {t('Browse all')}{' '}
        <Link href="/blog" className="font-bold text-teal hover:text-teal-dark">
          {t('Mauritius travel guides')}
        </Link>
        .
      </p>
    </InfoPage>
  );
}
