/**
 * Public domain types — the stable surface shared by web, the service layer and
 * (later) the mobile client. These are inferred from the Zod schemas so the
 * runtime validation and the static types can never drift.
 */
export type {
  Category,
  TourType,
  TourStatus,
  Locale,
  PaginationQuery,
  PaginationMeta,
  ErrorEnvelope,
} from '@/lib/validation/common';

export type {
  TourPrice,
  TourImage,
  TourSummary,
  TourDetail,
  SearchToursQuery,
} from '@/lib/validation/tours';

export type { Paginated } from '@/lib/services/tours';
