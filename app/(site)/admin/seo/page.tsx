import { AdminSeoMeta } from '@/components/admin/AdminSeoMeta';
import { AdminSeoHealth } from '@/components/admin/AdminSeoHealth';
import { AdminSearchConsole } from '@/components/admin/AdminSearchConsole';
import { buildSeoPageGroups, buildAuditPages } from '@/lib/seo/page-groups';

export const runtime = 'edge';

/** Server component: the editable-page list and the audit's page set are built here (attractions
 *  and blog posts come from the DB) and handed to the client, so ~90 pages of default titles never
 *  ship in the client bundle. Search Console loads client-side — it needs a server-only key, so it
 *  goes through its own gated route rather than blocking this page's render. */
export default async function AdminSeoPage() {
  const [groups, auditPages] = await Promise.all([buildSeoPageGroups(), buildAuditPages()]);
  return (
    <>
      <AdminSearchConsole />
      <AdminSeoHealth basePages={auditPages} />
      <AdminSeoMeta groups={groups} />
    </>
  );
}
