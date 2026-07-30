import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export default async function TransferNotFound() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Airport transfers')}
      title={t('Transfer not found')}
      intro={t("We couldn't find that hotel transfer page.")}
    >
      <p className="text-[15px] text-ink/75">
        {t('Browse all')}{' '}
        <Link href="/airport-transfers" className="font-bold text-teal hover:text-teal-dark">
          {t('Mauritius airport transfers')}
        </Link>{' '}
        {t('or message us for a quote to any hotel.')}
      </p>
    </InfoPage>
  );
}
