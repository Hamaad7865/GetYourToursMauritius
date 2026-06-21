import type { Metadata } from 'next';
import { AccountNotifications } from '@/components/account/AccountNotifications';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false, follow: false },
};

export default function AccountNotificationsPage() {
  return <AccountNotifications />;
}
