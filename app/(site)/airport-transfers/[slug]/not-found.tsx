import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';

export const runtime = 'edge';

export default function TransferNotFound() {
  return (
    <InfoPage
      eyebrow="Airport transfers"
      title="Transfer not found"
      intro="We couldn't find that hotel transfer page."
    >
      <p className="text-[15px] text-ink/75">
        See all{' '}
        <Link href="/airport-transfers" className="font-bold text-teal hover:text-teal-dark">
          Mauritius airport transfers
        </Link>{' '}
        or message us for a quote to any hotel.
      </p>
    </InfoPage>
  );
}
