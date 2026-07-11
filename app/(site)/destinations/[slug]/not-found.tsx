import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';

export const runtime = 'edge';

export default function DestinationNotFound() {
  return (
    <InfoPage
      eyebrow="Destinations"
      title="Destination not found"
      intro="We couldn't find that area guide."
    >
      <p className="text-[15px] text-ink/75">
        See all{' '}
        <Link href="/destinations" className="font-bold text-teal hover:text-teal-dark">
          Mauritius destinations
        </Link>
        .
      </p>
    </InfoPage>
  );
}
