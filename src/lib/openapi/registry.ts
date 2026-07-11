import { z } from 'zod';
import type { ZodOpenApiPathsObject, ZodOpenApiResponseObject } from 'zod-openapi';
import {
  errorEnvelopeSchema,
  paginationQuerySchema,
  successEnvelopeSchema,
} from '@/lib/validation/common';
import {
  availabilityQuerySchema,
  availabilitySlotSchema,
  categorySummarySchema,
  facetsQuerySchema,
  facetsSchema,
  reviewSchema,
  searchToursQuerySchema,
  tourDetailSchema,
  tourSummarySchema,
} from '@/lib/validation/tours';
import { myReviewSchema, reviewInputSchema } from '@/lib/validation/reviews';
import {
  accountExportSchema,
  deleteAccountResultSchema,
  profileSchema,
  profileUpdateSchema,
} from '@/lib/validation/account';
import {
  bookingHistoryQuerySchema,
  bookingSchema,
  bookingSummarySchema,
  captureLeadInputSchema,
  createBookingInputSchema,
  createHoldInputSchema,
  createPaymentInputSchema,
  holdResultSchema,
  holdStatusSchema,
  leadSchema,
  paymentLinkSchema,
  syncPaymentInputSchema,
} from '@/lib/validation/booking';
import { clientErrorReportSchema } from '@/lib/validation/telemetry';
import {
  wishlistAddResultSchema,
  wishlistInputSchema,
  wishlistRemoveResultSchema,
} from '@/lib/validation/wishlist';
import {
  markAllReadResultSchema,
  markReadResultSchema,
  notificationSchema,
  notificationsQuerySchema,
  unreadCountResultSchema,
} from '@/lib/validation/notifications';
import {
  transferAreaSchema,
  transferHotelSchema,
  transferHotelsQuerySchema,
  transferQuoteQuerySchema,
  transferQuoteSchema,
} from '@/lib/validation/transfers';
import { pendingBookingSchema } from '@/lib/services/bookings';

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
const idParam = z.object({ id: z.string() });

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
  '/activities/facets': {
    get: {
      operationId: 'getActivityFacets',
      summary: 'Price/duration slider bounds for the current catalogue scope',
      tags: ['Catalogue'],
      requestParams: { query: facetsQuerySchema },
      responses: { '200': okJson(facetsSchema, 'Filter bounds') },
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
  '/activities/{slug}/reviews': {
    post: {
      operationId: 'submitReview',
      summary: 'Submit/update the caller’s review for an activity (booking-gated)',
      tags: ['Reviews'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: slugParam },
      requestBody: jsonBody(reviewInputSchema),
      responses: {
        '201': okJson(reviewSchema, 'Review saved'),
        '400': errorResponse('Invalid request'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('No confirmed booking for this activity'),
        '404': errorResponse('Activity not found'),
      },
    },
  },
  '/categories': {
    get: {
      operationId: 'listCategories',
      summary: 'The active browse categories',
      tags: ['Catalogue'],
      responses: { '200': okJson(z.array(categorySummarySchema), 'Categories') },
    },
  },
  '/account/reviews': {
    get: {
      operationId: 'listMyReviews',
      summary: 'The caller’s own reviews ("My reviews"), newest first',
      tags: ['Account'],
      security: [{ bearerAuth: [] }],
      requestParams: { query: paginationQuerySchema },
      responses: {
        '200': okJson(z.array(myReviewSchema), 'Paginated reviews'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/account/profile': {
    get: {
      operationId: 'getProfile',
      summary: 'The caller’s profile (created if missing)',
      tags: ['Account'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(profileSchema, 'Profile'),
        '401': errorResponse('Authentication required'),
      },
    },
    patch: {
      operationId: 'updateProfile',
      summary: 'Update the caller’s profile (fullName/phone/dateOfBirth)',
      tags: ['Account'],
      security: [{ bearerAuth: [] }],
      requestBody: jsonBody(profileUpdateSchema),
      responses: {
        '200': okJson(profileSchema, 'Updated profile'),
        '400': errorResponse('Invalid request'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/account/export': {
    get: {
      operationId: 'exportAccount',
      summary: 'The caller’s GDPR data export (profile + bookings)',
      tags: ['Account'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(accountExportSchema, 'Data export'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/account/delete': {
    post: {
      operationId: 'deleteAccount',
      summary: 'Permanently delete the caller’s account (data + auth user)',
      tags: ['Account'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(deleteAccountResultSchema, 'Deleted'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/transfers/hotels': {
    get: {
      operationId: 'searchTransferHotels',
      summary: 'Typeahead over the bookable airport-transfer hotels',
      tags: ['Transfers'],
      requestParams: { query: transferHotelsQuerySchema },
      responses: {
        '200': okJson(z.array(transferHotelSchema), 'Paginated hotels'),
        '400': errorResponse('Invalid query parameters'),
      },
    },
  },
  '/transfers/areas': {
    get: {
      operationId: 'listTransferAreas',
      summary: 'Curated point-to-point areas with region + airport zone',
      tags: ['Transfers'],
      responses: { '200': okJson(z.array(transferAreaSchema), 'Areas') },
    },
  },
  '/transfers/quote': {
    get: {
      operationId: 'quoteTransfer',
      summary: 'Read-only fare estimate (equals the booked charge for the same inputs)',
      tags: ['Transfers'],
      requestParams: { query: transferQuoteQuerySchema },
      responses: {
        '200': okJson(transferQuoteSchema, 'Fare estimate'),
        '400': errorResponse('Invalid query parameters'),
      },
    },
  },
  '/holds': {
    post: {
      operationId: 'createHold',
      summary: 'Reserve the spot for a date (anonymous-friendly); reused at pay so no double-hold',
      tags: ['Bookings'],
      requestBody: jsonBody(createHoldInputSchema),
      responses: {
        '201': okJson(holdResultSchema, 'Hold created'),
        '400': errorResponse('Invalid request'),
        '409': errorResponse('Insufficient capacity'),
      },
    },
  },
  '/holds/{id}': {
    get: {
      operationId: 'getHold',
      summary: "Get a hold's current lifecycle status (owner-scoped, for cart reconciliation)",
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: idParam },
      responses: {
        '200': okJson(holdStatusSchema, 'Hold status'),
        '401': errorResponse('Authentication required'),
        '404': errorResponse('Hold not found'),
      },
    },
  },
  '/holds/{id}/release': {
    post: {
      operationId: 'releaseHold',
      summary: 'Release a hold the caller owns (the cart calls this when a held line is removed)',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: idParam },
      responses: {
        '200': okJson(z.object({ released: z.boolean() }), 'Released'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not the hold owner'),
        '404': errorResponse('Hold not found'),
      },
    },
  },
  '/bookings': {
    get: {
      operationId: 'listMyBookings',
      summary: 'List the signed-in user’s booking history ("My Trips"), newest first',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { query: bookingHistoryQuerySchema },
      responses: {
        '200': okJson(z.array(bookingSummarySchema), 'Paginated booking history'),
        '400': errorResponse('Invalid query parameters'),
        '401': errorResponse('Authentication required'),
      },
    },
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
  '/bookings/pending': {
    get: {
      operationId: 'listMyPendingBookings',
      summary: 'List the signed-in user’s payment_pending bookings (for the cart)',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(z.array(pendingBookingSchema)),
        '401': errorResponse('Authentication required'),
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
  '/bookings/{ref}/invoice': {
    get: {
      operationId: 'getBookingInvoice',
      summary: 'Download the booking’s invoice/receipt PDF (owner-or-staff, once paid)',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      responses: {
        '200': {
          description: 'Invoice PDF',
          content: { 'application/pdf': { schema: z.string() } },
        },
        '401': errorResponse('Authentication required'),
        '404': errorResponse('Booking not found'),
        '409': errorResponse('Invoice not available until the booking is paid'),
      },
    },
  },
  '/bookings/{ref}/voucher': {
    get: {
      operationId: 'getBookingVoucher',
      summary:
        'Download the airport-transfer e-voucher PDF (owner-or-staff, transfers only, once confirmed)',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      responses: {
        '200': {
          description: 'E-voucher PDF',
          content: { 'application/pdf': { schema: z.string() } },
        },
        '401': errorResponse('Authentication required'),
        '404': errorResponse('Booking not found'),
        '409': errorResponse('Not a transfer, or not available until the booking is confirmed'),
      },
    },
  },
  '/bookings/{ref}/cancel': {
    post: {
      operationId: 'cancelBooking',
      summary:
        'Customer cancels their own confirmed + paid booking (>24h before the trip) and starts a refund',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      responses: {
        '200': okJson(
          z.object({
            ref: z.string(),
            status: z.string(),
            alreadyCancelled: z.boolean().optional(),
          }),
          'Cancellation result',
        ),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not your booking'),
        '404': errorResponse('Booking not found'),
        '409': errorResponse('Outside the free-cancellation window, or not cancellable'),
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
  '/payments/sync': {
    post: {
      operationId: 'syncPayment',
      summary: "Confirm a booking from the provider's authoritative checkout status",
      tags: ['Payments'],
      requestBody: jsonBody(syncPaymentInputSchema),
      responses: {
        '200': okJson(z.object({ outcome: z.string(), confirmed: z.boolean() }), 'Sync result'),
        '403': errorResponse('Not the booking owner'),
        '404': errorResponse('Booking not found'),
      },
    },
  },
  '/wishlist': {
    get: {
      operationId: 'listWishlist',
      summary: 'List the signed-in user’s saved activities (full TourSummary cards), newest first',
      tags: ['Wishlist'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(z.array(tourSummarySchema), 'Saved activities'),
        '401': errorResponse('Authentication required'),
      },
    },
    post: {
      operationId: 'addToWishlist',
      summary: 'Save an activity to the wishlist by slug (idempotent)',
      tags: ['Wishlist'],
      security: [{ bearerAuth: [] }],
      requestBody: jsonBody(wishlistInputSchema),
      responses: {
        '200': okJson(wishlistAddResultSchema, 'Already saved'),
        '201': okJson(wishlistAddResultSchema, 'Saved'),
        '400': errorResponse('Invalid request'),
        '401': errorResponse('Authentication required'),
        '404': errorResponse('Activity not found'),
      },
    },
  },
  '/wishlist/{slug}': {
    delete: {
      operationId: 'removeFromWishlist',
      summary: 'Remove a saved activity by slug (idempotent)',
      tags: ['Wishlist'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: slugParam },
      responses: {
        '200': okJson(wishlistRemoveResultSchema, 'Removed (or was not saved)'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/notifications': {
    get: {
      operationId: 'listNotifications',
      summary: 'List the signed-in user’s notifications, newest first',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      requestParams: { query: notificationsQuerySchema },
      responses: {
        '200': okJson(z.array(notificationSchema), 'Paginated notifications'),
        '400': errorResponse('Invalid query parameters'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/notifications/{id}/read': {
    post: {
      operationId: 'markNotificationRead',
      summary: 'Mark a notification as read (owner-scoped)',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: idParam },
      responses: {
        '200': okJson(markReadResultSchema, 'Marked read'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not your notification'),
        '404': errorResponse('Notification not found'),
      },
    },
  },
  '/notifications/read-all': {
    post: {
      operationId: 'markAllNotificationsRead',
      summary: 'Mark all of the caller’s notifications as read',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(markAllReadResultSchema, 'Marked all read'),
        '401': errorResponse('Authentication required'),
      },
    },
  },
  '/notifications/unread-count': {
    get: {
      operationId: 'getUnreadNotificationCount',
      summary: 'The caller’s unread-notification count (bell badge)',
      tags: ['Notifications'],
      security: [{ bearerAuth: [] }],
      responses: {
        '200': okJson(unreadCountResultSchema, 'Unread count'),
        '401': errorResponse('Authentication required'),
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
  '/client-errors': {
    post: {
      operationId: 'reportClientError',
      summary: 'Receive a browser-side error report (telemetry; per-IP rate limited)',
      tags: ['Meta'],
      requestBody: jsonBody(clientErrorReportSchema),
      responses: {
        '202': okJson(z.object({ received: z.boolean() }), 'Report accepted'),
        '400': errorResponse('Invalid request'),
        '429': errorResponse('Too many reports'),
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
