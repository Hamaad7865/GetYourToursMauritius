import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';

export const runtime = 'edge';

export default function PostNotFound() {
  return (
    <InfoPage eyebrow="Blog" title="Article not found" intro="We couldn't find that guide.">
      <p className="text-[15px] text-ink/75">
        Browse all{' '}
        <Link href="/blog" className="font-bold text-teal hover:text-teal-dark">
          Mauritius travel guides
        </Link>
        .
      </p>
    </InfoPage>
  );
}
