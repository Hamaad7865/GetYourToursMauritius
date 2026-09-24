import { PhotographyPackageForm } from '@/components/admin/PhotographyPackageForm';
import { notFound } from 'next/navigation';
import { PHOTOGRAPHY_SHOOTS } from '@/lib/catalogue/photography-shoots';

export const runtime = 'edge';

export default async function NewPhotographyPackagePage({
  searchParams,
}: {
  searchParams: Promise<{ template?: string }>;
}) {
  const { template: key } = await searchParams;
  const template = PHOTOGRAPHY_SHOOTS.find((shoot) => shoot.key === key);
  if (key && !template) notFound();
  return <PhotographyPackageForm template={template} />;
}
