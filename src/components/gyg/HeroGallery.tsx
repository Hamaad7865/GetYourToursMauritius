/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

export interface HeroImage {
  url: string;
  alt: string;
}

/* Scatter pose per card: rotation + offset from the pile centre. Front-most last. */
const POSES = [
  { rot: -10, x: -78, y: -56 },
  { rot: 7, x: 60, y: -88 },
  { rot: -4, x: -26, y: 34 },
  { rot: 11, x: 92, y: 66 },
  { rot: -7, x: -54, y: 128 },
] as const;

/**
 * Decorative photo pile for the hero's open (right) side: a few framed Mauritius shots that
 * slide + fan into a scattered stack on load (staggered) and gently float — a "flick-through"
 * of the trips. Pure CSS, no JS/libraries; hidden below lg (no room) and frozen under
 * prefers-reduced-motion. Decorative, so aria-hidden.
 */
export function HeroGallery({ images }: { images: HeroImage[] }) {
  const cards = images.slice(0, POSES.length);
  if (cards.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute right-[3%] top-1/2 z-[5] hidden h-[460px] w-[420px] -translate-y-1/2 lg:block xl:right-[6%]"
    >
      {cards.map((img, i) => {
        const p = POSES[i]!;
        return (
          <div
            key={`${img.url}-${i}`}
            className="absolute left-1/2 top-1/2"
            style={{
              marginLeft: -98,
              marginTop: -123,
              transform: `translate(${p.x}px, ${p.y}px)`,
              zIndex: i + 1,
            }}
          >
            <div style={{ transform: `rotate(${p.rot}deg)` }}>
              {/* Entrance (staggered) wraps the continuous float so the two transforms don't fight. */}
              <div className="hg-in" style={{ animationDelay: `${300 + i * 150}ms` }}>
                <div className="hg-float" style={{ animationDelay: `${i * -1500}ms` }}>
                  <figure className="m-0 rounded-sm bg-white p-2.5 pb-3 shadow-[0_24px_46px_-18px_rgba(5,28,32,0.85)]">
                    <img
                      src={img.url}
                      alt=""
                      loading="lazy"
                      className="block h-56 w-44 rounded-[2px] object-cover"
                    />
                  </figure>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
