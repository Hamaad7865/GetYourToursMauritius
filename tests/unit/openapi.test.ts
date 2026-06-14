import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '@/lib/openapi/document';

describe('OpenAPI document', () => {
  it('builds a valid 3.1 document from the Zod schemas', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('GetYourToursMauritius API');
  });

  it('registers the catalogue + booking operations with a bearer scheme', () => {
    const doc = buildOpenApiDocument();
    expect(doc.paths?.['/activities']?.get?.operationId).toBe('searchActivities');
    expect(doc.paths?.['/bookings']?.post?.operationId).toBe('createBooking');
    expect(doc.paths?.['/bookings/{ref}']?.get?.operationId).toBe('getBooking');
    expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
  });
});
