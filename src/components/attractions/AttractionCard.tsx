import Link from 'next/link';
import type { PlannerPlace } from '@/lib/validation/planner';
import { attractionPath, attractionImage, categoryMeta } from '@/lib/content/attractions';

/** Card for the attractions hub + the "nearby" rail. Uses a real Wikimedia photo when we
 *  have one, otherwise a branded category gradient. */
export function AttractionCard({ place }: { place: PlannerPlace }) {
  const meta = categoryMeta(place.category);
  const img = attractionImage(place.id) ?? (place.imageUrl ? { url: place.imageUrl } : null);
  return (
    <Link
      href={attractionPath(place.id)}
      className="group block overflow-hidden rounded-2xl border border-ink/10 bg-white transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className={`relative aspect-[4/3] bg-gradient-to-br ${meta.gradient}`}>
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img.url}
            alt={place.name}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <span aria-hidden className="absolute inset-0 grid place-items-center text-5xl opacity-90">
            {meta.emoji}
          </span>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-ink">
          {meta.label}
        </span>
      </div>
      <div className="p-4">
        <div className="text-[11px] font-bold uppercase tracking-wide text-teal">{place.region} Mauritius</div>
        <h3 className="mt-1 text-[16px] font-extrabold leading-snug text-ink transition group-hover:text-teal">
          {place.name}
        </h3>
        {place.blurb && (
          <p className="mt-1.5 line-clamp-2 text-[13.5px] leading-snug text-ink/70">{place.blurb}</p>
        )}
      </div>
    </Link>
  );
}
