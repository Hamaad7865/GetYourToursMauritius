import Link from 'next/link';
import { ActivityForm } from '@/components/admin/ActivityForm';
import { IconChevron } from '@/components/ui/icons';
import { AdminHeading } from '@/components/admin/ui';

export const runtime = 'edge';

export default async function EditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div>
      <Link
        href="/admin/activities"
        className="mb-2 inline-flex items-center gap-1 text-[13.5px] font-semibold text-ink-muted hover:text-teal"
      >
        <IconChevron width={15} height={15} className="rotate-90" /> Back to tours
      </Link>
      <AdminHeading title="Edit tour" />
      <ActivityForm mode="edit" id={id} />
    </div>
  );
}
