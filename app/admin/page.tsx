import { redirect } from 'next/navigation';

export const runtime = 'edge';

export default function AdminHome() {
  redirect('/admin/activities');
}
