import Link from 'next/link';
import { IconCart } from '@/components/ui/icons';

/**
 * Cart screen. Booking currently goes straight from an activity to checkout (no cart
 * accumulation yet), so this is the empty state — an invitation to browse. When an add-to-cart
 * flow lands, this is where the held line items render.
 */
export function CartView() {
  return (
    <div className="grid min-h-[55vh] place-items-center py-12 text-center">
      <div>
        <div aria-hidden className="relative mx-auto grid h-40 w-40 place-items-center">
          <span className="absolute inset-0 rounded-full bg-teal/[0.07]" />
          <span className="absolute inset-5 rounded-full border-2 border-dashed border-teal/25" />
          <svg viewBox="0 0 120 40" className="absolute -bottom-1 left-1/2 h-6 w-28 -translate-x-1/2">
            <path
              d="M2 20 Q17 6 32 20 T62 20 T92 20 T118 20"
              fill="none"
              className="stroke-teal/35"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <IconCart width={54} height={54} className="relative text-teal-dark" />
        </div>
        <h1 className="mt-8 font-display text-[26px] font-semibold text-ink">
          No activities in your cart
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-muted">
          Activities you add to your cart will appear here while you book.
        </p>
        <Link
          href="/activities"
          className="mt-6 inline-block rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
        >
          Find things to do
        </Link>
      </div>
    </div>
  );
}
