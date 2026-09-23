import { PhotographyPackageForm } from '@/components/admin/PhotographyPackageForm';

export const runtime = 'edge';

export default async function EditPhotographyPackagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PhotographyPackageForm packageId={id} />;
}
