'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Logo } from '@/components/site/Logo';
import { Price } from '@/components/site/Price';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { PickupDropoffMap } from '@/components/maps/PickupDropoffMap';
import { childSeatsCost, regionFromCoords, transportFare } from '@/lib/services/pricing';
import { decodeParty } from '@/lib/services/party';
import { transfers, type Transfer } from '@/lib/content/transfers';
import type { TransportBands, RegionDistances } from '@/lib/validation/tours';
import { canAdvanceStep1 } from '@/lib/checkout/pickup';
import { resolveIdemKey } from '@/lib/checkout/idempotency';
import { selectionHash, shouldRehydrateBooking } from '@/lib/checkout/selection';
import { useCart } from '@/lib/cart/useCart';
import { parseApiJson } from '@/lib/http/fetch-json';
import { IconCalendar, IconCheck, IconClock, IconGlobe, IconPin, IconSearch, IconUsers } from '@/components/ui/icons';

const STEPS = ['Trip & pickup', 'Contact', 'Payment'];

// Stable ids for the disabled-CTA gate hints, so a related input's aria-describedby always points at
// the same element (the hint is an aria-live region that announces WHY the Next/Pay CTA is disabled).
const PICKUP_HINT_ID = 'checkout-pickup-hint';
const PHONE_HINT_ID = 'checkout-phone-hint';

// A short list of common visitor nationalities for the personal-details step. Mauritius is first
// (the home market), then the largest source markets. The chosen country IS sent on the booking
// (traveller_country) — required for airport transfers, captured for every booking. Real-world country
// names are proper nouns and are not translated.
const COUNTRIES = [
  'Mauritius',
  'United Kingdom',
  'France',
  'Germany',
  'India',
  'South Africa',
  'Réunion',
  'Italy',
  'Spain',
  'Switzerland',
  'Belgium',
  'Netherlands',
  'Austria',
  'Ireland',
  'Portugal',
  'Sweden',
  'Norway',
  'Denmark',
  'Poland',
  'Russia',
  'China',
  'Australia',
  'United States',
  'Canada',
  'United Arab Emirates',
  'Saudi Arabia',
  'Madagascar',
  'Seychelles',
  'Kenya',
  'Other',
] as const;

function Spinner({ label }: { label: string }) {
  // role="img" + an accessible name so the spinning CTA isn't a nameless button during the
  // multi-second create→reconcile→pay round-trip (the live status region below also announces it).
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
    />
  );
}

/**
 * GetYourGuide-style 3-step checkout: (1) confirm transport/pickup, (2) contact — sign in
 * or create an account if needed, (3) payment. The selection arrives via query params from
 * the booking widget; the booking + payment are created at the payment step (once signed in).
 */
