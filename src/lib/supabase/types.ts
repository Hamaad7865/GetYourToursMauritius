/**
 * Supabase database types.
 *
 * Hand-authored in Phase 1 to match supabase/migrations (no Docker/Supabase CLI in
 * this environment). REGENERATE from the live schema once a project is wired:
 *   npm run gen:types   # supabase gen types typescript --local > this file
 * Keep in sync with the migrations until then.
 */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type OperatorsRow = {
  id: string;
  name: string;
  slug: string;
  contact_email: string | null;
  phone: string | null;
  payout_details: Json;
  status: string;
  created_at: string;
};
type OperatorsInsert = {
  id?: string;
  name: string;
  slug: string;
  contact_email?: string | null;
  phone?: string | null;
  payout_details?: Json;
  status?: string;
  created_at?: string;
};

type ProfilesRow = {
  id: string;
  full_name: string | null;
  role: Database['public']['Enums']['user_role'];
  phone: string | null;
  date_of_birth: string | null;
  created_at: string;
};
type ProfilesInsert = {
  id: string;
  full_name?: string | null;
  role?: Database['public']['Enums']['user_role'];
  phone?: string | null;
  date_of_birth?: string | null;
  created_at?: string;
};

type ActivitiesRow = {
  id: string;
  operator_id: string;
  slug: string;
  type: Database['public']['Enums']['activity_type'];
  title: string;
  summary: string | null;
  description: string | null;
  category: string;
  location: string | null;
  duration_minutes: number | null;
  meeting_point: string | null;
  pickup_available: boolean;
  pricing_mode: 'per_person' | 'per_group' | 'vehicle';
  daily_capacity: number | null;
  min_advance_days: number;
  languages: string[];
  inclusions: string[];
  exclusions: string[];
  highlights: string[];
  cancellation_policy: string | null;
  status: Database['public']['Enums']['activity_status'];
  seo_title: string | null;
  seo_description: string | null;
  rating_avg: number | null;
  rating_count: number;
  extra: Json;
  /** FROZEN legacy (20260908000000): the single supplement moved to activity_supplements. Kept only
   *  because the live catalogue dump/seed reference the columns; nothing writes or reads them. */
  supplement_name: string | null;
  supplement_minor: number | null;
  /** 20260908000000 — max guests ONE booking may hold on a shared option ("guests per trip");
   *  daily_capacity stays the whole day's pool (= trips × this). Null = no per-booking cap.
   *  Options may override via activity_options.guests_per_trip. */
  guests_per_trip: number | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  sort: number;
  created_at: string;
};
type ActivitiesInsert = {
  id?: string;
  operator_id: string;
  slug: string;
  type?: Database['public']['Enums']['activity_type'];
  title: string;
  summary?: string | null;
  description?: string | null;
  category: string;
  location?: string | null;
  duration_minutes?: number | null;
  meeting_point?: string | null;
  pickup_available?: boolean;
  pricing_mode?: 'per_person' | 'per_group' | 'vehicle';
  daily_capacity?: number | null;
  min_advance_days?: number;
  languages?: string[];
  inclusions?: string[];
  exclusions?: string[];
  highlights?: string[];
  cancellation_policy?: string | null;
  status?: Database['public']['Enums']['activity_status'];
  seo_title?: string | null;
  seo_description?: string | null;
  rating_avg?: number | null;
  rating_count?: number;
  extra?: Json;
  supplement_name?: string | null;
  supplement_minor?: number | null;
  guests_per_trip?: number | null;
  region?: string | null;
  lat?: number | null;
  lng?: number | null;
  sort?: number;
  created_at?: string;
};

