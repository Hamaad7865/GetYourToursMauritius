import { apiHandler } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { buildOpenApiDocument } from '@/lib/openapi/document';

export const runtime = 'edge';

/** GET /api/v1/openapi — the raw OpenAPI 3.1 document (public, for tooling/clients). */
export const GET = apiHandler(async () => {
  const doc = buildOpenApiDocument();
  return new Response(JSON.stringify(doc), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
