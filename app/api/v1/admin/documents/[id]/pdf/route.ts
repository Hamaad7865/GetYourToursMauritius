import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser, getBearerToken } from '@/lib/http/auth';
import { createUserClient } from '@/lib/supabase/client';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';
import { ForbiddenError, NotFoundError } from '@/lib/services/errors';
import { DOCUMENT_ISSUER } from '@/lib/documents/issuer';
import { buildDocument } from '@/lib/documents/model';
import { renderDocumentPdf } from '@/lib/documents/pdf';
import { documentInputFromRow } from '@/lib/documents/row';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/admin/documents/:id/pdf — the document's PDF (quote / invoice / proforma / receipt).
 *
 * Staff with the Documents section — checked explicitly (`loadCallerAccess`, service-role read of the
 * caller's role) before anything is read, so a caller without it gets a 403. RLS still scopes the
 * read to staff as a second lock: it runs as the CALLER (their bearer token) and `documents_staff_all`
 * only exposes the row to staff, so a row the caller cannot see 404s. The PDF is rendered on demand
 * from the stored row (never persisted), so it always reflects the current state; a draft (no
 * `issuer_snapshot` yet) falls back to the live business identity so the preview download works
 * before the document is issued.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  const user = await requireUser(req);
  const access = await loadCallerAccess(
    createServiceRoleClient() as unknown as AccessClient,
    user.id,
  );
  if (!can(access, 'section.documents')) {
    throw new ForbiddenError("Your role doesn't include Documents — ask the owner.");
  }
  const { id } = await params;

  const supabase = createUserClient(getBearerToken(req));
  const { data: row } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (!row) {
    throw new NotFoundError('Document not found.');
  }

  const model = buildDocument(documentInputFromRow(row, DOCUMENT_ISSUER));
  const pdf = await renderDocumentPdf(model);

  const filename = `${row.type}-${row.number ?? 'draft'}.pdf`;
  // Copy into a fresh ArrayBuffer-backed Uint8Array — the edge BodyInit rejects Uint8Array<ArrayBufferLike>.
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
