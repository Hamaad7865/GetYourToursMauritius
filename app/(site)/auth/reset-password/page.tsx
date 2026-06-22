import type { Metadata } from 'next';
import { ResetPassword } from '@/components/auth/ResetPassword';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return <ResetPassword />;
}