export function Checkout() {
  const params = useSearchParams();
  const { user, profile, session, openAuth } = useAuth();
  const t = useT();
  const money = useMoney();
  // Mirror the active checkout hold into the cart as an on-hold line (see the mount effect below), and
  // remove it once the booking is paid. Both functions are useCallback-stable across renders.
  const { upsertHeld, remove: removeCartLine } = useCart();

  const occ = params.get('occ') ?? '';
  const label = params.get('label') ?? '';
  // Guard a tampered/malformed `?qty=` — `Math.max(1, Number('abc'))` is NaN, which would otherwise
  // flow into the child-seat clamp and the booking POST body. Mirror the `total` param's finite guard.
  const qtyRaw = Number(params.get('qty') ?? '1');
  const qty = Number.isFinite(qtyRaw) && qtyRaw >= 1 ? Math.floor(qtyRaw) : 1;
  // Age-banded booking: the per-tier party map (Adult/Child/Infant). When present it's what the server
  // prices; `label`/`qty` remain for the single-tier path + display (qty already equals the total heads).
  const partyMap = decodeParty(params.get('party'));
  const slug = params.get('slug') ?? '';
  const title = params.get('title') ?? 'Your booking';
  const lang = params.get('lang') ?? 'English';
  // Treat the URL `total` as an untrusted display hint: coerce it, and never echo garbage.
  const totalNum = Number(params.get('total'));
  const total = Number.isFinite(totalNum) && totalNum > 0 ? totalNum.toFixed(2) : '';
  const when = params.get('when') ?? '';
  const guests = params.get('guests') ?? '';
  const unit = params.get('unit') ?? '';
  // Sightseeing vehicle mode only: the SUV upgrade flag. The server re-resolves the price regardless.
  const suv = params.get('suv') === '1';
  // Child seats chosen (first free, €6 each extra). Clamp to [0,25] AND to the party (qty): the server
  // caps child_seats at the booked party, so a stale/hand-edited URL must not show or charge more.
  const childSeats = Math.max(0, Math.min(25, qty, parseInt(params.get('childSeats') ?? '0', 10) || 0));
  // Continue ("Book now", from=widget) carries a custom route stashed by slug; a cart line carries its
  // OWN route, staged by occurrence (from=cart). Either may be present; neither inherits the other's.
  const fromWidget = params.get('from') === 'widget';
  const fromCart = params.get('from') === 'cart';
  // The hold reserved before checkout (reused at pay so the spot isn't double-held) + its real expiry +
  // the shared idempotency key — handed over via sessionStorage (NOT the URL, which would leak them).
  // BOTH the widget/planner Continue (from=widget) AND a cart proceed (from=cart) stash a real hold for
  // this occurrence; either may reuse it. A plain (no-from) checkout must NEVER inherit one (the key is
  // occurrence-scoped, so a stale hold for the same occurrence would otherwise block the line as
  // "expired" and its idem could replay the earlier booking). A past expiry is treated as no hold, so the
  // fresh path mints its own key and creates its own hold at pay.
  function readHold(): { holdId: string; expiresAt: string; idem: string } {
    if (typeof window === 'undefined' || !occ || !(fromWidget || fromCart)) return { holdId: '', expiresAt: '', idem: '' };
    try {
      const raw = window.sessionStorage.getItem(`gytm:hold:${occ}`);
      const h = raw ? JSON.parse(raw) : null;
      const exp = h?.expiresAt || '';
      if (exp && new Date(exp).getTime() <= Date.now()) return { holdId: '', expiresAt: '', idem: '' };
      return { holdId: h?.holdId || '', expiresAt: exp, idem: h?.idem || '' };
    } catch {
      return { holdId: '', expiresAt: '', idem: '' };
    }
  }
  const { holdId, expiresAt, idem: idemParam } = readHold();
  // The booking IDENTITY (idempotency key + the created ref + the selection hash that created it)
  // persisted per occurrence. Unlike the hold / pickup / itinerary stashes, this one SURVIVES a
  // successful booking on purpose: pressing browser Back or reloading /checkout remounts this
  // component, and rehydrating from here means the SAME idem key is reused (the server dedups → no
  // second booking row) and the existing ref is reused (pay() takes the `else` branch instead of
  // creating again). Without it a fresh random key would mint a duplicate, payable booking → a double
  // charge. Keyed by occurrence; try/catch as storage may be off.
  //
  // The occurrence id is party/config-INDEPENDENT (date + option), so the bare ref/idem must NOT be
  // trusted on their own: a re-checkout of the SAME date with a DIFFERENT party hits the same key and
  // would rehydrate the OLD party's booking → pay() would skip creation AND the price-reconciliation
  // gate → wrong-amount charge (the P0). The persisted `sel` (a selectionHash of the price-relevant
  // fields) lets the caller rehydrate ONLY when the current selection matches.
  function readBooking(): { idem: string; ref: string | null; sel: string } {
    if (typeof window === 'undefined' || !occ) return { idem: '', ref: null, sel: '' };
    try {
      const raw = window.sessionStorage.getItem(`gytm:booking:${occ}`);
      const b = raw ? JSON.parse(raw) : null;
      return { idem: b?.idemKey || '', ref: b?.bookingRef || null, sel: b?.sel || '' };
    } catch {
      return { idem: '', ref: null, sel: '' };
    }
  }
  // The chosen route is stashed in sessionStorage (too big for the URL): by slug from Continue, by
  // occurrence from a cart line. Read whichever applies to this checkout — never the other's key.
  function readItinerary(): Array<{ title: string; area?: string | null; lat?: number; lng?: number }> | null {
    if (typeof window === 'undefined') return null;
    const key =
      fromWidget && slug
        ? `gytm:itinerary:${slug}`
        : fromCart && occ
          ? `gytm:itinerary:occ:${occ}`
          : null;
    if (!key) return null;
    try {
      const raw = window.sessionStorage.getItem(key);
      const arr = raw ? JSON.parse(raw) : null;
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch {
      return null;
    }
  }

  // Pickup / drop-off chosen in the AI planner (when arriving from "Get my quote"): pre-fill the
  // pickup step with the pickup, and carry a distinct drop-off onto the booking for the driver.
  const pickupParam = (params.get('pickup') ?? '').slice(0, 160);
  const dropoffParam = (params.get('dropoff') ?? '').slice(0, 160);

  // Airport transfer: a fixed-origin (SSR) product. `transfer=1` switches step ① to flight details
  // (no pickup map — pickup IS the airport). The server re-derives the destination region from
  // dropoffSlug and recomputes the fare; the URL `total` is only a display hint, reconciled before pay.
  const isAirport = params.get('transfer') === '1';
  const dropoffSlugParam = (params.get('dropoffSlug') ?? '').slice(0, 120);
  // Hotel-to-hotel (point-to-point) transfer: `htransfer=1`. Both ends + the trip are chosen in the
  // console and carried here; step ① is a light confirmation (no flight fields, no pickup map). The
  // server re-derives BOTH regions from the slugs (or area_region for a free-text end) and recomputes the
  // band fare — the URL `total` is only a display hint, reconciled before pay.
  const isHotelTransfer = params.get('htransfer') === '1';
  const pickupSlugParam = (params.get('pickupSlug') ?? '').slice(0, 120);
  const pickupAreaParam = (params.get('pickupArea') ?? '').slice(0, 120);
  const dropoffAreaParam = (params.get('dropoffArea') ?? '').slice(0, 120);
  // Hotel-to-hotel free Google Places ends carry coordinates; the server derives each region from them
  // (region_from_coords, zero-trust) when the end isn't a listed hotel slug. A finite number or null.
  const coordNum = (s: string | null): number | null => {
    const n = Number(s);
    return s && Number.isFinite(n) ? n : null;
  };
  const pickupLatParam = coordNum(params.get('pickupLat'));
  const pickupLngParam = coordNum(params.get('pickupLng'));
  const dropoffLatParam = coordNum(params.get('dropoffLat'));
  const dropoffLngParam = coordNum(params.get('dropoffLng'));
  // Trip type (priced) is derived from the customer-facing direction below; the URL still carries the
  // widget's one_way/return as a prefill hint for the direction.
  const tripTypeParam: 'one_way' | 'return' = params.get('tripType') === 'return' ? 'return' : 'one_way';
  const returnDateParam = (params.get('retDate') ?? '').slice(0, 40);

  // The PRICE-RELEVANT selection, hashed from inputs that are STABLE across a Back/reload of this
  // /checkout URL. Used on BOTH sides of the rehydration gate: pay() persists this hash with the
  // booking ref, and a remount recomputes it and only rehydrates when they match. Every price-moving
  // dimension is covered: the price-tier (label), party (qty), SUV upgrade, child seats, the planner
  // pickup/drop-off text, AND the displayed `total` — which already folds in the price effect of the
  // pickup region fee and the chosen itinerary, so those don't need their own (volatile, post-success
  // cleared) sessionStorage reads here. The occurrence id is party/config-INDEPENDENT, so this hash —
  // not `occ` — is what distinguishes "the SAME selection (legit Back/reload → rehydrate)" from "a
  // DIFFERENT party for the same date (must NOT rehydrate → fresh booking at the new price)".
  //
  // Pickup is now chosen IN checkout (the customer can add/change it here), so its coords aren't known
  // at mount and aren't part of this mount-time gate — only the planner/URL pickup/drop-off TEXT and
  // the URL `total` are. That's the right scope: the gate exists to stop a re-checkout of the same
  // occurrence with a DIFFERENT URL selection (party/tier/seats/total) from replaying an earlier
  // booking. A pickup chosen here changes the SERVER total, which the pay() reconciliation gate below
  // re-checks before charging on BOTH the create and the rehydrated-ref paths.
  function urlSelectionHash(): string {
    return selectionHash({
      priceLabel: label,
      qty,
      suv,
      childSeats,
      pickupText: pickupParam,
      pickupLat: null,
      pickupLng: null,
      pickupTbd: false,
      dropoffText: dropoffParam,
      itinerary: null,
      total,
    });
  }
  // Decide ONCE at mount whether the persisted booking identity may be rehydrated: only when the
  // entry is widget/cart AND the stored selection hash matches the current one. A stale/mismatched
  // stash (a DIFFERENT party for the same occurrence, or a cold no-from load) is ignored so neither
  // the ref nor the idem key replays the wrong-priced booking.
  const canRehydrateBooking = shouldRehydrateBooking({
    storedSel: typeof window !== 'undefined' && occ ? readBooking().sel : '',
    currentSel: typeof window !== 'undefined' && occ ? urlSelectionHash() : '',
    from: fromWidget ? 'widget' : fromCart ? 'cart' : 'none',
  });

  const [step, setStep] = useState(1);
  // "Do you want pickup?" — ALWAYS defaults to Yes (this operator picks customers up by default). The
  // customer can still switch to "No, I'll make my own way". A pickup default needs an address (or
  // "I don't know yet") to advance — see canAdvanceStep1.
  const [wantsPickup, setWantsPickup] = useState(true);
  // "I don't know yet" — a pickup is wanted but no address can be given now (server charges no fee).
  const [tbd, setTbd] = useState(false);
  // A private sightseeing tour is vehicle-priced: the operator's own vehicle ALWAYS collects the
  // customer (door to door), so pickup is mandatory and "make my own way" / a fixed meeting point
  // doesn't apply. Seeded synchronously from the URL `unit` (no flash) and confirmed from the
  // activity's pricingMode by the fetch below.
  const [isVehicleTour, setIsVehicleTour] = useState(unit === 'per vehicle');
  const [pickupLoc, setPickupLoc] = useState(pickupParam);
  // Resolved pickup coordinates — drive the region-based transport fee the server charges. Prefilled
  // from the widget's stash (below) or captured when the customer picks a place / drags the pin here.
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  // Drop-off — mirrors the booking widget's `dropoffSame` (default true = same point as pickup). When
  // the customer turns it OFF, the single map reveals a distinct drop-off input + a second pin, and a
  // distinct drop-off is sent on the booking. The text/coords are captured from that map. A planner
  // prefill that carried a DISTINCT drop-off starts with the toggle off so that address shows.
  const [dropoffSame, setDropoffSame] = useState(!dropoffParam);
  const [dropoffText, setDropoffText] = useState(dropoffParam);
  // Resolved drop-off coordinates — UX only: the map captures them (and pre-fills from a planner stash)
  // to place/bound the second pin, but they have no DB column, so the parent never reads the value back
  // and never sends it on the booking body. Hence the getter is intentionally unused (underscored).
  const [_dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  // This activity's region + transport fare tables, fetched once for the slug. Lets checkout show the
  // LIVE region-based transport fee as the customer enters their pickup (transport is chosen + priced
  // HERE now, not on the activity page). The server still re-derives + enforces the fee from the coords.
  const [fares, setFares] = useState<{ region: string; bands: TransportBands; distances: RegionDistances } | null>(
    null,
  );
  // Airport-transfer flight details (collected HERE so travellers "save time on arrival"). They don't
  // affect the fare, so they're captured at checkout rather than before the hold.
  const [flightNumber, setFlightNumber] = useState('');
  // Arrival + return times are captured in the booking widget and carried here (pre-filled, editable).
  const [arrivalTime, setArrivalTime] = useState(() => (params.get('arr') ?? '').slice(0, 40));
  const [arrivalDate, setArrivalDate] = useState(() => (params.get('arrDate') ?? '').slice(0, 40));
  const [departureFlight, setDepartureFlight] = useState('');
  const [departureDate, setDepartureDate] = useState(() => (returnDateParam || '').slice(0, 40));
  const [returnTime, setReturnTime] = useState(() => (params.get('retTime') ?? '').slice(0, 40));
  // Customer-facing trip DIRECTION (arrival/departure/return). Prefilled from the widget's one_way/return:
  // a return stays return; a one-way defaults to "arrival" (the most common — airport → hotel). The server
  // derives the priced trip_type (return = both legs − discount; arrival/departure = one leg).
  const [tripDirection, setTripDirection] = useState<'arrival' | 'departure' | 'return'>(
    tripTypeParam === 'return' ? 'return' : 'arrival',
  );
  // Hotel / drop-off chosen from the transfer-hotel search. dropoffSlug sets the priced zone (server
  // re-derives it). "My hotel isn't listed" switches to a free-text name + area → the server prices Zone 1
  // unless the area is a Zone 2 area. Prefilled from the widget's deep-link (slug + name).
  const widgetHotel = dropoffSlugParam ? transfers.find((tt) => tt.slug === dropoffSlugParam) ?? null : null;
  const [dropoffSlug, setDropoffSlug] = useState(dropoffSlugParam);
  const [dropoffName, setDropoffName] = useState(widgetHotel?.hotelName ?? dropoffParam);
  const [dropoffArea, setDropoffArea] = useState(widgetHotel?.area ?? '');
  const [hotelNotListed, setHotelNotListed] = useState(false);
  const [hotelQuery, setHotelQuery] = useState(widgetHotel?.hotelName ?? dropoffParam);
  // Trip extras (all optional). roomOrCabin = hotel room / cruise cabin; luggageDetails = free text;
  // childSeat toggle + age (the age is the child-seat detail the operator needs to fit the right seat).
  const [roomOrCabin, setRoomOrCabin] = useState('');
  const [luggageDetails, setLuggageDetails] = useState('');
  const [childSeatWanted, setChildSeatWanted] = useState(false);
  const [childSeatAge, setChildSeatAge] = useState('');
  // Lead-traveller extras captured on the airport form (gender/company optional; country required, set
  // in the details step state below; special notes optional).
  const [gender, setGender] = useState('');
  const [company, setCompany] = useState('');
  const [specialNotes, setSpecialNotes] = useState('');
  // Personal-details (step ②) form state. Name + phone seed from the profile once it loads (see the
  // effect below); country defaults to the home market. Email is the account email, shown read-only.
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<string>(COUNTRIES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(() => {
    if (expiresAt) {
      const s = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      return s > 0 ? s : 0;
    }
    return 30 * 60;
  });
  // Stable idempotency key + booking ref so a retry — including a browser Back or a /checkout reload
  // that REMOUNTS this component — reuses the same booking/payment instead of creating an orphaned,
  // seat-holding, separately-payable duplicate (a double charge). Precedence for the key: a key
  // persisted for this occurrence (gytm:booking) → the hold's key handed over from Continue → a fresh
  // random key. The ref rehydrates from the same stash so pay() goes straight to the existing booking's
  // payment instead of re-creating it.
  //
  // BOTH rehydrations are gated on `canRehydrateBooking` (entry is widget/cart AND the persisted
  // selection hash matches the current one). When the selection differs (same occurrence, different
  // party/config) we deliberately DROP the persisted key too — not just the ref — so a changed
  // selection mints a FRESH idem key → the server does NOT dedup it as a replay → pay() creates a NEW
  // booking at the NEW price. Reusing the old key would replay the old (wrong-priced) booking.
  const [idemKey] = useState(() =>
    resolveIdemKey({
      persisted: canRehydrateBooking ? readBooking().idem : null,
      fromHold: idemParam,
      fresh: crypto.randomUUID(),
    }),
  );
  const [bookingRef, setBookingRef] = useState<string | null>(() =>
    canRehydrateBooking ? readBooking().ref : null,
  );
  // Authoritative price from the created booking — what the customer is actually charged.
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  // Live region-based transport fee, computed as the customer enters pickup (mirrors the server's
  // transport_fare_minor cent-for-cent; the server still re-derives + enforces it at booking). It's 0
  // when there's no pickup / not eligible / fares haven't loaded — in which case the authoritative
  // server total reveals any fee at the pay step via the reconciliation gate below.
  const pickupRegion = pickupCoords ? regionFromCoords(pickupCoords.lat, pickupCoords.lng) : null;
  const liveTransport =
    fares && wantsPickup && !tbd && pickupCoords && pickupRegion
      ? transportFare(pickupRegion, fares.region, qty, suv, fares.bands, fares.distances)
      : 0;
  // The pre-booking total we SHOW + reconcile against: base (URL) + the live transport fee. Once the
  // booking is created, the authoritative serverTotal takes over.
  const expectedTotal = total ? Number(total) + liveTransport : null;
  // Numeric EUR amount for <Price>/money() — null when we have nothing to show yet.
  const displayTotalNum = serverTotal != null ? serverTotal : expectedTotal;

  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Seed the personal-details form from the signed-in profile once it loads, without clobbering an
  // edit the customer has already made (only fill an empty field). The account email is read straight
  // from the session below and never stored in form state.
  useEffect(() => {
    if (profile?.fullName) setName((cur) => cur || profile.fullName!);
    if (profile?.phone) setPhone((cur) => cur || profile.phone!);
  }, [profile]);

  // Prefill the pickup from the widget's stash (keyed by occurrence). The coordinates drive the
  // region-based transport fare the server computes; read post-mount to avoid an SSR mismatch.
  useEffect(() => {
    if (typeof window === 'undefined' || !occ) return;
    try {
      const raw = window.sessionStorage.getItem(`gytm:pickup:${occ}`);
      const p = raw ? JSON.parse(raw) : null;
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') {
        setWantsPickup(true);
        setTbd(false);
        setPickupLoc((cur) => cur || p.address || '');
        setPickupCoords({ lat: p.lat, lng: p.lng });
        if (p.dropoff?.address) {
          // A stashed distinct drop-off: reveal it (toggle off) and pre-fill its text + coords.
          setDropoffSame(false);
          setDropoffText((cur) => cur || p.dropoff.address);
          if (typeof p.dropoff.lat === 'number' && typeof p.dropoff.lng === 'number') {
            setDropoffCoords({ lat: p.dropoff.lat, lng: p.dropoff.lng });
          }
        }
      }
    } catch {
      /* sessionStorage unavailable — the customer can enter the pickup here */
    }
  }, [occ]);

  // Fetch this activity's transport fare tables once. api_get_activity returns them ONLY for eligible
  // (per_person/per_group with pickup) activities, so a null result just means "no transport here".
  useEffect(() => {
    if (!slug) return;
    let active = true;
    fetch(`/api/v1/activities/${slug}`)
      .then((r) => parseApiJson<{ pricingMode?: string; region?: string; transportBands?: TransportBands; regionDistances?: RegionDistances }>(r))
      .then((body) => {
        if (!active || !body.ok) return;
        const a = body.data;
        // Authoritative pickup-mandatory signal: a vehicle-priced tour is collected door to door.
        if (a?.pricingMode) setIsVehicleTour(a.pricingMode === 'vehicle');
        if (a?.region && a?.transportBands && a?.regionDistances) {
          setFares({ region: a.region, bands: a.transportBands, distances: a.regionDistances });
        }
      })
      .catch(() => {
        /* offline / not found — server still enforces any fee; reconciliation surfaces it at pay */
      });
    return () => {
      active = false;
    };
  }, [slug]);

  // Mirror this checkout's live hold into the cart as an "on hold" line, so leaving the page keeps the
  // held spot visible (with its countdown) instead of silently ticking away. Reads the line the widget
  // stashed (gytm:cartline:{occ}) + the hold from readHold(); the cart's own timer + server reconcile +
  // expiry bell take over from there. A cart proceed already has its line (no stash), so it's skipped;
  // re-entering checkout just refreshes the same-id line (upsertHeld is idempotent).
  useEffect(() => {
    if (typeof window === 'undefined' || !occ || !holdId || !expiresAt) return;
    if (new Date(expiresAt).getTime() <= Date.now()) return;
    try {
      const raw = window.sessionStorage.getItem(`gytm:cartline:${occ}`);
      const line = raw ? JSON.parse(raw) : null;
      if (line?.id) upsertHeld({ ...line, holdId, expiresAt });
    } catch {
      /* sessionStorage unavailable — skip the mirror; checkout still works */
    }
  }, [occ, holdId, expiresAt, upsertHeld]);

  if (!occ || !slug) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-ink-muted">{t('Your selection expired — please choose your date again.')}</p>
        <Link href={slug ? `/activities/${slug}` : '/activities'} className="mt-3 inline-block text-sm font-bold text-teal-dark">
          {t('Back to the activity')}
        </Link>
      </div>
    );
  }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  // A real hold has a server expiry only when expiresAt was stashed on Continue; the 30-min fallback is
  // cosmetic. Lock Pay only when a REAL hold ran out — cart checkouts (no hold) are never blocked.
  const expired = Boolean(expiresAt) && secs === 0;
  // Airport transfer: a hotel/drop-off is always required (slug-selected or a free-text "not listed"
  // name), plus the leg fields for the chosen direction — arrival needs the arrival flight + date + time;
  // departure needs the departure date + time + flight; return needs both legs.
  const hotelChosen = hotelNotListed ? dropoffName.trim().length > 0 : dropoffSlug.trim().length > 0;
  const arrivalLegOk = flightNumber.trim().length > 0 && arrivalDate.trim().length > 0 && arrivalTime.trim().length > 0;
  const departureLegOk =
    departureFlight.trim().length > 0 && departureDate.trim().length > 0 && returnTime.trim().length > 0;
  const airportLegsOk =
    tripDirection === 'arrival' ? arrivalLegOk : tripDirection === 'departure' ? departureLegOk : arrivalLegOk && departureLegOk;
  // Step ① can advance unless pickup is wanted with no address and not "I don't know yet" — or, for an
  // airport transfer, until the hotel + the required leg fields are entered.
  // Hotel-to-hotel: the route is already chosen in the console; step ① just confirms the pickup date
  // (and the return date when it's a return trip), both prefilled.
  const hotelTransferLegsOk =
    arrivalDate.trim().length > 0 && (tripTypeParam !== 'return' || departureDate.trim().length > 0);
  const canAdvance = isAirport
    ? hotelChosen && airportLegsOk
    : isHotelTransfer
      ? hotelTransferLegsOk
      : canAdvanceStep1({ wantsPickup, address: pickupLoc, tbd });
  // Step ② (personal details): a phone is REQUIRED when the booking has a pickup — TBD still counts
  // as a pickup, since the driver needs to reach the customer to arrange it. A transfer always needs one
  // (the driver meets/collects the traveller). No pickup → optional.
  const phoneRequired = isAirport || isHotelTransfer || wantsPickup;
  const canAdvanceDetails = !phoneRequired || phone.trim().length > 0;

  function continueFromTransport() {
    // Authoritative gate: pickup wanted needs an address (or "I don't know yet"). The CTA is also
    // disabled, but guard here so a keyboard/programmatic advance can't skip step ①.
    if (!canAdvance) return;
    setBusy(true);
    setError(null);
    window.setTimeout(() => {
      setBusy(false);
      // Always land on step ② — signed in shows the personal-details form, signed out shows the
      // sign-in prompt. (Previously signed-in users skipped straight to payment.)
      setStep(2);
    }, 700);
  }

  function continueFromDetails() {
    // Authoritative gate, mirroring step ①: a pickup booking needs a phone. The CTA is also disabled,
    // but guard here so a keyboard/programmatic advance can't skip the requirement.
    if (!canAdvanceDetails) return;
    setStep(3);
  }

  // Reconcile the authoritative server total against the total we DISPLAYED. Returns true (and
  // surfaces the "price changed" warning) when they differ — the caller must STOP before charging.
  // Used on BOTH the create path AND the rehydrated-ref path, so a rehydrated booking can never
  // silently pay a mismatched amount. The baseline is `expectedTotal` (the URL base + the live
  // pickup/transport fee the customer chose HERE in checkout), NOT the bare URL `total` — otherwise
  // legitimately adding a pickup fee in this step would falsely trip the warning. When we have no
  // displayed total to compare against, we never block (the server stays the final authority at pay).
  function reconcileOrWarn(srv: number | null): boolean {
    if (srv != null) setServerTotal(srv);
    if (srv != null && expectedTotal != null && Math.abs(srv - expectedTotal) >= 0.005) {
      setError(t('The price for this date is {price}. Tap Pay again to continue.', { price: money(srv) }));
      setBusy(false);
      return true;
    }
    return false;
  }

  async function pay() {
    if (expired) {
      setError(t('Your hold expired — please pick your date again.'));
      return;
    }
    if (!session) return openAuth('signin');
    setBusy(true);
    setError(null);
    try {
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` };
      // The selection hash scopes the persisted booking identity to the FULL price-relevant config, so
      // a later re-checkout of the same occurrence with a different party can't rehydrate this ref. The
      // SAME urlSelectionHash() recomputed on a remount is what gates the rehydration (see above).
      const sel = urlSelectionHash();
      // Create the booking once (idempotent + remembered); a retry reuses it.
      let ref = bookingRef;
      if (!ref) {
        // Persist the idem key + selection hash BEFORE the request so a crash/abort mid-flight still
        // reuses the same key on the retry (server then dedups → no duplicate booking), and a remount
        // only rehydrates when the selection still matches. Updated with the ref once it lands.
        try {
          if (occ) window.sessionStorage.setItem(`gytm:booking:${occ}`, JSON.stringify({ idemKey, sel }));
        } catch {
          /* sessionStorage unavailable — the key is still stable for the lifetime of this mount */
        }
        const bookingRes = await fetch('/api/v1/bookings', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            occurrenceId: occ,
            expectedSlug: slug,
            party: partyMap ?? { [label]: qty },
            suv,
            childSeats,
            holdId: holdId || undefined,
            itinerary: readItinerary(),
            // Pickup + drop-off are DISTINCT fields on the booking — never concatenated. A fixed
            // pickup address sends its text (+ coords); the drop-off sends its own text. "I don't
            // know yet" (tbd) sends no address/coords but flags pickupPending so admin sees a
            // pending pickup. "No pickup" sends all null/false. Clamped to 200 to match the schema.
            // Airport transfer: pickup IS the airport, drop-off is the hotel. Otherwise the customer's
            // chosen pickup (+ a distinct drop-off only when "same as pickup" is off). dropoffCoords is
            // UX-only (no DB column), so it's never sent here.
            pickupLocation: isAirport
              ? 'SSR International Airport (arrivals)'
              : isHotelTransfer
                ? pickupParam || null
                : wantsPickup && !tbd && pickupLoc.trim()
                  ? pickupLoc.trim().slice(0, 200)
                  : null,
            // Airport drop-off: the chosen hotel name (with its room/cabin appended for the driver) or the
            // free-text "not listed" name. Hotel-to-hotel: the chosen drop-off location label. Otherwise
            // the customer's distinct sightseeing drop-off.
            dropoffLocation: isAirport
              ? (dropoffName.trim() || dropoffParam || null)
              : isHotelTransfer
                ? dropoffParam || null
                : wantsPickup && !tbd && !dropoffSame && dropoffText.trim()
                  ? dropoffText.trim().slice(0, 200)
                  : null,
            pickupPending: isAirport || isHotelTransfer ? false : wantsPickup && tbd,
            // Pickup coordinates → the server re-derives the region and adds the transport fare (only
            // for per_person/per_group activities with pickup; ignored otherwise). Never a client price.
            // A TBD pickup — or either transfer product (fixed band fare) — sends no coords → no transport fee.
            // Hotel-to-hotel carries the pickup-end coords from its Google Places pick; otherwise it's the
            // per_person/per_group transport pickup. Airport sends none (its fare is zone, not region).
            pickupLat: isHotelTransfer ? pickupLatParam : !isAirport && wantsPickup && !tbd && pickupCoords ? pickupCoords.lat : null,
            pickupLng: isHotelTransfer ? pickupLngParam : !isAirport && wantsPickup && !tbd && pickupCoords ? pickupCoords.lng : null,
            // Hotel-to-hotel drop-off-end coords (the server derives its region from them, zero-trust).
            dropoffLat: isHotelTransfer ? dropoffLatParam : undefined,
            dropoffLng: isHotelTransfer ? dropoffLngParam : undefined,
            // Transfers: the SERVER re-derives the region(s) and recomputes the fare — airport from
            // dropoffSlug (or its free-text area); hotel-to-hotel from BOTH ends' slugs (or area_region for
            // a free-text end). These are zero-trust inputs, never a client price. The flight/trip/traveller
            // fields are stored for the operator run sheet + receipt.
            dropoffSlug: isHotelTransfer
              ? dropoffSlugParam || null
              : isAirport && !hotelNotListed
                ? dropoffSlug || null
                : null,
            dropoffArea: isHotelTransfer ? dropoffAreaParam || null : isAirport ? dropoffArea.trim() || null : undefined,
            // Hotel-to-hotel only: the pickup end (the server re-derives its region the same zero-trust way).
            pickupSlug: isHotelTransfer ? pickupSlugParam || null : undefined,
            pickupArea: isHotelTransfer ? pickupAreaParam || null : undefined,
            // Hotel-to-hotel prices by tripType directly; airport derives it from tripDirection below.
            tripType: isHotelTransfer ? tripTypeParam : undefined,
            tripDirection: isAirport ? tripDirection : undefined,
            flightNumber: isAirport && tripDirection !== 'departure' ? flightNumber.trim() || null : undefined,
            // The pickup/arrival time: airport (arrival/return legs) AND hotel-to-hotel both collect it
            // in step ①; without the htransfer case the point-to-point pickup time the customer enters
            // is silently dropped (no run-sheet/voucher/receipt time → mis-timed pickups).
            arrivalTime:
              (isAirport && tripDirection !== 'departure') || isHotelTransfer
                ? arrivalTime.trim() || null
                : undefined,
            // Departure-leg fields (departure or return). returnDate carries the departure pickup date.
            // Hotel-to-hotel carries the chosen return date/time when it's a return trip.
            returnDate: isAirport
              ? tripDirection !== 'arrival'
                ? departureDate.trim() || null
                : undefined
              : isHotelTransfer && tripTypeParam === 'return'
                ? departureDate.trim() || null
                : undefined,
            returnTime: isAirport
              ? tripDirection !== 'arrival'
                ? returnTime.trim() || null
                : undefined
              : isHotelTransfer && tripTypeParam === 'return'
                ? returnTime.trim() || null
                : undefined,
            departureFlightNumber: isAirport && tripDirection !== 'arrival' ? departureFlight.trim() || null : undefined,
            roomOrCabin: isAirport || isHotelTransfer ? roomOrCabin.trim() || null : undefined,
            luggageDetails: isAirport || isHotelTransfer ? luggageDetails.trim() || null : undefined,
            childSeatAge: isAirport && childSeatWanted && childSeatAge.trim() ? Number(childSeatAge) : undefined,
            customer: {
              // Name + phone come from the step-② details form (falling back to the profile);
              // email is always the verified account email. Country is required (sent on the booking);
              // gender/company/special-notes are the optional airport-form extras.
              name: name.trim() || profile?.fullName || user?.email || 'Guest',
              email: user?.email,
              phone: phone.trim() || profile?.phone || null,
              country: country || null,
              ...(isAirport || isHotelTransfer
                ? {
                    gender: gender.trim() || null,
                    company: company.trim() || null,
                    specialNotes: specialNotes.trim() || null,
                  }
                : {}),
            },
            source: 'web',
            idempotencyKey: idemKey,
          }),
        }).then((r) => parseApiJson<{ ref: string; totalEur?: number }>(r));
        if (!bookingRes.ok) throw new Error(bookingRes.error?.message ?? 'Could not create the booking.');
        ref = bookingRes.data.ref;
        setBookingRef(ref);
        // Persist the booking IDENTITY (idem key + ref + selection hash) so a Back/reload remount
        // rehydrates it — but ONLY when the selection still matches — and goes straight to this
        // booking's payment rather than creating a second one. This stash is deliberately NOT cleared
        // below — that is the whole point of the fix.
        try {
          if (occ)
            window.sessionStorage.setItem(`gytm:booking:${occ}`, JSON.stringify({ idemKey, bookingRef: ref, sel }));
        } catch {
          /* sessionStorage unavailable — the in-state ref still guards this mount */
        }
        // The route is now persisted on the booking — clear the route/hold/pickup stashes (slug from
        // Continue, occ from a cart line) so none attaches to a later checkout for this occurrence.
        // NOTE: gytm:booking:${occ} is intentionally NOT cleared here so a Back/reload can rehydrate it.
        try {
          if (slug) window.sessionStorage.removeItem(`gytm:itinerary:${slug}`);
          if (occ) {
            window.sessionStorage.removeItem(`gytm:itinerary:occ:${occ}`);
            window.sessionStorage.removeItem(`gytm:hold:${occ}`);
            window.sessionStorage.removeItem(`gytm:pickup:${occ}`);
            // The activity is now BOOKED — drop its on-hold cart line. Use remove (NOT removeHeld) so the
            // server hold, now consumed by the booking, is not released (that would free the paid seat).
            const cl = window.sessionStorage.getItem(`gytm:cartline:${occ}`);
            if (cl) {
              try {
                const line = JSON.parse(cl);
                if (line?.id) removeCartLine(line.id);
              } catch {
                /* malformed stash — nothing to remove */
              }
              window.sessionStorage.removeItem(`gytm:cartline:${occ}`);
            }
          }
        } catch {
          /* sessionStorage unavailable — nothing to clear */
        }
        // Reconcile the price the server actually computed against what we showed. If it moved
        // (a tier was edited since add-to-cart), surface the real amount and require a second
        // confirm before sending the customer to the hosted payment page.
        const srv = typeof bookingRes.data.totalEur === 'number' ? bookingRes.data.totalEur : null;
        if (reconcileOrWarn(srv)) return;
      } else {
        // Rehydrated-ref path (a Back/reload remount reused an existing booking). The selection-hash
        // gate already ensures this ref matches the CURRENT config — but the server total could still
        // have moved since the booking was created (a tier edited in admin), so re-run the SAME
        // price-reconciliation here too: fetch the booking's authoritative total and compare it to the
        // displayed total BEFORE charging. Never silently pay a mismatched amount on the rehydrated path.
        const bookingRes = await fetch(`/api/v1/bookings/${encodeURIComponent(ref)}`, { headers }).then((r) =>
          parseApiJson<{ totalEur?: number }>(r),
        );
        if (bookingRes.ok) {
          const srv = typeof bookingRes.data?.totalEur === 'number' ? bookingRes.data.totalEur : null;
          if (reconcileOrWarn(srv)) return;
        }
        // A failed GET (e.g. transient) is non-fatal: fall through to payment, where the server is the
        // final authority on the amount and refuses a non-payable booking.
      }

      const payRes = await fetch('/api/v1/payments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bookingRef: ref, idempotencyKey: `${idemKey}:pay` }),
      }).then((r) => parseApiJson<{ checkoutId?: string; redirectUrl?: string }>(r));
      if (!payRes.ok) {
        // The booking is already paid (or expired/cancelled) — the server refuses a second checkout
        // session for it. Clear the persisted ref so a Back/reload no longer rehydrates this dead
        // booking and the customer can start fresh, then surface a clear, actionable message.
        if (payRes.error?.code === 'booking_not_payable') {
          try {
            if (occ) window.sessionStorage.removeItem(`gytm:booking:${occ}`);
          } catch {
            /* sessionStorage unavailable — nothing to clear */
          }
          setBookingRef(null);
          setError(t('This booking is already paid or has expired — start a new booking.'));
          setBusy(false);
          return;
        }
        throw new Error(payRes.error?.message ?? 'Could not start payment.');
      }
      const link = payRes.data as { checkoutId?: string; redirectUrl?: string };
      if (link.checkoutId) {
        // Embedded Peach checkout: mount the widget on the pay step. The booking is confirmed by
        // the verified webhook, never by this navigation.
        window.location.href = `/bookings/${ref}/pay?cid=${encodeURIComponent(link.checkoutId)}`;
      } else if (link.redirectUrl) {
        // Hosted redirect (and the dev stub).
        window.location.href = link.redirectUrl;
      } else {
        throw new Error(t('Could not start payment.'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('Something went wrong.');
      setError(/capacity/i.test(msg) ? t('Sorry — this date just filled up. Please pick another date.') : msg);
      setBusy(false);
    }
  }

  // The pickup map + drop-off toggle + "I don't know yet" controls. Shared by the normal "Do you want
  // pickup?" radio (inside its Yes option) and the vehicle-tour layout (shown directly, with no
  // "make my own way" alternative — a private vehicle always collects the customer).
  const pickupFields = (
    <div className="mt-1">
      {!tbd && (
        <>
          <PickupDropoffMap
            pickupValue={pickupLoc}
            onPickupChange={setPickupLoc}
            onPickupCoords={setPickupCoords}
            showDropoff={!dropoffSame}
            dropoffValue={dropoffText}
            onDropoffChange={setDropoffText}
            onDropoffCoords={setDropoffCoords}
            pickupPlaceholder={t('Hotel name or address')}
            dropoffPlaceholder={t('Drop-off location')}
            pickupDescribedBy={!canAdvance ? PICKUP_HINT_ID : undefined}
          />
          {/* Toggle below the map — same point as the pickup by default. Unchecking reveals the
              drop-off input + a second pin on the SAME map above. */}
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
            <input
              type="checkbox"
              checked={dropoffSame}
              onChange={(e) => setDropoffSame(e.target.checked)}
              className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
            />
            {t('Drop-off — same as pickup')}
          </label>
        </>
      )}
      <label className="mt-3 flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
        <input
          type="checkbox"
          checked={tbd}
          onChange={(e) => setTbd(e.target.checked)}
          className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
        />
        {t('I don’t know yet')}
      </label>
      {tbd && (
        <span role="status" className="mt-2 block rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
          {t('Add your pickup location 24 hours before your activity (ideally sooner) so your provider can accommodate you.')}
        </span>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-3">
          <Logo tone="light" />
          <ol className="ml-auto flex items-center gap-3 text-[13px] font-bold sm:gap-7">
            {STEPS.map((s, i) => {
              const n = i + 1;
              const done = step > n;
              const active = step === n;
              return (
                <li key={s} aria-current={active ? 'step' : undefined} className="flex items-center gap-2">
                  <span
                    className={`grid h-6 w-6 place-items-center rounded-full text-[12px] ${
                      done ? 'bg-teal text-white' : active ? 'bg-ink text-white' : 'bg-ink/10 text-ink-muted'
                    }`}
                  >
                    {done ? '✓' : n}
                  </span>
                  <span className={`hidden sm:inline ${active || done ? 'text-ink' : 'text-ink-muted'}`}>{t(s)}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 pb-28 pt-8 lg:grid-cols-[1fr_340px] lg:pb-8">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-semibold text-coral-dark">
            <IconClock width={15} height={15} /> {t('We’ll hold your spot for {time} minutes.', { time: `${mm}:${ss}` })}
          </div>

          {step === 1 && (
            <section>
              {isAirport ? (
                <div>
                  <h1 className="font-display text-2xl font-semibold text-ink">{t('Your airport transfer')}</h1>
                  <p className="mt-2 text-sm text-ink-muted">
                    {t('Tell us your trip — we’ll meet you at SSR International Airport and take you door to door.')}
                  </p>

                  {/* ── Your trip ── */}
                  <h2 className="mt-6 text-[12px] font-bold uppercase tracking-wide text-ink-muted">{t('Your trip')}</h2>

                  {/* Trip direction */}
                  <fieldset className="mt-3">
                    <legend className="text-[13px] font-semibold text-ink">
                      {t('Trip type')} <span className="text-coral-dark">*</span>
                    </legend>
                    <div role="radiogroup" aria-label={t('Trip type')} className="mt-2 grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ['arrival', t('Arrival'), t('Airport → hotel')],
                          ['departure', t('Departure'), t('Hotel → airport')],
                          ['return', t('Return'), t('Both ways')],
                        ] as Array<['arrival' | 'departure' | 'return', string, string]>
                      ).map(([value, lbl, sub]) => (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={tripDirection === value}
                          onClick={() => setTripDirection(value)}
                          className={`rounded-xl border px-3 py-2.5 text-left transition ${
                            tripDirection === value
                              ? 'border-teal bg-teal/10'
                              : 'border-ink/15 hover:border-ink/30'
                          }`}
                        >
                          <span className="block text-[13.5px] font-bold text-ink">{lbl}</span>
                          <span className="block text-[11.5px] text-ink-muted">{sub}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  <div className="mt-4 grid gap-4 sm:max-w-md">
                    {/* Hotel / drop-off search */}
                    <div>
                      <label htmlFor="checkout-hotel-search" className="block text-[13px] font-semibold text-ink">
                        {t('Hotel / drop-off')} <span className="text-coral-dark">*</span>
                      </label>
                      {!hotelNotListed ? (
                        <>
                          <HotelSearch
                            value={hotelQuery}
                            selectedSlug={dropoffSlug}
                            onSelect={(tt) => {
                              setDropoffSlug(tt.slug);
                              setDropoffName(tt.hotelName);
                              setDropoffArea(tt.area);
                              setHotelQuery(tt.hotelName);
                            }}
                            onChange={(q) => {
                              setHotelQuery(q);
                              // Typing after a selection clears it until the customer re-picks.
                              if (dropoffSlug) {
                                setDropoffSlug('');
                                setDropoffName('');
                              }
                            }}
                            placeholder={t('Search your hotel or resort…')}
                            t={t}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setHotelNotListed(true);
                              setDropoffSlug('');
                            }}
                            className="mt-2 text-[12.5px] font-bold text-teal-dark hover:underline"
                          >
                            {t('My hotel isn’t listed')}
                          </button>
                        </>
                      ) : (
                        <div className="mt-1 grid gap-2">
                          <input
                            id="checkout-hotel-search"
                            value={dropoffName}
                            onChange={(e) => setDropoffName(e.target.value)}
                            placeholder={t('Hotel / Airbnb name')}
                            className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                          <input
                            value={dropoffArea}
                            onChange={(e) => setDropoffArea(e.target.value)}
                            aria-label={t('Area / village')}
                            placeholder={t('Area / village (e.g. Mahébourg, Grand Baie)')}
                            className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setHotelNotListed(false);
                              setDropoffArea('');
                            }}
                            className="text-left text-[12.5px] font-bold text-teal-dark hover:underline"
                          >
                            {t('Search the hotel list instead')}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Room / cabin number (optional) */}
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Room / cabin number')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={roomOrCabin}
                        onChange={(e) => setRoomOrCabin(e.target.value)}
                        placeholder={t('e.g. Room 214 or Cabin 8B')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>

                    {/* Arrival leg (arrival + return) */}
                    {tripDirection !== 'departure' && (
                      <div className="rounded-xl border border-ink/10 bg-teal/[0.04] p-3.5">
                        <p className="text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">{t('Arrival flight')}</p>
                        <label className="mt-2 block text-[13px] font-semibold text-ink">
                          {t('Arrival flight number')} <span className="text-coral-dark">*</span>
                          <input
                            value={flightNumber}
                            onChange={(e) => setFlightNumber(e.target.value)}
                            placeholder="MK015 / BA2065"
                            className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                        </label>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block text-[13px] font-semibold text-ink">
                            {t('Arrival date')} <span className="text-coral-dark">*</span>
                            <input
                              type="date"
                              value={arrivalDate}
                              onChange={(e) => setArrivalDate(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                            />
                          </label>
                          <label className="block text-[13px] font-semibold text-ink">
                            {t('Arrival time (local)')} <span className="text-coral-dark">*</span>
                            <input
                              type="time"
                              value={arrivalTime}
                              onChange={(e) => setArrivalTime(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                            />
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Departure leg (departure + return) */}
                    {tripDirection !== 'arrival' && (
                      <div className="rounded-xl border border-ink/10 bg-teal/[0.04] p-3.5">
                        <p className="text-[12.5px] font-bold uppercase tracking-wide text-ink-muted">{t('Departure')}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block text-[13px] font-semibold text-ink">
                            {t('Pickup date')} <span className="text-coral-dark">*</span>
                            <input
                              type="date"
                              value={departureDate}
                              onChange={(e) => setDepartureDate(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                            />
                          </label>
                          <label className="block text-[13px] font-semibold text-ink">
                            {t('Pickup time')} <span className="text-coral-dark">*</span>
                            <input
                              type="time"
                              value={returnTime}
                              onChange={(e) => setReturnTime(e.target.value)}
                              className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                            />
                          </label>
                        </div>
                        <label className="mt-2 block text-[13px] font-semibold text-ink">
                          {t('Departure flight number')} <span className="text-coral-dark">*</span>
                          <input
                            value={departureFlight}
                            onChange={(e) => setDepartureFlight(e.target.value)}
                            placeholder="MK014 / BA2066"
                            className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                        </label>
                      </div>
                    )}

                    {/* Luggage (optional) */}
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Luggage details')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={luggageDetails}
                        onChange={(e) => setLuggageDetails(e.target.value)}
                        placeholder={t('e.g. 3 large suitcases + a surfboard')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>

                    {/* Child seat (optional toggle + age) */}
                    <div>
                      <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink">
                        <input
                          type="checkbox"
                          checked={childSeatWanted}
                          onChange={(e) => setChildSeatWanted(e.target.checked)}
                          className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
                        />
                        {t('I need a child seat')}
                      </label>
                      {childSeatWanted && (
                        <label className="mt-2 block text-[13px] font-semibold text-ink">
                          {t('Child’s age')}
                          <input
                            type="number"
                            min={0}
                            max={17}
                            value={childSeatAge}
                            onChange={(e) => setChildSeatAge(e.target.value)}
                            placeholder={t('e.g. 3')}
                            className="mt-1 w-28 rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                </div>
              ) : isHotelTransfer ? (
                <div>
                  <h1 className="font-display text-2xl font-semibold text-ink">{t('Your private transfer')}</h1>
                  <p className="mt-2 text-sm text-ink-muted">
                    {t('We’ll collect you and take you door to door. Confirm the details below.')}
                  </p>

                  {/* Chosen route (from the quote console) */}
                  <div className="mt-5 rounded-xl border border-ink/10 bg-teal/[0.04] p-4 sm:max-w-md">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-bold text-ink">
                      <IconPin width={16} height={16} className="shrink-0 text-coral" />
                      <span className="min-w-0">{pickupParam || t('Pickup')}</span>
                      <span aria-hidden="true" className="text-ink/40">→</span>
                      <span className="min-w-0">{dropoffParam || t('Drop-off')}</span>
                    </div>
                    <p className="mt-1.5 text-[12.5px] text-ink-muted">
                      {tripTypeParam === 'return' ? t('Return transfer') : t('One-way transfer')} · {guests}{' '}
                      {Number(guests) === 1 ? t('guest') : t('guests')}
                    </p>
                  </div>

                  <div className="mt-4 grid gap-4 sm:max-w-md">
                    {/* Pickup date + time */}
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-[13px] font-semibold text-ink">
                        {t('Pickup date')} <span className="text-coral-dark">*</span>
                        <input
                          type="date"
                          value={arrivalDate}
                          onChange={(e) => setArrivalDate(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                        />
                      </label>
                      <label className="block text-[13px] font-semibold text-ink">
                        {t('Pickup time')}
                        <input
                          type="time"
                          value={arrivalTime}
                          onChange={(e) => setArrivalTime(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                        />
                      </label>
                    </div>

                    {/* Return leg */}
                    {tripTypeParam === 'return' && (
                      <div className="grid grid-cols-2 gap-2 rounded-xl border border-ink/10 bg-teal/[0.04] p-3.5">
                        <label className="block text-[13px] font-semibold text-ink">
                          {t('Return date')} <span className="text-coral-dark">*</span>
                          <input
                            type="date"
                            value={departureDate}
                            onChange={(e) => setDepartureDate(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                        </label>
                        <label className="block text-[13px] font-semibold text-ink">
                          {t('Return time')}
                          <input
                            type="time"
                            value={returnTime}
                            onChange={(e) => setReturnTime(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-ink/15 px-3 py-2.5 text-sm font-normal outline-none focus:border-teal"
                          />
                        </label>
                      </div>
                    )}

                    {/* Room / cabin (optional) */}
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Room / cabin number')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={roomOrCabin}
                        onChange={(e) => setRoomOrCabin(e.target.value)}
                        placeholder={t('e.g. Room 214 or Cabin 8B')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>

                    {/* Luggage (optional) */}
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Luggage details')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={luggageDetails}
                        onChange={(e) => setLuggageDetails(e.target.value)}
                        placeholder={t('e.g. 3 large suitcases + a surfboard')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>

                    {/* Special notes (optional) */}
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Anything else?')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={specialNotes}
                        onChange={(e) => setSpecialNotes(e.target.value)}
                        placeholder={t('e.g. travelling with a wheelchair')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>
                  </div>
                </div>
              ) : isVehicleTour ? (
              <>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Where should we pick you up?')}</h1>
              <p className="mt-2 text-sm text-ink-muted">
                {t('Your private vehicle collects you and brings you back at the end — just tell us where.')}
              </p>
              <div className="mt-5">{pickupFields}</div>
              </>
              ) : (
              <>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Do you want pickup?')}</h1>
              <div role="radiogroup" aria-label={t('Do you want pickup?')} className="mt-5 flex flex-col gap-2">
                <PickRadio
                  checked={wantsPickup}
                  onClick={() => setWantsPickup(true)}
                  title={t('Yes, pick me up')}
                >
                  {wantsPickup && pickupFields}
                </PickRadio>
                <PickRadio
                  checked={!wantsPickup}
                  onClick={() => setWantsPickup(false)}
                  title={t('No, I’ll make my own way')}
                >
                  {!wantsPickup && (
                    <span className="mt-2 block rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
                      {t('Meet at {location}', { location: title })}
                    </span>
                  )}
                </PickRadio>
              </div>
              </>
              )}
              <button
                type="button"
                onClick={continueFromTransport}
                disabled={busy || !canAdvance}
                aria-busy={busy}
                className="mt-6 hidden items-center justify-center rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85 lg:flex"
              >
                {busy ? <Spinner label={t('Loading')} /> : t('Next: Personal details')}
              </button>
              {/* Stable, always-rendered live region: the pickup input's aria-describedby points here,
                  and the hint is announced when it appears (it explains why Next is disabled). */}
              <p id={PICKUP_HINT_ID} aria-live="polite" className="mt-2 text-[12.5px] text-ink-muted lg:text-[13px]">
                {!canAdvance
                  ? isAirport
                    ? !hotelChosen
                      ? t('Choose your hotel (or pick “My hotel isn’t listed”).')
                      : t('Add the flight number, date and time for your trip.')
                    : t('Add your pickup address, or choose “I don’t know yet”.')
                  : ''}
              </p>
            </section>
          )}

          {step === 2 && !session && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">
                {t('Where should we send your booking confirmation?')}
              </h1>
              <p className="mt-2 text-sm text-ink-muted">
                {t('Sign in or create an account — by email, Google, Apple or Facebook — to continue.')}
              </p>
              <button
                type="button"
                onClick={() => openAuth('signin')}
                className="mt-5 hidden rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 lg:inline-flex"
              >
                {t('Sign in / Create account')}
              </button>
            </section>
          )}

          {step === 2 && session && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Your details')}</h1>
              <div className="mt-5 grid gap-4 sm:max-w-md">
                <label className="block text-[13px] font-semibold text-ink">
                  {t('Full name')}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    placeholder={t('Your name')}
                    className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
                <label className="block text-[13px] font-semibold text-ink">
                  {t('Email address')}
                  <input
                    value={user?.email ?? ''}
                    readOnly
                    autoComplete="email"
                    // Explain to a screen-reader user why this field is read-only.
                    aria-describedby="checkout-email-hint"
                    className="mt-1 w-full cursor-not-allowed rounded-xl border border-ink/15 bg-ink/[0.03] px-3.5 py-2.5 text-sm font-normal text-ink-muted outline-none"
                  />
                  <span id="checkout-email-hint" className="sr-only">
                    {t('This is your account email.')}
                  </span>
                </label>
                <label className="block text-[13px] font-semibold text-ink">
                  {t('Country')}
                  <select
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    autoComplete="country-name"
                    className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[13px] font-semibold text-ink">
                  {t('Mobile phone number')}
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    type="tel"
                    autoComplete="tel"
                    placeholder="+230 5xxx xxxx"
                    // When a phone is required but missing, point at the gate hint so a screen-reader
                    // user hears WHY "Go to payment" is disabled.
                    aria-describedby={!canAdvanceDetails ? PHONE_HINT_ID : undefined}
                    aria-invalid={!canAdvanceDetails}
                    className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
                {isAirport && (
                  <>
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Gender')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <select
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      >
                        <option value="">{t('Prefer not to say')}</option>
                        <option value="female">{t('Female')}</option>
                        <option value="male">{t('Male')}</option>
                        <option value="other">{t('Other')}</option>
                      </select>
                    </label>
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Company')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <input
                        value={company}
                        onChange={(e) => setCompany(e.target.value)}
                        autoComplete="organization"
                        placeholder={t('For a company invoice')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>
                    <label className="block text-[13px] font-semibold text-ink">
                      {t('Special notes / requests')} <span className="font-normal text-ink-muted">({t('optional')})</span>
                      <textarea
                        value={specialNotes}
                        onChange={(e) => setSpecialNotes(e.target.value)}
                        rows={3}
                        placeholder={t('Anything your driver should know')}
                        className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                      />
                    </label>
                  </>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink/80">
                <span className="flex items-center gap-1.5">
                  <IconCheck width={15} height={15} className="text-teal" /> {t('Instant confirmation')}
                </span>
                <span className="flex items-center gap-1.5">
                  <IconCheck width={15} height={15} className="text-teal" /> {t('Free cancellation up to 24 hours before')}
                </span>
              </div>

              <button
                type="button"
                onClick={continueFromDetails}
                disabled={!canAdvanceDetails}
                className="mt-6 hidden items-center justify-center rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85 lg:flex"
              >
                {t('Go to payment')}
              </button>
              {/* Stable, always-rendered live region: the phone input's aria-describedby points here,
                  and the hint is announced when it appears (it explains why "Go to payment" is disabled). */}
              <p id={PHONE_HINT_ID} aria-live="polite" className="mt-2 text-[12.5px] text-ink-muted lg:text-[13px]">
                {!canAdvanceDetails ? t('Add a phone number so your driver can reach you.') : ''}
              </p>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Review & pay')}</h1>
              <p className="mt-2 text-sm text-ink-muted">{t('Signed in as {email}.', { email: user?.email ?? '' })}</p>
              {error && (
                <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
                  {error}
                </p>
              )}
              {/* Announce the multi-second create→reconcile→pay round-trip — the CTA only shows a
                  silent spinner, so a screen-reader user otherwise gets no feedback that Pay worked. */}
              <p role="status" aria-live="polite" className="sr-only">
                {busy ? t('Starting payment…') : ''}
              </p>
              <button
                type="button"
                onClick={pay}
                disabled={busy || expired}
                aria-busy={busy}
                className="mt-5 hidden items-center justify-center rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85 lg:flex"
              >
                {busy ? (
                  <Spinner label={t('Loading')} />
                ) : displayTotalNum != null ? (
                  <span>
                    {t('Pay')} <Price eur={displayTotalNum} />
                  </span>
                ) : (
                  t('Continue to payment')
                )}
              </button>
              {displayTotalNum != null && (
                <p className="mt-2 text-[12px] text-ink-muted">{t('You will be charged in EUR')}</p>
              )}
              <p className="mt-2 text-[12px] text-ink-muted">
                {t('You’ll confirm the payment on the next screen.')}
              </p>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)]">
          <h2 className="font-display text-lg font-semibold text-ink">{t('Order summary')}</h2>
          <p className="mt-3 font-bold text-ink">{title}</p>
          <dl className="mt-3 flex flex-col gap-2 text-[13px] text-ink/80">
            <div className="flex items-center gap-2">
              <IconCalendar width={15} height={15} className="text-teal" /> {when || '—'}
            </div>
            <div className="flex items-center gap-2">
              <IconUsers width={15} height={15} className="text-teal" /> {guests} {Number(guests) === 1 ? t('guest') : t('guests')}
              {unit ? ` · ${unit}` : ''}
            </div>
            {!isAirport && !isHotelTransfer && (
              <div className="flex items-center gap-2">
                <IconGlobe width={15} height={15} className="text-teal" /> {lang}
              </div>
            )}
            {isAirport && (
              <>
                <div className="flex items-center gap-2">
                  <IconPin width={15} height={15} className="text-teal" />{' '}
                  {tripDirection === 'departure'
                    ? t('{hotel} → SSR Airport', { hotel: dropoffName || dropoffParam || t('your hotel') })
                    : t('SSR Airport → {hotel}', { hotel: dropoffName || dropoffParam || t('your hotel') })}
                </div>
                <div className="flex items-center gap-2">
                  <IconCheck width={15} height={15} className="text-teal" />{' '}
                  {tripDirection === 'return'
                    ? t('Return transfer')
                    : tripDirection === 'departure'
                      ? t('Departure transfer')
                      : t('Arrival transfer')}
                </div>
              </>
            )}
            {isHotelTransfer && (
              <>
                <div className="flex items-center gap-2">
                  <IconPin width={15} height={15} className="text-teal" />{' '}
                  {t('{from} → {to}', { from: pickupParam || t('Pickup'), to: dropoffParam || t('Drop-off') })}
                </div>
                <div className="flex items-center gap-2">
                  <IconCheck width={15} height={15} className="text-teal" />{' '}
                  {tripTypeParam === 'return' ? t('Return transfer') : t('One-way transfer')}
                </div>
              </>
            )}
            {childSeats > 0 && (
              <div className="flex items-center gap-2">
                <IconCheck width={15} height={15} className="text-teal" />
                {childSeats} {t('baby/child')} {childSeats === 1 ? t('seat') : t('seats')}
                {childSeatsCost(childSeats) > 0
                  ? ` · ${t('first free, {price} extra', { price: money(childSeatsCost(childSeats)) })}`
                  : ` · ${t('free')}`}
              </div>
            )}
            {liveTransport > 0 && (
              <div className="flex items-center gap-2">
                <IconCheck width={15} height={15} className="text-teal" />
                {pickupRegion
                  ? t('Door-to-door transport (from {region})', { region: pickupRegion })
                  : t('Door-to-door transport')}{' '}
                · {money(liveTransport)}
              </div>
            )}
          </dl>
          <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3">
            <span className="font-bold text-ink">{t('Total')}</span>
            <span className="text-lg font-extrabold text-ink">
              {displayTotalNum != null ? <Price eur={displayTotalNum} /> : '—'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink/80">
            <IconCheck width={15} height={15} className="text-teal" /> {t('Free cancellation up to 24 hours before')}
          </div>
        </aside>
      </main>

      {/* Mobile sticky primary action — mirrors the current step's CTA. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-16px_rgba(10,46,54,0.45)] lg:hidden">
        {step === 1 && (
          <button
            type="button"
            onClick={continueFromTransport}
            disabled={busy || !canAdvance}
            aria-busy={busy}
            className="flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
          >
            {busy ? <Spinner label={t('Loading')} /> : t('Next: Personal details')}
          </button>
        )}
        {step === 2 && !session && (
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark/90"
          >
            {t('Sign in / Create account')}
          </button>
        )}
        {step === 2 && session && (
          <button
            type="button"
            onClick={continueFromDetails}
            disabled={!canAdvanceDetails}
            className="flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
          >
            {t('Go to payment')}
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={pay}
            disabled={busy || expired}
            aria-busy={busy}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {busy ? (
              <Spinner label={t('Loading')} />
            ) : displayTotalNum != null ? (
              <span>
                {t('Pay')} <Price eur={displayTotalNum} />
              </span>
            ) : (
              t('Continue to payment')
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function PickRadio({
  checked,
  onClick,
  title,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={checked}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        // preventDefault BEFORE activating so Space picks the radio instead of scrolling the page.
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`cursor-pointer rounded-xl border px-4 py-3 ${
        checked ? 'border-teal bg-teal/5' : 'border-ink/15 hover:border-ink/30'
      }`}
    >
      <span className="flex items-center gap-2.5 text-sm font-semibold text-ink">
        <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${checked ? 'border-teal' : 'border-ink/30'}`}>
          {checked && <span className="h-2.5 w-2.5 rounded-full bg-teal" />}
        </span>
        {title}
      </span>
      {children}
    </div>
  );
}