type ActivityTranslationsRow = {
  id: string;
  activity_id: string;
  locale: Database['public']['Enums']['content_locale'];
  title: string | null;
  summary: string | null;
  description: string | null;
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  meeting_point: string | null;
  seo_title: string | null;
  seo_description: string | null;
  /** 'human' = written or approved by staff; 'machine' = auto-drafted, awaiting review in /admin. */
  source: string;
  /** 20260901000700 — ONLY the FR-translatable subset of activities.extra (itinerary / whatToBring /
   *  importantInfo). Never operational flags (availability, badges, priceList, adultsOnly, ...) —
   *  those always come from the English activities.extra column. */
  extra: Json | null;
  /** FROZEN legacy (20260908000000): the FR label moved to activity_supplements.name_fr. */
  supplement_name: string | null;
};
type ActivityTranslationsInsert = {
  id?: string;
  activity_id: string;
  locale: Database['public']['Enums']['content_locale'];
  title?: string | null;
  summary?: string | null;
  description?: string | null;
  highlights?: string[];
  inclusions?: string[];
  exclusions?: string[];
  meeting_point?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  source?: string;
  extra?: Json | null;
  supplement_name?: string | null;
};

type ActivityImagesRow = {
  id: string;
  activity_id: string;
  url: string;
  alt: string | null;
  position: number;
};
type ActivityImagesInsert = {
  id?: string;
  activity_id: string;
  url: string;
  alt?: string | null;
  position?: number;
};

type ActivityOptionsRow = {
  id: string;
  activity_id: string;
  name: string;
  description: string | null;
  status: string;
  duration_minutes: number | null;
  start_window: string | null;
  // Private option (own trips-per-day pool): non-null base ⇒ private; base covers `private_included`
  // guests, `private_extra_minor` per additional head, `private_max_guests` cap.
  private_base_minor: number | null;
  private_included: number | null;
  private_extra_minor: number | null;
  private_max_guests: number | null;
  /** Per-option daily capacity (null = inherit the activity's). Trips/day for a private option. */
  daily_capacity: number | null;
  /** 20260908000000 — per-option "guests per trip" override for SHARED options (null = inherit
   *  activities.guests_per_trip). A private option's cap is private_max_guests instead. */
  guests_per_trip: number | null;
  position: number;
  created_at: string;
};
type ActivityOptionsInsert = {
  id?: string;
  activity_id: string;
  name: string;
  description?: string | null;
  status?: string;
  duration_minutes?: number | null;
  start_window?: string | null;
  private_base_minor?: number | null;
  private_included?: number | null;
  private_extra_minor?: number | null;
  private_max_guests?: number | null;
  daily_capacity?: number | null;
  guests_per_trip?: number | null;
  position?: number;
  created_at?: string;
};

type ActivityOptionPricesRow = {
  id: string;
  activity_option_id: string;
  label: string;
  amount_minor: number;
  currency: string;
  max_guests: number | null;
  min_age: number | null;
  max_age: number | null;
  position: number;
};
type ActivityOptionPricesInsert = {
  id?: string;
  activity_option_id: string;
  label: string;
  amount_minor: number;
  currency?: string;
  max_guests?: number | null;
  min_age?: number | null;
  max_age?: number | null;
  position?: number;
};

type SessionOccurrencesRow = {
  id: string;
  activity_option_id: string;
  operator_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: Database['public']['Enums']['occurrence_status'];
  created_at: string;
};
type SessionOccurrencesInsert = {
  id?: string;
  activity_option_id: string;
  operator_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status?: Database['public']['Enums']['occurrence_status'];
  created_at?: string;
};

type BookingHoldsRow = {
  id: string;
  session_occurrence_id: string;
  booking_id: string | null;
  quantity: number;
  status: Database['public']['Enums']['hold_status'];
  idempotency_key: string;
  expires_at: string;
  created_at: string;
  created_by: string | null;
};
type BookingHoldsInsert = {
  id?: string;
  session_occurrence_id: string;
  booking_id?: string | null;
  quantity: number;
  status?: Database['public']['Enums']['hold_status'];
  idempotency_key: string;
  expires_at?: string;
  created_at?: string;
  created_by?: string | null;
};

