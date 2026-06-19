import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';

export const runtime = 'edge';

export default function AttractionNotFound() {
  return (
    <InfoPage
      eyebrow="Attractions"
      title="Attraction not found"
      intro="We couldn't find that place. It may have been renamed or removed."
    >
      <p className="text-[15px] text-ink/75">
        Browse all{' '}
        <Link href="/attractions" className="font-bold text-teal hover:text-teal-dark">
          things to do in Mauritius
        </Link>{' '}
        or{' '}
        <Link href="/activities" className="font-bold text-teal hover:text-teal-dark">
          our tours and activities
        </Link>
        .
      </p>
    </InfoPage>
  );
}
