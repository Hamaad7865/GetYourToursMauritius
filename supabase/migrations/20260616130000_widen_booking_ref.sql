-- Widen the booking reference from 8 to 16 hex chars (~32 -> ~64 bits of entropy). The ref is
-- exposed in /bookings/{ref} URLs and, until edge rate limiting lands, is effectively the only
-- entropy standing between an attacker and the payment-confirmation webhook (which looks a
-- booking up by ref). 32 bits is brute-forceable; 64 is not. Existing refs stay valid (still
-- unique) — only newly generated refs use the wider space.
alter table bookings
  alter column ref set default ('BMT-' || upper(substr(md5(gen_random_uuid()::text), 1, 16)));
