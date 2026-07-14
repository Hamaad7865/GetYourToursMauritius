-- Domain enums for Belle Mare Tours.

create type user_role as enum ('customer', 'staff', 'admin');
create type activity_type as enum ('activity', 'transport');
create type activity_status as enum ('draft', 'published');
create type activity_category as enum (
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Island tours',
  'Airport transfers'
);
create type content_locale as enum ('en', 'fr');

create type occurrence_status as enum ('open', 'closed', 'cancelled');
create type hold_status as enum ('active', 'consumed', 'expired', 'released');

create type booking_status as enum (
  'draft',
  'held',
  'payment_pending',
  'confirmed',
  'completed',
  'cancelled',
  'expired',
  'refund_pending',
  'refunded',
  'failed'
);
create type booking_source as enum ('web', 'ai_chat', 'whatsapp');

-- Cached projection of the payment event ledger.
create type payment_state as enum ('pending', 'paid', 'partially_refunded', 'refunded', 'failed');

create type lead_status as enum ('new', 'contacted', 'converted');
create type notification_channel as enum ('email', 'whatsapp');
create type notification_status as enum ('pending', 'sent', 'failed', 'cancelled');
