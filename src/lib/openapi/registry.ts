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
import {
  myReviewSchema,
  reviewInputSchema,
  submitGuestReviewInputSchema,
} from '@/lib/validation/reviews';
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
  rescheduleBookingInputSchema,
  quotePickupInputSchema,
  pickupQuoteSchema,
  requestPickupInputSchema,
  pickupRequestResultSchema,
  paymentLinkSchema as pickupPaymentLinkSchema,
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
const placeIdParam = z.object({ placeId: z.string().min(1) });

const searchConsoleQuery = z.object({
  days: z.coerce.number().int().min(1).max(180).default(28),
});
const searchConsoleMetrics = {
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
};
const searchConsoleRowSchema = z.object({ key: z.string(), ...searchConsoleMetrics });
const searchConsoleReportSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  totals: z.object(searchConsoleMetrics),
  topPages: z.array(searchConsoleRowSchema),
  topQueries: z.array(searchConsoleRowSchema),
});

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
  '/reviews/submit': {
    post: {
      operationId: 'submitGuestReview',
      summary: 'Submit a review via a one-time invite token (no login required)',
      tags: ['Reviews'],
      requestBody: jsonBody(submitGuestReviewInputSchema),
      responses: {
        '200': okJson(
          z.object({
            id: z.string(),
            status: z.enum(['pending', 'approved', 'rejected']),
            submittedAt: z.string(),
          }),
          'Review submitted',
        ),
        '400': errorResponse('Invalid request'),
        '409': errorResponse(
          'This review link is no longer valid — it may have already been used or expired',
        ),
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
  '/reviews/google-live': {
    get: {
      operationId: 'getGoogleLiveReviews',
      summary: "Live fetch of the business's own Google reviews (staff-only)",
      tags: ['Reviews'],
      security: [{ bearerAuth: [] }],
      requestParams: { query: placeIdParam },
      responses: {
        '200': okJson(
          z.object({
            rating: z.number().nullable(),
            userRatingCount: z.number().nullable(),
            reviews: z.array(
              z.object({
                authorName: z.string(),
                authorPhotoUrl: z.string().nullable(),
                rating: z.number(),
                text: z.string().nullable(),
                relativeTime: z.string().nullable(),
                googleMapsUri: z.string().nullable(),
              }),
            ),
          }),
          'Live Google reviews',
        ),
        '400': errorResponse('Invalid query parameters'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Staff only'),
        '503': errorResponse('Google Maps API key is not configured'),
      },
    },
  },
  '/seo/search-console': {
    get: {
      operationId: 'getSearchConsoleReport',
      summary: 'Google Search Console performance for the site (content editors only)',
      tags: ['SEO'],
      security: [{ bearerAuth: [] }],
      requestParams: { query: searchConsoleQuery },
      responses: {
        '200': okJson(searchConsoleReportSchema, 'Search performance for the window'),
        '400': errorResponse('Invalid query parameters'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Content editors only'),
        '503': errorResponse('Search Console is not connected'),
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
  '/bookings/{ref}/reschedule': {
    post: {
      operationId: 'rescheduleBooking',
      summary:
        'Customer moves their own confirmed + paid booking to another date on the same option',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      requestBody: jsonBody(rescheduleBookingInputSchema),
      responses: {
        '200': okJson(
          z.object({
            ref: z.string(),
            occurrenceId: z.string(),
            startsAt: z.string().nullish(),
            previousStartsAt: z.string().nullish(),
            alreadyOnDate: z.boolean().optional(),
          }),
          'Reschedule result',
        ),
        '400': errorResponse('Invalid request'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not your booking'),
        '404': errorResponse('Booking not found'),
        '409': errorResponse(
          'Outside the free-change window, a different option, sold out, or not reschedulable',
        ),
      },
    },
  },
  '/bookings/{ref}/pickup/quote': {
    post: {
      operationId: 'quotePickupAddon',
      summary: 'Quote the transport supplement for a pickup added after booking',
      description:
        'Read-only. The fee is derived server-side from the coordinates — the caller never sends a price, ' +
        'and dragging a map pin never mints a payment row.',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      requestBody: jsonBody(quotePickupInputSchema),
      responses: {
        '200': okJson(pickupQuoteSchema, 'Supplement quote'),
        '400': errorResponse('Invalid coordinates'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not your booking'),
        '404': errorResponse('Booking not found'),
        '429': errorResponse('Too many quotes — slow down'),
      },
    },
  },
  '/bookings/{ref}/pickup': {
    post: {
      operationId: 'requestPickup',
      summary: 'Commit to a pickup for a booking taken as "pickup to be arranged"',
      description:
        'Returns `applied: true` when nothing was owed and the pickup is already on the booking. ' +
        'Otherwise the address is held until the returned checkout is paid — it is deliberately NOT ' +
        'written to the booking before the transport supplement settles.',
      tags: ['Bookings'],
      security: [{ bearerAuth: [] }],
      requestParams: { path: refParam },
      requestBody: jsonBody(requestPickupInputSchema),
      responses: {
        '200': okJson(
          pickupRequestResultSchema.extend({ payment: z.null() }),
          'Applied — no supplement was due',
        ),
        '201': okJson(
          pickupRequestResultSchema.extend({ payment: pickupPaymentLinkSchema }),
          'Supplement due — checkout to pay it',
        ),
        '400': errorResponse('Invalid request'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Not your booking'),
        '404': errorResponse('Booking not found'),
        '409': errorResponse(
          'Not eligible for a late pickup, or a supplement payment is in flight',
        ),
        '429': errorResponse('Too many requests'),
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
  '/quotes/{ref}/open': {
    get: {
      operationId: 'openQuoteLink',
      summary: 'Open a quote link: move the link token into an httpOnly cookie and redirect',
      description:
        'The target of the link in a quote email. It authenticates nothing — it validates only the ' +
        'shape of the ref and token, sets an httpOnly, Secure, SameSite=Lax cookie scoped to this ' +
        'quote, and 302s to /quotes/{ref}. The token is deliberately kept out of any rendered page ' +
        'URL, where GTM (page_location) and the client-error reporter (window.location.href) would ' +
        'both export it. A request with no valid token still redirects, so nothing here reveals ' +
        'which quote refs exist.',
      tags: ['Quotes'],
      requestParams: {
        path: refParam,
        query: z.object({ t: z.string().describe('The raw link token from the quote email') }),
      },
      responses: {
        '302': {
          description: 'Redirect to the quote page (cookie set only for a well-formed token)',
        },
        '404': errorResponse('Malformed quote reference'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/quotes/{ref}/pay': {
    post: {
      operationId: 'payQuote',
      summary: 'Accept and pay a quote: convert it to a booking and mint a checkout',
      description:
        'Authenticated by the LINK TOKEN, in the httpOnly cookie /quotes/{ref}/open set — never by a ' +
        'bearer token, because the guest has no account. There is no request body: the cookie is the ' +
        'credential. The quote converts ONCE (api_convert_quote), and every later call reuses that ' +
        'booking and its live checkout, so one offer can never hold two payable sessions. Catalogue ' +
        'lines are re-priced first and the call is refused if the catalogue has moved, rather than ' +
        'charging a figure the guest never agreed to; each one then takes its capacity hold inside ' +
        'the conversion, so a departure that has sold out refuses the payment (409 sold_out) instead ' +
        'of charging for a seat nobody reserved. Every refusal to open the quote is the same 404, so ' +
        'nothing here reveals which quote refs exist.',
      tags: ['Quotes'],
      requestParams: { path: refParam },
      responses: {
        '201': okJson(
          paymentLinkSchema.extend({ bookingRef: z.string() }),
          'Checkout link for the converted booking',
        ),
        '404': errorResponse('No readable quote for this link'),
        '409': errorResponse(
          'Prices changed, the departure sold out, already paid, or the offer is not payable',
        ),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/quotes/{ref}/receipt': {
    get: {
      operationId: 'getQuoteReceipt',
      summary: 'Download the paid quote’s invoice & receipt PDF (link token, no account needed)',
      description:
        'The document route for the one customer who has no account by design. Every other ' +
        'customer-facing PDF route opens with a bearer token and an RLS read whose policy is ' +
        '`user_id = auth.uid() or is_staff()`, which an ownerless quote booking can never satisfy — ' +
        'so this one is authenticated by the LINK TOKEN instead, in the httpOnly cookie ' +
        '/quotes/{ref}/open set (scoped to this path, which is why the route lives here and not under ' +
        '/bookings). The same document the confirmation email attaches. Every refusal to open the ' +
        'quote is the same 404, so nothing here reveals which quote refs exist; the 409 is only ever ' +
        'shown to a caller who has already proved they hold the link.',
      tags: ['Quotes'],
      requestParams: { path: refParam },
      responses: {
        '200': {
          description: 'Invoice & receipt PDF',
          content: { 'application/pdf': { schema: z.string() } },
        },
        '404': errorResponse('No readable quote for this link'),
        '409': errorResponse('The payment has not been confirmed yet'),
        '429': errorResponse('Too many requests'),
      },
    },
  },
  '/admin/quotes/send': {
    post: {
      operationId: 'sendQuote',
      summary: 'Email a drafted quote to its guest and mint its public link (staff-only)',
      description:
        'The only writer of quotes.token_hash, so the only thing that can turn a draft into an ' +
        'offer a guest can open and pay. STAFF ONLY, and the check is profiles.role — the JWT role ' +
        'claim is the Postgres role selector, never the business role. It refuses to email an offer ' +
        'nobody could act on: one whose valid_until has passed, and one with no lines, a zero total ' +
        'or a negative one. A quote of scheduled activities sends normally and reserves nothing — ' +
        'the seats are held when the guest pays. A RE-SEND mints a fresh token and the previously ' +
        'emailed link stops working — ' +
        'quotes.token_hash holds exactly one hash — which is also why an already-accepted quote is ' +
        'refused rather than re-sent. The raw token is returned once, here, for the operator to ' +
        'copy; only its SHA-256 is stored.',
      tags: ['Quotes'],
      security: [{ bearerAuth: [] }],
      requestBody: jsonBody(z.object({ quoteId: z.string().uuid() })),
      responses: {
        '200': okJson(
          z.object({ url: z.string().describe('The tokenised link the guest was emailed') }),
          'The quote was emailed',
        ),
        '400': errorResponse('The quote cannot be emailed as it stands'),
        '401': errorResponse('Authentication required'),
        '403': errorResponse('Staff only'),
        '404': errorResponse('No such quote'),
        // The three ConflictErrors the handler actually raises, in its own order: a quote already
        // accepted (its converted_at is stamped, or its status says so), a status that is neither
        // draft nor sent — withdrawn or expired — and the guest accepting between the status check and
        // the guarded UPDATE, which comes back with no rows and no email sent. A catalogue line was a
        // fourth until the capacity-hold path made those quotes sendable; it is not a refusal any more.
        '409': errorResponse(
          'Withdrawn or expired, already accepted, or accepted while it was being sent',
        ),
        '429': errorResponse('Too many requests'),
        '500': errorResponse('The email could not be sent'),
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