type BookingsRow = {
  id: string;
  ref: string;
  idempotency_key: string | null;
  user_id: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  status: Database['public']['Enums']['booking_status'];
  source: Database['public']['Enums']['booking_source'];
  currency: string;
  total_minor: number;
  agency_commission_minor: number;
  operator_payout_minor: number;
  payment_state: Database['public']['Enums']['payment_state'];
  notes: string | null;
  dropoff_location: string | null;
  pickup_pending: boolean;
  trip_type: string | null;
  trip_direction: string | null;
  flight_number: string | null;
  arrival_time: string | null;
  return_date: string | null;
  return_time: string | null;
  departure_flight_number: string | null;
  room_or_cabin: string | null;
  luggage_details: string | null;
  child_seat_age: number | null;
  traveller_gender: string | null;
  traveller_company: string | null;
  traveller_country: string | null;
  special_notes: string | null;
  /** The language the guest booked in (20260901000300) — the confirmation email + PDFs render later,
   *  off-request, so this is the only source they can trust for which language to use. */
  locale: Database['public']['Enums']['content_locale'];
  created_at: string;
  updated_at: string;
};
type BookingsInsert = {
  id?: string;
  ref?: string;
  idempotency_key?: string | null;
  user_id?: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone?: string | null;
  status?: Database['public']['Enums']['booking_status'];
  source?: Database['public']['Enums']['booking_source'];
  currency?: string;
  total_minor?: number;
  agency_commission_minor?: number;
  operator_payout_minor?: number;
  payment_state?: Database['public']['Enums']['payment_state'];
  notes?: string | null;
  dropoff_location?: string | null;
  pickup_pending?: boolean;
  trip_type?: string | null;
  trip_direction?: string | null;
  flight_number?: string | null;
  arrival_time?: string | null;
  return_date?: string | null;
  return_time?: string | null;
  departure_flight_number?: string | null;
  room_or_cabin?: string | null;
  luggage_details?: string | null;
  child_seat_age?: number | null;
  traveller_gender?: string | null;
  traveller_company?: string | null;
  traveller_country?: string | null;
  special_notes?: string | null;
  locale?: Database['public']['Enums']['content_locale'];
  created_at?: string;
  updated_at?: string;
};

type BookingItemsRow = {
  id: string;
  booking_id: string;
  session_occurrence_id: string;
  activity_option_id: string;
  price_label: string;
  quantity: number;
  unit_amount_minor: number;
  subtotal_minor: number;
  pax: number | null;
  created_at: string;
};
type BookingItemsInsert = {
  id?: string;
  booking_id: string;
  session_occurrence_id: string;
  activity_option_id: string;
  price_label: string;
  quantity: number;
  unit_amount_minor: number;
  subtotal_minor: number;
  pax?: number | null;
  created_at?: string;
};

/** 20260908000000 — the owner's per-activity upgrade menu (e.g. "Lobster lunch"), MANY per
 *  activity. price_minor is the PER-PERSON price api_book charges from; name_fr is the FR label
 *  (per-field coalesce in api_get_activity — the English name alone decides the row exists). */
type ActivitySupplementsRow = {
  id: string;
  activity_id: string;
  name: string;
  name_fr: string | null;
  price_minor: number;
  position: number;
  created_at: string;
};
type ActivitySupplementsInsert = {
  id?: string;
  activity_id: string;
  name: string;
  name_fr?: string | null;
  price_minor?: number;
  position?: number;
  created_at?: string;
};

/** 20260908000000 — what a booking actually bought, snapshot per supplement (name + unit + qty +
 *  total at booking time, so a reprinted invoice survives renames/re-pricing). Written only by
 *  api_book; supplement_id goes NULL if the owner later deletes the menu row. */
type BookingSupplementsRow = {
  id: string;
  booking_id: string;
  supplement_id: string | null;
  name: string;
  qty: number;
  unit_minor: number;
  total_minor: number;
  /** The MENU position at booking time — the stable order every reader lists supplements in. */
  position: number;
};
type BookingSupplementsInsert = {
  id?: string;
  booking_id: string;
  supplement_id?: string | null;
  name: string;
  qty: number;
  unit_minor: number;
  total_minor: number;
  position?: number;
};

