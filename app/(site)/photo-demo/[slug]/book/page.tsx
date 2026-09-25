import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { DemoBooking } from '@/components/photo-demo/DemoBooking';
import { getDemoPackage } from '@/components/photo-demo/data';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Photo demo — book',
  robots: { index: false },
};

export default async function PhotoDemoBookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pkg = getDemoPackage(slug);
  if (!pkg) notFound();

  return (
    <>
      <GygHeader />
      <main className="bg-white text-ink">
        <div className="mx-auto max-w-shell px-6 py-8 sm:py-10">
          <DemoBooking pkg={pkg} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
