import type { Metadata } from 'next';
import { AccountProfile } from '@/components/account/AccountProfile';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return <AccountProfile />;
}
