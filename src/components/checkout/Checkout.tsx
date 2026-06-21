'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Logo } from '@/components/site/Logo';
import { Price } from '@/components/site/Price';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { PickupDropoffMap } from '@/components/maps/PickupDropoffMap';
import { childSeatsCost, regionFromCoords, transportFare } from '@/lib/services/pricing';
import type { TransportBands, RegionDistances } from '@/lib/validation/tours';
import { canAdvanceStep1 } from '@/lib/checkout/pickup';
import { resolveIdemKey } from '@/lib/checkout/idempotency';
import { selectionHash, shouldRehydrateBooking } from '@/lib/checkout/selection';
import { useCart } from '@/lib/cart/useCart';
import { IconCalendar, IconCheck, IconClock, IconGlobe, IconUsers } from '@/components/ui/icons';

const STEPS = ['Trip & pickup', 'Contact', 'Payment'];

// A short list of common visitor nationalities for the personal-details step. Mauritius is first
// (the home market), then the largest source markets. Display/validation only — the booking schema
// has no country field, so this isn't sent to the server; it just personalises the form. Real-world
// country names are proper nouns and are not translated.
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

function Spinner() {
  return <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />;
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
  const qty = Math.max(1, Number(params.get('qty') ?? '1'));
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
      .then((r) => r.json())
      .then((body) => {
        if (!active || !body.ok) return;
        const a = body.data;
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
        <Link href={slug ? `/activities/${slug}` : '/activities'} className="mt-3 inline-block text-sm font-bold text-teal">
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
  // Step ① can advance unless pickup is wanted with no address and not "I don't know yet".
  const canAdvance = canAdvanceStep1({ wantsPickup, address: pickupLoc, tbd });
  // Step ② (personal details): a phone is REQUIRED when the booking has a pickup — TBD still counts
  // as a pickup, since the driver needs to reach the customer to arrange it. No pickup → optional.
  const phoneRequired = wantsPickup;
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
            party: { [label]: qty },
            suv,
            childSeats,
            holdId: holdId || undefined,
            itinerary: readItinerary(),
            // Pickup + drop-off are DISTINCT fields on the booking — never concatenated. A fixed
            // pickup address sends its text (+ coords); the drop-off sends its own text. "I don't
            // know yet" (tbd) sends no address/coords but flags pickupPending so admin sees a
            // pending pickup. "No pickup" sends all null/false. Clamped to 200 to match the schema.
            pickupLocation: wantsPickup && !tbd && pickupLoc.trim() ? pickupLoc.trim().slice(0, 200) : null,
            // A distinct drop-off is sent ONLY when the "same as pickup" toggle is off; "same" sends
            // null (the driver returns the customer to the pickup point). dropoffCoords is UX-only —
            // it has no DB column, so it's never sent here.
            dropoffLocation:
              wantsPickup && !tbd && !dropoffSame && dropoffText.trim()
                ? dropoffText.trim().slice(0, 200)
                : null,
            pickupPending: wantsPickup && tbd,
            // Pickup coordinates → the server re-derives the region and adds the transport fare (only
            // for per_person/per_group activities with pickup; ignored otherwise). Never a client price.
            // A TBD pickup sends no coords → no transport fee, per the spec.
            pickupLat: wantsPickup && !tbd && pickupCoords ? pickupCoords.lat : null,
            pickupLng: wantsPickup && !tbd && pickupCoords ? pickupCoords.lng : null,
            customer: {
              // Name + phone come from the step-② details form (falling back to the profile);
              // email is always the verified account email. Country is captured for UX only — the
              // booking schema has no country field, so it isn't sent.
              name: name.trim() || profile?.fullName || user?.email || 'Guest',
              email: user?.email,
              phone: phone.trim() || profile?.phone || null,
            },
            source: 'web',
            idempotencyKey: idemKey,
          }),
        }).then((r) => r.json());
        if (!bookingRes.ok) throw new Error(bookingRes.error?.message ?? 'Could not create the booking.');
        ref = bookingRes.data.ref as string;
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
          r.json(),
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
      }).then((r) => r.json());
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
                <li key={s} className="flex items-center gap-2">
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
          <div className="mb-5 inline-flex items-center gap-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-semibold text-coral">
            <IconClock width={15} height={15} /> {t('We’ll hold your spot for {time} minutes.', { time: `${mm}:${ss}` })}
          </div>

          {step === 1 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Do you want pickup?')}</h1>
              <div className="mt-5 flex flex-col gap-2">
                <PickRadio
                  checked={wantsPickup}
                  onClick={() => setWantsPickup(true)}
                  title={t('Yes, pick me up')}
                >
                  {wantsPickup && (
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
                          />
                          {/* Toggle below the map — same point as the pickup by default. Unchecking
                              reveals the drop-off input + a second pin on the SAME map above. */}
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
                        <span className="mt-2 block rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
                          {t('Add your pickup location 24 hours before your activity (ideally sooner) so your provider can accommodate you.')}
                        </span>
                      )}
                    </div>
                  )}
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
              <button
                type="button"
                onClick={continueFromTransport}
                disabled={busy || !canAdvance}
                className="mt-6 hidden items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80 lg:flex"
              >
                {busy ? <Spinner /> : t('Next: Personal details')}
              </button>
              {!canAdvance && (
                <p className="mt-2 text-[12.5px] text-ink-muted lg:text-[13px]">
                  {t('Add your pickup address, or choose “I don’t know yet”.')}
                </p>
              )}
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
                className="mt-5 hidden rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark lg:inline-flex"
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
                    className="mt-1 w-full cursor-not-allowed rounded-xl border border-ink/15 bg-ink/[0.03] px-3.5 py-2.5 text-sm font-normal text-ink-muted outline-none"
                  />
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
                    className="mt-1 w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-ink/80">
                <span className="flex items-center gap-1.5">
                  <IconCheck width={15} height={15} className="text-teal" /> {t('Pay nothing today')}
                </span>
                <span className="flex items-center gap-1.5">
                  <IconCheck width={15} height={15} className="text-teal" /> {t('Free cancellation up to 24 hours before')}
                </span>
              </div>

              <button
                type="button"
                onClick={continueFromDetails}
                disabled={!canAdvanceDetails}
                className="mt-6 hidden items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80 lg:flex"
              >
                {t('Go to payment')}
              </button>
              {!canAdvanceDetails && (
                <p className="mt-2 text-[12.5px] text-ink-muted lg:text-[13px]">
                  {t('Add a phone number so your driver can reach you.')}
                </p>
              )}
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">{t('Review & pay')}</h1>
              <p className="mt-2 text-sm text-ink-muted">{t('Signed in as {email}.', { email: user?.email ?? '' })}</p>
              {error && (
                <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={pay}
                disabled={busy || expired}
                className="mt-5 hidden items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80 lg:flex"
              >
                {busy ? (
                  <Spinner />
                ) : displayTotalNum != null ? (
                  <span>
                    {t('Pay')} <Price eur={displayTotalNum} />
                  </span>
                ) : (
                  t('Continue to payment')
                )}
              </button>
              {displayTotalNum != null && (
                <p className="mt-2 text-[12px] text-ink-muted">{t('Your card will be charged in USD')}</p>
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
            <div className="flex items-center gap-2">
              <IconGlobe width={15} height={15} className="text-teal" /> {lang}
            </div>
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
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {busy ? <Spinner /> : t('Next: Personal details')}
          </button>
        )}
        {step === 2 && !session && (
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark"
          >
            {t('Sign in / Create account')}
          </button>
        )}
        {step === 2 && session && (
          <button
            type="button"
            onClick={continueFromDetails}
            disabled={!canAdvanceDetails}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {t('Go to payment')}
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={pay}
            disabled={busy || expired}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {busy ? (
              <Spinner />
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
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
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
