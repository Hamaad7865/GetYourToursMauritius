import { z } from 'zod';
import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { errorEnvelopeSchema, successEnvelopeSchema } from '@/lib/validation/common';
import { searchToursQuerySchema, tourSummarySchema } from '@/lib/validation/tours';

const toursListEnvelope = successEnvelopeSchema(z.array(tourSummarySchema));

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: errorEnvelopeSchema } },
});

/**
 * Versioned /api/v1 paths. Each operation reuses the exact Zod schemas the route
 * handlers validate with, so the spec and runtime validation cannot drift.
 * Routes are added here as they are implemented (Phase 2+).
 */
export const apiPaths: ZodOpenApiPathsObject = {
  '/tours': {
    get: {
      operationId: 'searchTours',
      summary: 'Search the published tour & transport catalogue',
      tags: ['Tours'],
      requestParams: { query: searchToursQuerySchema },
      responses: {
        '200': {
          description: 'Paginated list of tours',
          content: { 'application/json': { schema: toursListEnvelope } },
        },
        '400': errorResponse('Invalid query parameters'),
        '401': errorResponse('Missing or invalid Bearer token'),
      },
    },
  },
  '/openapi': {
    get: {
      operationId: 'getOpenApiSpec',
      summary: 'The OpenAPI 3.1 specification for this API',
      tags: ['Meta'],
      responses: {
        '200': {
          description: 'OpenAPI document',
          content: { 'application/json': { schema: z.object({}).passthrough() } },
        },
      },
    },
  },
};
