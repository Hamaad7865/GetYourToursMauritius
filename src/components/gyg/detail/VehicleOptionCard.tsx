import Link from 'next/link';
import type { VehiclePricing } from '@/lib/validation/tours';
import { VEHICLE_BANDS } from '@/lib/services/pricing';
import { IconClock, IconGlobe, IconPin, IconUsers } from '@/components/ui/icons';

function eur(n: number): string {
  return Number.isInteger(n) ? `€${n}` : `€${n.toFixed(2)}`;
}

/** GetYourGuide-style "option available" card for vehicle-priced (sightseeing) tours: surfaces the
 *  vehicle ladder + facts in the page body and scrolls to the booking widget. Static — reads the
 *  catalogue config only. */
export function VehicleOptionCard({
  title,
  cfg,
  durationLabel,
  pickupAvailable,
  languages,
}: {
  title: string;
  cfg: VehiclePricing;
  durationLabel: string | null;
  pickupAvailable: boolean;
  languages: string[];
}) {
  // "From" price of a band = perBlockEur × ceil(bandMin / blockSize); SUV is its flat price.
  const bandMin = (i: number) => (i === 0 ? 1 : VEHICLE_BANDS[i - 1]!.max + 1);
  const rows = [
    { name: 'Sedan', price: cfg.perBlockEur, cap: 4 },
    { name: 'SUV', price: cfg.suvFlatEur, cap: 4 },
    ...VEHICLE_BANDS.slice(1).map((b, i) => ({
      name: b.name,
      price: cfg.perBlockEur * Math.ceil(bandMin(i + 1) / cfg.blockSize),
      cap: b.max,
    })),
  ];

  return (
    <div className="rounded-2xl border border-ink/10 bg-white p-5 shadow-[0_18px_40px_-30px_rgba(10,46,54,0.4)]">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-[17px] font-extrabold tracking-tight text-ink">{title}</h3>
        <span className="shrink-0 text-[13px] text-ink-muted">
          From <b className="text-[17px] text-ink">{eur(cfg.perBlockEur)}</b> / vehicle
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink/80">
        {durationLabel && (
          <span className="flex items-center gap-1.5">
            <IconClock width={15} height={15} className="text-teal" /> {durationLabel}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <IconPin width={15} height={15} className="text-teal" />
          {pickupAvailable ? 'Hotel pickup' : 'Meeting point'}
        </span>
        {languages.length > 0 && (
          <span className="flex items-center gap-1.5">
            <IconGlobe width={15} height={15} className="text-teal" /> {languages.join(', ')}
          </span>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-2 gap-2">
        {rows.map((r) => (
          <li
            key={r.name}
            className="flex items-center justify-between rounded-xl border border-ink/10 px-3 py-2"
          >
            <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <IconUsers width={15} height={15} className="text-teal" /> {r.name}
              <span className="text-ink-muted">· up to {r.cap}</span>
            </span>
            <span className="text-[13px] font-bold text-ink">{eur(r.price)}</span>
          </li>
        ))}
      </ul>

      <Link
        href="#book"
        className="mt-4 flex w-full items-center justify-center rounded-xl bg-teal px-4 py-3 text-[15px] font-bold text-white hover:bg-teal-dark"
      >
        Choose vehicle &amp; date
      </Link>
    </div>
  );
}