/**
 * Typeahead over the transfer-hotel list, reused at checkout so the traveller confirms the EXACT hotel
 * (which sets the priced zone the server re-derives). Selecting a hotel calls onSelect with the full
 * Transfer; typing calls onChange (the parent clears any prior selection). A green tick shows when a
 * hotel is locked in. Mirrors TransferSearch's logic but emits the selection instead of navigating.
 */
function HotelSearch({
  value,
  selectedSlug,
  onSelect,
  onChange,
  placeholder,
  t,
}: {
  value: string;
  selectedSlug: string;
  onSelect: (t: Transfer) => void;
  onChange: (q: string) => void;
  placeholder: string;
  t: (s: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo<Transfer[]>(() => {
    const s = value.trim().toLowerCase();
    if (!s) return [];
    return transfers
      .filter((tt) => tt.hotelName.toLowerCase().includes(s) || tt.area.toLowerCase().includes(s))
      .slice(0, 8);
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = matches[active] ?? matches[0];
      if (pick) {
        onSelect(pick);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative mt-1">
      <div className="flex items-center gap-2 rounded-xl border border-ink/15 px-3.5 py-2.5 focus-within:border-teal">
        {selectedSlug ? (
          <IconCheck width={16} height={16} className="shrink-0 text-teal" />
        ) : (
          <IconSearch width={16} height={16} className="shrink-0 text-ink-muted" />
        )}
        <input
          id="checkout-hotel-search"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="checkout-hotel-list"
          aria-autocomplete="list"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
          className="w-full bg-transparent text-sm font-normal text-ink outline-none"
        />
      </div>
      {open && value.trim() !== '' && matches.length > 0 && (
        <ul
          id="checkout-hotel-list"
          role="listbox"
          className="absolute z-20 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-ink/10 bg-white py-1 shadow-xl"
        >
          {matches.map((tt, i) => (
            <li key={tt.slug} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onSelect(tt);
                  setOpen(false);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm ${
                  i === active ? 'bg-teal/10' : 'hover:bg-ink/[0.03]'
                }`}
              >
                <IconPin width={14} height={14} className="shrink-0 text-coral" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{tt.hotelName}</span>
                  <span className="block text-[12px] text-ink-muted">{tt.area}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && value.trim() !== '' && matches.length === 0 && (
        <p className="absolute z-20 mt-1.5 w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-[12.5px] text-ink-muted shadow-xl">
          {t('No match — choose “My hotel isn’t listed”.')}
        </p>
      )}
    </div>
  );
}
