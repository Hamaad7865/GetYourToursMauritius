import { createDocument } from 'zod-openapi';
import { getServerEnv } from '@/lib/config/env';
import { apiPaths } from './registry';

/** Builds the OpenAPI 3.1 document for /api/v1 from the shared Zod schemas. */
export function buildOpenApiDocument() {
  const env = getServerEnv();
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Belle Mare Tours API',
      version: '1.0.0',
      description:
        'API-first backend for Belle Mare Tours — catalogue, availability, bookings, payments and the AI assistant. The same token-authenticated API serves web and mobile clients.',
    },
    servers: [{ url: `${env.NEXT_PUBLIC_SITE_URL}/api/v1`, description: 'v1' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Supabase access token (JWT) from the Authorization header.',
        },
      },
    },
    tags: [
      { name: 'Catalogue', description: 'Activity search, detail and availability' },
      { name: 'Transfers', description: 'Airport & hotel transfer hotels, areas and fare quotes' },
      { name: 'Bookings', description: 'Create and track bookings' },
      { name: 'Payments', description: 'Hosted checkout links' },
      { name: 'Wishlist', description: 'Saved activities, synced across devices' },
      { name: 'Notifications', description: 'Per-user notification feed' },
      { name: 'Reviews', description: 'Activity reviews (booking-gated submission)' },
      { name: 'Account', description: 'Profile, privacy export and account deletion' },
      { name: 'Leads', description: 'Sales lead capture' },
      { name: 'Meta', description: 'Specification and service metadata' },
    ],
    paths: apiPaths,
  });
}

export type OpenApiDocument = ReturnType<typeof buildOpenApiDocument>;
