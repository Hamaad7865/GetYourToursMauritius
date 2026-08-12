import { apiHandler } from '@/lib/http/handler';
import { jsonOk } from '@/lib/http/envelope';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser, getBearerToken } from '@/lib/http/auth';
import { createUserClient } from '@/lib/supabase/client';
import { NotFoundError, ValidationError, ProviderError } from '@/lib/services/errors';
import { DOCUMENT_ISSUER } from '@/lib/documents/issuer';
import { buildDocument } from '@/lib/documents/model';
import { renderDocumentPdf } from '@/lib/documents/pdf';
import { documentInputFromRow } from '@/lib/documents/row';
import { renderDocumentEmail } from '@/lib/email/document';
import { getNotificationProvider } from '@/lib/notifications';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ id: string }> };

/**
 * Base64-encode bytes on the edge runtime, in fixed chunks so a multi-KB PDF cannot overflow the
 * argument stack of `String.fromCharCode(...)`. Mirrors the helper the booking-confirmation drain uses;
 * kept local so this route does not reach into `src/lib/services/notifications.ts`.
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * POST /api/v1/admin/documents/:id/email — email the document to its client, with the PDF attached.
 *
 * Staff-only via RLS (the read runs as the caller; the documents table is is_staff()-only, so a
 * non-staff caller 404s). Operator-initiated: the button in the editor is the only caller. The mail
 * goes out FROM the monitored info@ inbox so the client can just hit Reply.
 */
export const POST = apiHandler<RouteCtx>(async (req, { params }) => {
  await requireUser(req);
  const { id } = await params;

  const supabase = createUserClient(getBearerToken(req));
  const { data: row } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (!row) throw new NotFoundError('Document not found.');

  const model = buildDocument(documentInputFromRow(row, DOCUMENT_ISSUER));
  const recipient = model.client.email?.trim();
  if (!recipient) {
    throw new ValidationError('This document has no client email — add one before sending.');
  }

  const email = renderDocumentEmail(model);
  const pdf = await renderDocumentPdf(model);
  const filename = `${row.type}-${row.number ?? 'draft'}.pdf`;

  try {
    await getNotificationProvider().send({
      // A fresh id per send — the Resend provider keys its Idempotency-Key on it, and a re-send is a
      // deliberately different email that must actually go out.
      id: crypto.randomUUID(),
      channel: 'email',
      recipient,
      template: 'document_sent',
      // FROM the monitored info@ inbox (like the quote email), so a client reply reaches a human.
      from: SITE.email,
      payload: {},
      subject: email.subject,
      html: email.html,
      text: email.text,
      attachments: [{ filename, content: bytesToBase64(pdf), contentType: 'application/pdf' }],
    });
  } catch (cause) {
    throw new ProviderError(
      `Could not email the document: ${cause instanceof Error ? cause.message : 'send failed'}.`,
    );
  }

  return jsonOk({ emailed: true, recipient });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
