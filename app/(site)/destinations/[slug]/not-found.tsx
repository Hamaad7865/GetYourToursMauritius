import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export default async function DestinationNotFound() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Destinations')}
      title={t('Destination not found')}
      intro={t("We couldn't find that area guide.")}
    >
      <p className="text-[15px] text-ink/75">
        {t('Explore all')}{' '}
        <Link href="/destinations" className="font-bold text-teal hover:text-teal-dark">
          {t('Mauritius destinations')}
        </Link>
        .
      </p>
    </InfoPage>
  );
}
