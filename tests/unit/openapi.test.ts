import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/lib/openapi/document';

describe('OpenAPI document', () => {
  it('builds a valid 3.1 document from the Zod schemas', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('GetYourToursMauritius API');
  });

  it('registers the /tours operation with bearer security', () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/tours']?.get?.operationId).toBe('searchTours');
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
