import type { Metadata } from 'next';
import { InfoPage } from '@/components/site/InfoPage';
import { ReminderOptOut } from '@/components/site/ReminderOptOut';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Stop booking reminders',
  robots: { index: false, follow: false },
};

/** Landing page for the "stop these" link in the one-time checkout-recovery email. */
export default async function StopRemindersPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t: token } = await searchParams;
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Email preferences')}
      title={t('Stop booking reminders')}
      intro={t(
        'We send at most one email when an online booking isn’t completed. Stop them here and we won’t send any more.',
      )}
    >
      {token ? (
        <ReminderOptOut token={token} />
      ) : (
        <p className="text-sm text-ink/70">
          {t(
            'This link is no longer valid. If you keep getting these emails, reply to one and we’ll stop them.',
          )}
        </p>
      )}
    </InfoPage>
  );
}
