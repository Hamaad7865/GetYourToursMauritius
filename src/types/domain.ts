/**
 * Public domain types — the stable surface shared by web, the service layer and
 * (later) the mobile client. Inferred from the Zod schemas so the runtime
 * validation and the static types can never drift.
 */
export type {
  Category,
  TourType,
  TourStatus,
  Locale,
  BookingStatus,
  PaymentState,
  BookingSource,
  PaginationQuery,
  PaginationMeta,
  ErrorEnvelope,
} from '@/lib/validation/common';

export type {
  TourPrice,
  TourImage,
  TourSummary,
  TourOption,
  Review,
  TourDetail,
  AvailabilitySlot,
  SearchToursQuery,
  AvailabilityQuery,
} from '@/lib/validation/tours';

export type {
  CreateBookingInput,
  Booking,
  CreatePaymentInput,
  PaymentLink,
  CaptureLeadInput,
  Lead,
} from '@/lib/validation/booking';

export type { Paginated } from '@/lib/services/activities';
