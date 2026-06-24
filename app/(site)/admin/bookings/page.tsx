import { Suspense } from 'react';
import { AdminBookings } from '@/components/admin/AdminBookings';

export const runtime = 'edge';

export default function AdminBookingsPage() {
  // AdminBookings reads ?q= (seeded by the global top-bar search) via useSearchParams, so it must sit
  // under a Suspense boundary for the build/prerender.
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-ink-muted">Loading…</p>}>
      <AdminBookings />
    </Suspense>
  );
}
