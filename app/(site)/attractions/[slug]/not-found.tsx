import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export default async function AttractionNotFound() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Things to do in Mauritius')}
      title={t('Attraction not found')}
      intro={t("We couldn't find that place. It may have been renamed or removed.")}
    >
      <p className="text-[15px] text-ink/75">
        {t('Browse all')}{' '}
        <Link href="/attractions" className="font-bold text-teal hover:text-teal-dark">
          {t('things to do in Mauritius')}
        </Link>{' '}
        {t('or')}{' '}
        <Link href="/activities" className="font-bold text-teal hover:text-teal-dark">
          {t('our tours and activities')}
        </Link>
        .
      </p>
    </InfoPage>
  );
}
