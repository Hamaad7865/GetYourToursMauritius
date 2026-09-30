import type { Metadata } from 'next';
import { AccountGalleries } from '@/components/account/AccountGalleries';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'My galleries',
  robots: { index: false, follow: false },
};

export default function GalleriesPage() {
  return <AccountGalleries />;
}