type PaymentsRow = {
  id: string;
  booking_id: string;
  idempotency_key: string;
  provider: string;
  amount_minor: number;
  currency: string;
  status: Database['public']['Enums']['payment_state'];
  paid_minor: number;
  refunded_minor: number;
  charged_amount_minor: number | null;
  charged_currency: string | null;
  /** EUR→charged-currency rate pinned with the charge (20260830000000), for refund/VAT evidence. */
  charged_fx_rate: number | null;
  charged_fx_source: string | null;
  charged_fx_at: string | null;
  /** Set when a settled provider event was quarantined — blocks the auto-expiry sweep. */
  settlement_review_at: string | null;
  settlement_review_reason: string | null;
  provider_checkout_id: string | null;
  prev_provider_checkout_id: string | null;
  checkout_claimed_until: string | null;
  /** Which money this row is for (20260910000000). 'booking' is the booking total; 'pickup_addon' is
   *  the transport supplement for a pickup added after the booking was paid. api_create_payment scopes
   *  every lookup by this — a booking re-pay must never pick up the add-on row. */
  purpose: 'booking' | 'pickup_addon';
  created_at: string;
  updated_at: string;
};
type PaymentsInsert = {
  id?: string;
  booking_id: string;
  idempotency_key: string;
  provider?: string;
  amount_minor: number;
  currency?: string;
  status?: Database['public']['Enums']['payment_state'];
  paid_minor?: number;
  refunded_minor?: number;
  charged_amount_minor?: number | null;
  charged_currency?: string | null;
  provider_checkout_id?: string | null;
  purpose?: 'booking' | 'pickup_addon';
  created_at?: string;
  updated_at?: string;
};

/** A pickup the guest committed to after booking, held until its supplement settles (20260910000000).
 *  Written only by api_request_pickup / apply_pickup_request; read by booking_json + admin. */
