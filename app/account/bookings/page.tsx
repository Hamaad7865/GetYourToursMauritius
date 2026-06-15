import type { Metadata } from 'next';
import { AccountBookings } from '@/components/account/AccountBookings';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'My bookings',
  robots: { index: false, follow: false },
};

export default function BookingsPage() {
  return <AccountBookings />;
}
