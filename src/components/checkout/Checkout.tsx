'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { Logo } from '@/components/site/Logo';
import { PickupMap } from '@/components/maps/PickupMap';
import { childSeatsCost } from '@/lib/services/pricing';
import { IconCalendar, IconCheck, IconClock, IconGlobe, IconUsers } from '@/components/ui/icons';

const STEPS = ['Transport', 'Contact', 'Payment'];

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
  // Child seats chosen (first free, €6 each extra). The server recomputes the charge from this count.
  const childSeats = Math.max(0, Math.min(25, parseInt(params.get('childSeats') ?? '0', 10) || 0));
  // Continue ("Book now", from=widget) carries a custom route stashed by slug; a cart line carries its
  // OWN route, staged by occurrence (from=cart). Either may be present; neither inherits the other's.
  const fromWidget = params.get('from') === 'widget';
  const fromCart = params.get('from') === 'cart';
  // The hold reserved on Continue (reused at pay so the spot isn't double-held) + its real expiry +
  // the shared idempotency key — handed over via sessionStorage (NOT the URL, which would leak them).
  function readHold(): { holdId: string; expiresAt: string; idem: string } {
    if (typeof window === 'undefined' || !occ) return { holdId: '', expiresAt: '', idem: '' };
    try {
      const raw = window.sessionStorage.getItem(`gytm:hold:${occ}`);
      const h = raw ? JSON.parse(raw) : null;
      return { holdId: h?.holdId || '', expiresAt: h?.expiresAt || '', idem: h?.idem || '' };
    } catch {
      return { holdId: '', expiresAt: '', idem: '' };
    }
  }
  const { holdId, expiresAt, idem: idemParam } = readHold();
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

  const [step, setStep] = useState(1);
  const [pickup, setPickup] = useState<'known' | 'unknown' | null>(null);
  const [pickupLoc, setPickupLoc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secs, setSecs] = useState(() => {
    if (expiresAt) {
      const s = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      return s > 0 ? s : 0;
    }
    return 30 * 60;
  });
  // Stable idempotency key + booking ref so a retry reuses the same booking/payment instead of
  // creating an orphaned, seat-holding duplicate. Reuse the key from Continue so the hold → booking
  // chain shares one key.
  const [idemKey] = useState(() => idemParam || crypto.randomUUID());
  const [bookingRef, setBookingRef] = useState<string | null>(null);
  // Authoritative price from the created booking — what the customer is actually charged.
  const [serverTotal, setServerTotal] = useState<number | null>(null);
  const displayTotal = serverTotal != null ? serverTotal.toFixed(2) : total;

  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Signing in on the Contact step advances to Payment. Gate on `session` (not just
  // `user`) so we don't advance before the access token the payment step needs is ready.
  useEffect(() => {
    if (step === 2 && session) setStep(3);
  }, [step, session]);

  if (!occ || !slug) {
    return (
      <div className="py-20 text-center">
        <p className="text-sm text-ink-muted">Your selection expired — please choose your date again.</p>
        <Link href={slug ? `/activities/${slug}` : '/activities'} className="mt-3 inline-block text-sm font-bold text-teal">
          Back to the activity
        </Link>
      </div>
    );
  }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');

  function continueFromTransport() {
    setBusy(true);
    setError(null);
    window.setTimeout(() => {
      setBusy(false);
      setStep(session ? 3 : 2);
    }, 700);
  }

  async function pay() {
    if (!session) return openAuth('signin');
    setBusy(true);
    setError(null);
    try {
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${session.access_token}` };
      // Create the booking once (idempotent + remembered); a retry reuses it.
      let ref = bookingRef;
      if (!ref) {
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
            // The pickup address the customer entered on the transport step (null when they chose
            // "I don't know yet"). Persisted on the booking so the provider actually receives it.
            pickupLocation: pickup === 'known' && pickupLoc.trim() ? pickupLoc.trim() : null,
            customer: {
              name: profile?.fullName || user?.email || 'Guest',
              email: user?.email,
              phone: profile?.phone || null,
            },
            source: 'web',
            idempotencyKey: idemKey,
          }),
        }).then((r) => r.json());
        if (!bookingRes.ok) throw new Error(bookingRes.error?.message ?? 'Could not create the booking.');
        ref = bookingRes.data.ref as string;
        setBookingRef(ref);
        // The route is now persisted on the booking — clear both stashes (slug from Continue, occ from
        // a cart line) so neither attaches to a later booking.
        try {
          if (slug) window.sessionStorage.removeItem(`gytm:itinerary:${slug}`);
          if (occ) window.sessionStorage.removeItem(`gytm:itinerary:occ:${occ}`);
        } catch {
          /* sessionStorage unavailable — nothing to clear */
        }
        // Reconcile the price the server actually computed against what we showed. If it moved
        // (a tier was edited since add-to-cart), surface the real amount and require a second
        // confirm before sending the customer to the hosted payment page.
        const srv = typeof bookingRes.data.totalEur === 'number' ? bookingRes.data.totalEur : null;
        if (srv != null) setServerTotal(srv);
        if (srv != null && total && Math.abs(srv - Number(total)) >= 0.005) {
          setError(`The price for this date is €${srv.toFixed(2)}. Tap Pay again to continue.`);
          setBusy(false);
          return;
        }
      }

      const payRes = await fetch('/api/v1/payments', {
        method: 'POST',
        headers,
        body: JSON.stringify({ bookingRef: ref, idempotencyKey: `${idemKey}:pay` }),
      }).then((r) => r.json());
      if (!payRes.ok) throw new Error(payRes.error?.message ?? 'Could not start payment.');
      window.location.href = payRes.data.redirectUrl as string;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setError(/capacity/i.test(msg) ? 'Sorry — this date just filled up. Please pick another date.' : msg);
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
                  <span className={`hidden sm:inline ${active || done ? 'text-ink' : 'text-ink-muted'}`}>{s}</span>
                </li>
              );
            })}
          </ol>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-8 px-6 pb-28 pt-8 lg:grid-cols-[1fr_340px] lg:pb-8">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-semibold text-coral">
            <IconClock width={15} height={15} /> We&apos;ll hold your spot for {mm}:{ss} minutes.
          </div>

          {step === 1 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">
                Do you know where you want to be picked up?
              </h1>
              <div className="mt-5 flex flex-col gap-2">
                <PickRadio checked={pickup === 'known'} onClick={() => setPickup('known')} title="Yes, I can add it now">
                  {pickup === 'known' && <PickupMap value={pickupLoc} onChange={setPickupLoc} />}
                </PickRadio>
                <PickRadio checked={pickup === 'unknown'} onClick={() => setPickup('unknown')} title="I don't know yet">
                  {pickup === 'unknown' && (
                    <span className="mt-2 block rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
                      Add your pickup location 24 hours before your activity (ideally sooner) so your provider can
                      accommodate you.
                    </span>
                  )}
                </PickRadio>
              </div>
              <button
                type="button"
                onClick={continueFromTransport}
                disabled={busy}
                className="mt-6 hidden items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80 lg:flex"
              >
                {busy ? <Spinner /> : 'Next: Personal details'}
              </button>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">
                Where should we send your booking confirmation?
              </h1>
              <p className="mt-2 text-sm text-ink-muted">
                Sign in or create an account — by email, Google, Apple or Facebook — to continue.
              </p>
              <button
                type="button"
                onClick={() => openAuth('signin')}
                className="mt-5 hidden rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark lg:inline-flex"
              >
                Sign in / Create account
              </button>
            </section>
          )}

          {step === 3 && (
            <section>
              <h1 className="font-display text-2xl font-semibold text-ink">Review &amp; pay</h1>
              <p className="mt-2 text-sm text-ink-muted">Signed in as {user?.email}.</p>
              {error && (
                <p role="alert" className="mt-3 text-[13px] font-medium text-coral">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={pay}
                disabled={busy}
                className="mt-5 hidden items-center justify-center rounded-full bg-teal px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80 lg:flex"
              >
                {busy ? <Spinner /> : displayTotal ? `Pay €${displayTotal}` : 'Continue to payment'}
              </button>
              <p className="mt-2 text-[12px] text-ink-muted">
                You&apos;ll confirm the payment on the next screen.
              </p>
            </section>
          )}
        </div>

        <aside className="h-fit rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.45)]">
          <h2 className="font-display text-lg font-semibold text-ink">Order summary</h2>
          <p className="mt-3 font-bold text-ink">{title}</p>
          <dl className="mt-3 flex flex-col gap-2 text-[13px] text-ink/80">
            <div className="flex items-center gap-2">
              <IconCalendar width={15} height={15} className="text-teal" /> {when || '—'}
            </div>
            <div className="flex items-center gap-2">
              <IconUsers width={15} height={15} className="text-teal" /> {guests} {Number(guests) === 1 ? 'guest' : 'guests'}
              {unit ? ` · ${unit}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <IconGlobe width={15} height={15} className="text-teal" /> {lang}
            </div>
            {childSeats > 0 && (
              <div className="flex items-center gap-2">
                <IconCheck width={15} height={15} className="text-teal" />
                {childSeats} baby/child {childSeats === 1 ? 'seat' : 'seats'}
                {childSeatsCost(childSeats) > 0
                  ? ` · first free, €${childSeatsCost(childSeats)} extra`
                  : ' · free'}
              </div>
            )}
          </dl>
          <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3">
            <span className="font-bold text-ink">Total</span>
            <span className="text-lg font-extrabold text-ink">{displayTotal ? `€${displayTotal}` : '—'}</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink/80">
            <IconCheck width={15} height={15} className="text-teal" /> Free cancellation up to 24 hours before
          </div>
        </aside>
      </main>

      {/* Mobile sticky primary action — mirrors the current step's CTA. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-16px_rgba(10,46,54,0.45)] lg:hidden">
        {step === 1 && (
          <button
            type="button"
            onClick={continueFromTransport}
            disabled={busy}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {busy ? <Spinner /> : 'Next: Personal details'}
          </button>
        )}
        {step === 2 && (
          <button
            type="button"
            onClick={() => openAuth('signin')}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark"
          >
            Sign in / Create account
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            onClick={pay}
            disabled={busy}
            className="flex w-full items-center justify-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-80"
          >
            {busy ? <Spinner /> : displayTotal ? `Pay €${displayTotal}` : 'Continue to payment'}
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
