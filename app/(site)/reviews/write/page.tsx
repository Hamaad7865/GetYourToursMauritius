import { InfoPage } from '@/components/site/InfoPage';
import { ReviewWriteForm } from '@/components/site/ReviewWriteForm';
import { publicServiceContext } from '@/lib/http/context';
import { getReviewInviteContext } from '@/lib/services/reviews';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export default async function ReviewWritePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const context = token ? await getReviewInviteContext(publicServiceContext(), token) : null;

  if (!token || !context) {
    return (
      <InfoPage
        eyebrow="Review"
        title="This link has expired"
        intro="This review link is no longer valid — it may have already been used or has expired."
      >
        <p className="text-sm text-ink/70">
          Thanks for your interest in leaving a review! If you think this is a mistake, get in touch
          and we&apos;ll sort it out.
        </p>
      </InfoPage>
    );
  }

  return (
    <InfoPage
      eyebrow="Review"
      title="Tell us about your trip"
      intro="A couple of minutes is all it takes — your review helps other travellers pick the right trip."
    >
      <ReviewWriteForm
        token={token}
        activityTitle={context.activityTitle}
        googleReviewUrl={SITE.googleReview}
      />
    </InfoPage>
  );
}
