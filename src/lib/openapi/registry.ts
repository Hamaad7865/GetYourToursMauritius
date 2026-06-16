import { z } from 'zod';
import type { ZodOpenApiPathsObject, ZodOpenApiResponseObject } from 'zod-openapi';
import { errorEnvelopeSchema, successEnvelopeSchema } from '@/lib/validation/common';
import {
  availabilityQuerySchema,
  availabilitySlotSchema,
  searchToursQuerySchema,
  tourDetailSchema,
  tourSummarySchema,
} from '@/lib/validation/tours';
import {
  bookingSchema,
  captureLeadInputSchema,
  createBookingInputSchema,
  createPaymentInputSchema,
  leadSchema,
  paymentLinkSchema,
} from '@/lib/validation/booking';

const errorResponse = (description: string): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema: errorEnvelopeSchema } },
});

const okJson = (schema: z.ZodTypeAny, description = 'OK'): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema: successEnvelopeSchema(schema) } },
});

const jsonBody = (schema: z.ZodTypeAny) => ({ content: { 'application/json': { schema } } });

const slugParam = z.object({ slug: z.string() });
const refParam = z.object({ ref: z.string() });

/**
 * Versioned /api/v1 paths. Each operation reuses the exact Zod schemas the route
 * handlers validate with, so the spec and runtime validation cannot drift.
 */
export const apiPaths: ZodOpenApiPathsObject = {
  '/activities': {
    get: {
      operationId: 'searchActivities',
      summary: 'Search the published tour & transport catalogue',
      tags: ['Catalogue'],
      requestParams: { query: searchToursQuerySchema },
      responses: {
        '200': okJson(z.array(tourSummarySchema), 'Paginated list of activities'),
        '400': errorResponse('Invalid query parameters'),
      },
    },
  },
  '/activities/{slug}': {
    get: {
      operationId: 'getActivity',
      summary: 'Get full activity detail by slug',
      tags: ['Catalogue'],
      requestParams: { path: slugParam },
      responses: { '200': okJson(tourDetailSchema), '404': errorResponse('Activity not found') },
    },
  },
  '/activities/{slug}/availability': {
    get: {
      operationId: 'listAvailability',
      summary: 'List bookable occurrences with live seats_left',
      tags: ['Catalogue'],
      requestParams: { path: slugParam, query: availabilityQuerySchema },
      responses: { '200': okJson(z.array(availabilitySlotSchema)) },
    },
  },
  '/bookings': {
    post: {
      operationId: 'createBooking',
      summary: 'Create a payment_pending booking (prices come from the DB)',
      tags: ['Bookings'],
      requestBody: jsonBody(createBookingInputSchema),
      responses: {
        '201': okJson(bookingSchema, 'Booking created'),
        '400': errorResponse('Invalid request'),
        '409': errorResponse('Not enough availability'),
      },
    },
  },
  '/bookings/{ref}': {
    get: {
      operationId: 'getBooking',
      summary: 'Get booking status by reference',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      responses: {
        '200': okJson(bookingSchema),
        '401': errorResponse('Authentication required'),
        '404': errorResponse('Booking not found'),
      },
    },
  },
  '/payments': {
    post: {
      operationId: 'createPayment',
      summary: 'Create a payment + hosted-checkout link for a booking',
      tags: ['Payments'],
      requestBody: jsonBody(createPaymentInputSchema),
      responses: {
        '201': okJson(paymentLinkSchema, 'Checkout link'),
        '404': errorResponse('Booking not found'),
      },
    },
  },
  '/leads': {
    post: {
      operationId: 'captureLead',
      summary: 'Capture a sales lead',
      tags: ['Leads'],
      requestBody: jsonBody(captureLeadInputSchema),
      responses: {
        '201': okJson(leadSchema, 'Lead captured'),
        '400': errorResponse('Invalid request'),
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
  '/health': {
    get: {
      operationId: 'health',
      summary: 'Liveness/readiness probe (add ?deep=true to also ping the database)',
      tags: ['Meta'],
      responses: {
        '200': okJson(
          z.object({
            status: z.string(),
            live: z.boolean(),
            checks: z.record(z.string(), z.boolean()),
            time: z.string(),
          }),
          'Healthy',
        ),
        '503': errorResponse('One or more health checks failed'),
      },
    },
  },
};
