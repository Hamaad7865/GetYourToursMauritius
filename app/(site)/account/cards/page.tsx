import type { Metadata } from 'next';
import { AccountSavedCards } from '@/components/account/AccountSavedCards';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Saved cards',
  robots: { index: false, follow: false },
};

export default function AccountSavedCardsPage() {
  return <AccountSavedCards />;
}
