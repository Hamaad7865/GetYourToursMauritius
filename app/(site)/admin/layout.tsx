import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminAccessProvider } from '@/components/admin/AdminAccessProvider';
import { AdminGuard } from '@/components/admin/AdminGuard';
import { AdminShell } from '@/components/admin/AdminShell';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AdminGuard>
      <AdminAccessProvider>
        <AdminShell>{children}</AdminShell>
      </AdminAccessProvider>
    </AdminGuard>
  );
}
