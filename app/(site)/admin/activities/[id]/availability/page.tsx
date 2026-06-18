import { AvailabilityEditor } from '@/components/admin/AvailabilityEditor';

export const runtime = 'edge';

export default async function AvailabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AvailabilityEditor activityId={id} />;
}
