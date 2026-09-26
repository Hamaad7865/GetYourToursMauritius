import { PhotographyStudio } from '@/components/admin/PhotographyStudio';

export const runtime = 'edge';

export default async function EditPhotographyPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PhotographyStudio id={id} />;
}
