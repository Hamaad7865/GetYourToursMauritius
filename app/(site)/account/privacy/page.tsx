import type { Metadata } from 'next';
import { AccountPrivacy } from '@/components/account/AccountPrivacy';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Data & privacy',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return <AccountPrivacy />;
}
