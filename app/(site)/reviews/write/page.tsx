import { InfoPage } from '@/components/site/InfoPage';
import { ReviewWriteForm } from '@/components/site/ReviewWriteForm';
import { publicServiceContext } from '@/lib/http/context';
import { getReviewInviteContext } from '@/lib/services/reviews';
import { getLocale, getT } from '@/lib/i18n/server';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export default async function ReviewWritePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const [context, t] = await Promise.all([
    token ? getReviewInviteContext(publicServiceContext(await getLocale()), token) : null,
    getT(),
  ]);

  if (!token || !context) {
    return (
      <InfoPage
        eyebrow={t('Review')}
        title={t('This link has expired')}
        intro={t(
          'This review link is no longer valid — it may have already been used or has expired.',
        )}
      >
        <p className="text-sm text-ink/70">
          {t(
            "Thanks for your interest in leaving a review! If you think this is a mistake, get in touch and we'll sort it out.",
          )}
        </p>
      </InfoPage>
    );
  }

  return (
    <InfoPage
      eyebrow={t('Review')}
      title={t('Tell us about your trip')}
      intro={t(
        'A couple of minutes is all it takes — your review helps other travellers pick the right trip.',
      )}
    >
      <ReviewWriteForm
        token={token}
        activityTitle={context.activityTitle}
        tripDate={context.tripDate}
        googleReviewUrl={SITE.googleReview}
      />
    </InfoPage>
  );
}
