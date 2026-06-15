import Link from 'next/link';
import { ActivityForm } from '@/components/admin/ActivityForm';

export const runtime = 'edge';

export default async function EditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div>
      <Link href="/admin/activities" className="text-sm font-bold text-teal hover:text-teal-dark">
        ← Activities
      </Link>
      <h1 className="mb-6 mt-2 font-display text-2xl font-semibold text-ink">Edit activity</h1>
      <ActivityForm mode="edit" id={id} />
    </div>
  );
}
