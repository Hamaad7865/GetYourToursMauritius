import type { FeaturedReview } from '@/lib/content/reviews';
import { IconStar } from '@/components/ui/icons';
import { formatPostDate } from '@/lib/content/blog';

function Stars({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <IconStar key={i} width={15} height={15} className={i < n ? 'text-gold-light' : 'text-ink/15'} />
      ))}
    </span>
  );
}

export function ReviewCard({ review: r }: { review: FeaturedReview }) {
  return (
    <figure className="flex h-full flex-col rounded-2xl border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <Stars n={r.rating} />
        <span className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{r.source}</span>
      </div>
      {r.title && <h3 className="mt-3 text-[15px] font-extrabold leading-snug text-ink">{r.title}</h3>}
      <blockquote className="mt-2 line-clamp-6 text-[14px] leading-relaxed text-ink/75">{r.text}</blockquote>
      <figcaption className="mt-4 flex items-center justify-between border-t border-ink/8 pt-3 text-[12.5px]">
        <span className="font-bold text-ink">
          {r.author}
          {r.authorLocation ? <span className="font-normal text-ink-muted"> · {r.authorLocation}</span> : null}
        </span>
        {r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="shrink-0 font-semibold text-teal hover:text-teal-dark"
          >
            Read on {r.source}
          </a>
        ) : r.date ? (
          <span className="shrink-0 text-ink-muted">{formatPostDate(r.date)}</span>
        ) : null}
      </figcaption>
    </figure>
  );
}
