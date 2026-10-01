'use client';

import { Suspense, useEffect, useState, useSyncExternalStore } from 'react';
import { BookingConfirmation } from '@/components/gyg/detail/BookingConfirmation';
import { BookingGallery } from '@/components/booking/BookingGallery';
import {
  BOOKING_DETAILS_ID,
  bookingCardHidden,
  type GalleryPhase,
} from '@/lib/booking/booking-view';

/** A guest who opened the gallery link waits this long for it before the card is shown after all. */
const GALLERY_GRACE_MS = 2500;

// The URL fragment is not reactive in Next (usePathname / useSearchParams leave it out), so subscribe.
const subscribeToHash = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};
const readHash = () => window.location.hash;
const serverHash = () => '';

/**
 * The body of /bookings/REF: the booking-confirmation card, then the guest's gallery.
 *
 * A delivered gallery opened by its own link (/bookings/REF#gallery — the delivery email, Account →
 * Galleries) shows the photos without the card above them; the card stays mounted, just hidden, so it
 * keeps its state, and comes back from the gallery header's "Your booking" crumb. Everything else is as
 * it always was. The rules live in src/lib/booking/booking-view.ts.
 */
export function BookingPageBody({ bookingRef }: { bookingRef: string }) {
  const hash = useSyncExternalStore(subscribeToHash, readHash, serverHash);
  const [phase, setPhase] = useState<GalleryPhase>('pending');
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setGraceOver(true), GALLERY_GRACE_MS);
    return () => clearTimeout(timer);
  }, []);

  const hidden = bookingCardHidden({ hash, phase, graceOver });

  // While hidden the card has no box for the browser's own fragment scroll to land on, so when the
  // guest asks for it back, bring it into view once it is showing.
  useEffect(() => {
    if (hash === `#${BOOKING_DETAILS_ID}` && !hidden) {
      document
        .getElementById(BOOKING_DETAILS_ID)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [hash, hidden]);

  return (
    <>
      <div id={BOOKING_DETAILS_ID} hidden={hidden} className="scroll-mt-6">
        <Suspense fallback={<p className="py-16 text-center text-sm text-ink-muted">Loading…</p>}>
          <BookingConfirmation bookingRef={bookingRef} />
        </Suspense>
      </div>
      <BookingGallery bookingRef={bookingRef} onPhase={setPhase} />
    </>
  );
}
