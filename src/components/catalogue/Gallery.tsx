import type { TourImage } from '@/lib/validation/tours';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized; <img> is intentional. */

function Fallback({ label, className }: { label: string; className?: string }) {
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] ${className ?? ''}`}
    >
      <span className="font-display text-4xl font-medium text-cream/90">{label}</span>
    </div>
  );
}

/**
 * Activity photo gallery: a large hero plus up to four thumbnails. Falls back to a
 * branded gradient tile when the catalogue has no imagery yet.
 */
export function Gallery({ images, title }: { images: TourImage[]; title: string }) {
  const initial = title.slice(0, 1).toUpperCase();
  const hero = images[0] ?? null;
  const thumbs = images.slice(1, 5);

  return (
    <div className="mb-7">
      <div className="relative h-[280px] overflow-hidden rounded-card sm:h-[384px]">
        {hero ? (
          <img src={hero.url} alt={hero.alt ?? title} className="h-full w-full object-cover" />
        ) : (
          <Fallback label={initial} />
        )}
      </div>

      {thumbs.length > 0 && (
        <div className="mt-2.5 grid grid-cols-4 gap-2.5">
          {thumbs.map((img) => (
            <div key={img.id} className="relative h-[74px] overflow-hidden rounded-xl sm:h-[90px]">
              <img src={img.url} alt={img.alt ?? title} className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