type BookingPickupRequestsRow = {
  id: string;
  booking_id: string;
  /** Null only for a zero-fee request, which is applied on the spot with no payment. */
  payment_id: string | null;
  pickup_location: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_region: string;
  dropoff_location: string | null;
  fee_minor: number;
  /** Set the moment the supplement settles and the address reaches the booking. The `applied_at is
   *  null` guard is what makes a replayed webhook a no-op. */
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};
type BookingPickupRequestsInsert = {
  id?: string;
  booking_id: string;
  payment_id?: string | null;
  pickup_location: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_region: string;
  dropoff_location?: string | null;
  fee_minor?: number;
  applied_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type PaymentEventsRow = {
  id: string;
  payment_id: string;
  type: string;
  provider_event_id: string | null;
  amount_minor: number;
  occurred_at: string;
  payload: Json;
  created_at: string;
};
type PaymentEventsInsert = {
  id?: string;
  payment_id: string;
  type: string;
  provider_event_id?: string | null;
  amount_minor?: number;
  occurred_at?: string;
  payload?: Json;
  created_at?: string;
};

type NotificationOutboxRow = {
  id: string;
  channel: Database['public']['Enums']['notification_channel'];
  recipient: string;
  template: string;
  payload: Json;
  status: Database['public']['Enums']['notification_status'];
  idempotency_key: string | null;
  booking_id: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
};
type NotificationOutboxInsert = {
  id?: string;
  channel: Database['public']['Enums']['notification_channel'];
  recipient: string;
  template: string;
  payload?: Json;
  status?: Database['public']['Enums']['notification_status'];
  idempotency_key?: string | null;
  booking_id?: string | null;
  attempts?: number;
  last_error?: string | null;
  created_at?: string;
  sent_at?: string | null;
};

type AuditLogsRow = {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string | null;
  diff: Json | null;
  created_at: string;
};
type AuditLogsInsert = {
  id?: string;
  actor_id?: string | null;
  actor_role?: string | null;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary?: string | null;
  diff?: Json | null;
  created_at?: string;
};

type LeadsRow = {
  id: string;
  name: string;
  contact: string;
  interest_activity_id: string | null;
  status: Database['public']['Enums']['lead_status'];
  source: string;
  created_at: string;
};
type LeadsInsert = {
  id?: string;
  name: string;
  contact: string;
  interest_activity_id?: string | null;
  status?: Database['public']['Enums']['lead_status'];
  source?: string;
  created_at?: string;
};

type ReviewsRow = {
  id: string;
  activity_id: string;
  author: string;
  rating: number;
  text: string | null;
  created_at: string;
};
type ReviewsInsert = {
  id?: string;
  activity_id: string;
  author: string;
  rating: number;
  text?: string | null;
  created_at?: string;
};

type ChatSessionsRow = {
  id: string;
  user_id: string | null;
  booking_id: string | null;
  lead_id: string | null;
  created_at: string;
};
type ChatSessionsInsert = {
  id?: string;
  user_id?: string | null;
  booking_id?: string | null;
  lead_id?: string | null;
  created_at?: string;
};

type ChatMessagesRow = {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
};
type ChatMessagesInsert = {
  id?: string;
  session_id: string;
  role: string;
  content: string;
  created_at?: string;
};

type CategoriesRow = {
  id: string;
  name: string;
  slug: string;
  position: number;
  image_url: string | null;
  status: string;
  created_at: string;
};
type CategoriesInsert = {
  id?: string;
  name: string;
  slug: string;
  position?: number;
  image_url?: string | null;
  status?: string;
  created_at?: string;
};

type SightseeingPricingRow = {
  id: boolean;
  per_block_minor: number;
  suv_flat_minor: number;
  sedan_minor: number;
  suv_minor: number;
  family_minor: number;
  van_minor: number;
  coaster_minor: number;
  updated_at: string;
};
type SightseeingPricingInsert = Partial<SightseeingPricingRow>;

type PlannerPricingRow = {
  id: boolean;
  standard_minor: number;
  suv_minor: number;
  six_minor: number;
  van_minor: number;
  coach_minor: number;
  max_party: number;
  updated_at: string;
};
type PlannerPricingInsert = Partial<PlannerPricingRow>;

type TransportBandPricingRow = {
  band: 'same' | 'near' | 'far';
  sedan_minor: number;
  suv_minor: number;
  family_minor: number;
  van_minor: number;
  coaster_minor: number;
  updated_at: string;
};
type TransportBandPricingInsert = Partial<TransportBandPricingRow> & { band: 'same' | 'near' | 'far' };

type RegionZoneDistanceRow = {
  region_a: string;
  region_b: string;
  band: 'near' | 'far';
};
type RegionZoneDistanceInsert = RegionZoneDistanceRow;

type AirportTransferFareRow = {
  zone: 'zone1' | 'zone2';
  sedan_minor: number;
  suv_minor: number;
  family_minor: number;
  van_minor: number;
  coaster_minor: number;
  updated_at: string;
};
type AirportTransferFareInsert = Partial<AirportTransferFareRow> & {
  zone: 'zone1' | 'zone2';
};

type AirportTransferConfigRow = { id: boolean; return_discount_pct: number; updated_at: string };
type AirportTransferConfigInsert = Partial<AirportTransferConfigRow>;

type HotelTransferFareRow = {
  band: 'same' | 'near' | 'far';
  sedan_minor: number;
  suv_minor: number;
  family_minor: number;
  van_minor: number;
  coaster_minor: number;
  updated_at: string;
};
type HotelTransferFareInsert = Partial<HotelTransferFareRow> & {
  band: 'same' | 'near' | 'far';
};

type HotelTransferConfigRow = { id: boolean; return_discount_pct: number; updated_at: string };
type HotelTransferConfigInsert = Partial<HotelTransferConfigRow>;

type AirportTransferHotelsRow = {
  slug: string;
  hotel_name: string;
  region: 'North' | 'South' | 'East' | 'West' | 'Central';
  zone: 'zone1' | 'zone2';
};
type AirportTransferHotelsInsert = AirportTransferHotelsRow;

type PlannerPlacesRow = {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  duration_min: number;
  closes_at: string | null;
  blurb: string | null;
  image_url: string | null;
  position: number;
  created_at: string;
};
type PlannerPlacesInsert = {
  id: string;
  name: string;
  category: string;
  region: string;
  lat: number;
  lng: number;
  duration_min: number;
  closes_at?: string | null;
  blurb?: string | null;
  image_url?: string | null;
  position?: number;
  created_at?: string;
};

type PlacesCacheRow = { key: string; data: Json; expires_at: string; created_at: string };
type PlacesCacheInsert = { key: string; data: Json; expires_at: string };

type SeoMetaRow = {
  path: string;
  title: string | null;
  description: string | null;
  og_image_url: string | null;
  updated_at: string;
  updated_by: string | null;
};
type SeoMetaInsert = {
  path: string;
  title?: string | null;
  description?: string | null;
  og_image_url?: string | null;
  updated_at?: string;
  updated_by?: string | null;
};

type PostsRow = {
  slug: string;
  title: string;
  meta_title: string | null;
  meta_description: string | null;
  excerpt: string | null;
  read_mins: number;
  sections: Json;
  faq: Json;
  hero_image_url: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  updated_at: string;
  updated_by: string | null;
};
type PostsInsert = {
  slug: string;
  title: string;
  meta_title?: string | null;
  meta_description?: string | null;
  excerpt?: string | null;
  read_mins?: number;
  sections?: Json;
  faq?: Json;
  hero_image_url?: string | null;
  status?: 'draft' | 'published';
  published_at?: string | null;
  updated_at?: string;
  updated_by?: string | null;
};

type SeoRedirectsRow = {
  from_path: string;
  to_path: string;
  created_at: string;
  updated_by: string | null;
};
type SeoRedirectsInsert = {
  from_path: string;
  to_path: string;
  created_at?: string;
  updated_by?: string | null;
};

type ReviewInvitesRow = {
  id: string;
  booking_id: string;
  activity_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  used_at: string | null;
};
type ReviewInvitesInsert = {
  id?: string;
  booking_id: string;
  activity_id: string;
  token: string;
  created_at?: string;
  expires_at?: string;
  used_at?: string | null;
};

type GuestReviewsRow = {
  id: string;
  booking_id: string;
  activity_id: string;
  customer_name: string;
  rating: number;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  submitted_at: string;
  moderated_at: string | null;
  moderated_by: string | null;
};
type GuestReviewsInsert = {
  id?: string;
  booking_id: string;
  activity_id: string;
  customer_name: string;
  rating: number;
  body: string;
  status?: 'pending' | 'approved' | 'rejected';
  submitted_at?: string;
  moderated_at?: string | null;
  moderated_by?: string | null;
};

type RentalVehiclesRow = {
  slug: string;
  name: string;
  category: string;
  seats: number;
  transmission: string | null;
  air_con: boolean;
  image_url: string | null;
  daily_rate_minor: number;
  deposit_minor: number;
  sort: number;
  active: boolean;
  updated_at: string;
};
type RentalVehiclesInsert = {
  slug: string;
  name: string;
  category?: string;
  seats?: number;
  transmission?: string | null;
  air_con?: boolean;
  image_url?: string | null;
  daily_rate_minor: number;
  deposit_minor?: number;
  sort?: number;
  active?: boolean;
  updated_at?: string;
};

type ActivityContentDefaultsRow = {
  category: string;
  /** 20260901000700 — primary key is now (category, locale); was (category) alone. */
  locale: Database['public']['Enums']['content_locale'];
  highlights: string[];
  inclusions: string[];
  exclusions: string[];
  what_to_bring: string[];
  important_info: string[];
  updated_at: string;
};
type ActivityContentDefaultsInsert = {
  category: string;
  locale?: Database['public']['Enums']['content_locale'];
  highlights?: string[];
  inclusions?: string[];
  exclusions?: string[];
  what_to_bring?: string[];
  important_info?: string[];
  updated_at?: string;
};

/** 20260831000000 — durable failure record. Written only through api_log_error (service_role). */
type ErrorLogsRow = {
  id: string;
  created_at: string;
  source: 'api' | 'ssr' | 'browser' | 'cron';
  event: string;
  message: string;
  error_name: string | null;
  stack: string | null;
  route: string | null;
  method: string | null;
  status: number | null;
  request_id: string | null;
  user_agent: string | null;
  context: Json | null;
};
type ErrorLogsInsert = {
  id?: string;
  created_at?: string;
  source: 'api' | 'ssr' | 'browser' | 'cron';
  event: string;
  message: string;
  error_name?: string | null;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  request_id?: string | null;
  user_agent?: string | null;
  context?: Json | null;
};

type TableDef<Row, Insert> = { Row: Row; Insert: Insert; Update: Partial<Insert>; Relationships: [] };

export interface Database {
  public: {
    Tables: {
      categories: TableDef<CategoriesRow, CategoriesInsert>;
      operators: TableDef<OperatorsRow, OperatorsInsert>;
      profiles: TableDef<ProfilesRow, ProfilesInsert>;
      activities: TableDef<ActivitiesRow, ActivitiesInsert>;
      activity_translations: TableDef<ActivityTranslationsRow, ActivityTranslationsInsert>;
      activity_images: TableDef<ActivityImagesRow, ActivityImagesInsert>;
      activity_options: TableDef<ActivityOptionsRow, ActivityOptionsInsert>;
      activity_option_prices: TableDef<ActivityOptionPricesRow, ActivityOptionPricesInsert>;
      session_occurrences: TableDef<SessionOccurrencesRow, SessionOccurrencesInsert>;
      booking_holds: TableDef<BookingHoldsRow, BookingHoldsInsert>;
      bookings: TableDef<BookingsRow, BookingsInsert>;
      booking_items: TableDef<BookingItemsRow, BookingItemsInsert>;
      activity_supplements: TableDef<ActivitySupplementsRow, ActivitySupplementsInsert>;
      booking_supplements: TableDef<BookingSupplementsRow, BookingSupplementsInsert>;
      payments: TableDef<PaymentsRow, PaymentsInsert>;
      payment_events: TableDef<PaymentEventsRow, PaymentEventsInsert>;
      booking_pickup_requests: TableDef<BookingPickupRequestsRow, BookingPickupRequestsInsert>;
      notification_outbox: TableDef<NotificationOutboxRow, NotificationOutboxInsert>;
      audit_logs: TableDef<AuditLogsRow, AuditLogsInsert>;
      leads: TableDef<LeadsRow, LeadsInsert>;
      reviews: TableDef<ReviewsRow, ReviewsInsert>;
      chat_sessions: TableDef<ChatSessionsRow, ChatSessionsInsert>;
      chat_messages: TableDef<ChatMessagesRow, ChatMessagesInsert>;
      sightseeing_pricing: TableDef<SightseeingPricingRow, SightseeingPricingInsert>;
      planner_pricing: TableDef<PlannerPricingRow, PlannerPricingInsert>;
      transport_band_pricing: TableDef<TransportBandPricingRow, TransportBandPricingInsert>;
      region_zone_distance: TableDef<RegionZoneDistanceRow, RegionZoneDistanceInsert>;
      airport_transfer_fare: TableDef<AirportTransferFareRow, AirportTransferFareInsert>;
      airport_transfer_config: TableDef<AirportTransferConfigRow, AirportTransferConfigInsert>;
      airport_transfer_hotels: TableDef<AirportTransferHotelsRow, AirportTransferHotelsInsert>;
      hotel_transfer_fare: TableDef<HotelTransferFareRow, HotelTransferFareInsert>;
      hotel_transfer_config: TableDef<HotelTransferConfigRow, HotelTransferConfigInsert>;
      seo_meta: TableDef<SeoMetaRow, SeoMetaInsert>;
      posts: TableDef<PostsRow, PostsInsert>;
      seo_redirects: TableDef<SeoRedirectsRow, SeoRedirectsInsert>;
      review_invites: TableDef<ReviewInvitesRow, ReviewInvitesInsert>;
      guest_reviews: TableDef<GuestReviewsRow, GuestReviewsInsert>;
      planner_places: TableDef<PlannerPlacesRow, PlannerPlacesInsert>;
      places_cache: TableDef<PlacesCacheRow, PlacesCacheInsert>;
      rental_vehicles: TableDef<RentalVehiclesRow, RentalVehiclesInsert>;
      activity_content_defaults: TableDef<
        ActivityContentDefaultsRow,
        ActivityContentDefaultsInsert
      >;
      error_logs: TableDef<ErrorLogsRow, ErrorLogsInsert>;
    };
    Views: { [_ in never]: never };
    Functions: {
      is_staff: { Args: Record<string, never>; Returns: boolean };
      used_capacity: { Args: { p_occurrence_id: string }; Returns: number };
      create_hold: {
        Args: { p_occurrence_id: string; p_quantity: number; p_idempotency_key: string };
        Returns: BookingHoldsRow;
      };
      release_hold: { Args: { p_hold_id: string }; Returns: BookingHoldsRow };
      api_release_hold: { Args: { p_hold_id: string }; Returns: BookingHoldsRow };
      expire_holds: { Args: Record<string, never>; Returns: number };
      create_booking: {
        Args: {
          p_idempotency_key: string;
          p_hold_id: string;
          p_customer_name: string;
          p_customer_email: string;
          p_customer_phone: string | null;
          p_source: Database['public']['Enums']['booking_source'];
          p_items: Json;
        };
        Returns: BookingsRow;
      };
      append_payment_event: {
        Args: {
          p_payment_id: string;
          p_type: string;
          p_provider_event_id: string | null;
          p_amount_minor: number;
          p_occurred_at: string;
          p_payload: Json;
        };
        Returns: PaymentsRow;
      };
      materialize_availability: { Args: { p: Json }; Returns: number };
      api_record_payment_checkout: { Args: { p: Json }; Returns: Json };
      api_clear_payment_checkout: { Args: { p: Json }; Returns: Json };
      api_release_checkout_claim: { Args: { p: Json }; Returns: Json };
      api_pending_payment_checkouts: { Args: { p: Json }; Returns: Json };
      api_swap_category_positions: { Args: { p_id_a: string; p_id_b: string }; Returns: undefined };
      api_reorder_activities: { Args: { p: Json }; Returns: undefined };
      api_mark_refunded: { Args: { p: Json }; Returns: Json };
      api_reschedule_booking: { Args: { p: Json }; Returns: Json };
      api_weather_cancel_occurrence: { Args: { p: Json }; Returns: Json };
      api_admin_calendar_month: { Args: { p: Json }; Returns: Json };
      api_erase_user: { Args: { p: Json }; Returns: Json };
      set_daily_capacity_atomic: { Args: { p: Json }; Returns: undefined };
      stop_availability_atomic: { Args: { p: Json }; Returns: undefined };
      api_list_rental_vehicles: { Args: { p: Json }; Returns: Json };
      api_content_defaults: { Args: { p: Json }; Returns: Json };
      api_moderate_guest_review: { Args: { p: Json }; Returns: Json };
      api_flag_settlement_review: { Args: { p: Json }; Returns: Json };
      api_save_card: { Args: { p: Json }; Returns: Json };
      api_list_saved_cards: { Args: { p: Json }; Returns: Json };
      api_delete_saved_card: { Args: { p: Json }; Returns: Json };
      api_list_card_tokens: { Args: { p: Json }; Returns: Json };
      api_upsert_fx_rate: { Args: { p: Json }; Returns: Json };
      api_fx_rate_status: { Args: { p: Json }; Returns: Json };
    };
    Enums: {
      user_role: 'customer' | 'staff' | 'admin' | 'seo';
      activity_type: 'activity' | 'transport';
      activity_status: 'draft' | 'published';
      activity_category:
        | 'Catamaran cruises'
        | 'Île aux Cerfs'
        | 'Dolphin swims'
        | 'Sea walks & diving'
        | 'Parasailing'
        | 'Sightseeing tours'
        | 'Airport transfers';
      content_locale: 'en' | 'fr';
      occurrence_status: 'open' | 'closed' | 'cancelled';
      hold_status: 'active' | 'consumed' | 'expired' | 'released';
      booking_status:
        | 'draft'
        | 'held'
        | 'payment_pending'
        | 'confirmed'
        | 'completed'
        | 'cancelled'
        | 'expired'
        | 'refund_pending'
        | 'refunded'
        | 'failed';
      booking_source: 'web' | 'ai_chat' | 'whatsapp' | 'quote';
      payment_state: 'pending' | 'paid' | 'partially_refunded' | 'refunded' | 'failed';
      lead_status: 'new' | 'contacted' | 'converted';
      notification_channel: 'email' | 'whatsapp';
      notification_status: 'pending' | 'sent' | 'failed' | 'cancelled';
    };
    CompositeTypes: { [_ in never]: never };
  };
}
