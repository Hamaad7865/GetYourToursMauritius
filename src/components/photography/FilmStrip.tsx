/**
 * The photo reel under the /photography hero: a slow, endless strip of frames between two rows of
 * sprocket holes, like 35mm film running through a gate.
 *
 * A port of Magic UI's Marquee (Dillion Verma, MIT — 21st.dev/@dillionverma/components/marquee)
 * rebuilt without JS or a motion library: the track is rendered twice and a CSS keyframe slides it
 * by exactly one copy (`-100% - gap`), so the loop is seamless. Hover pauses it. Under
 * prefers-reduced-motion the second copy is dropped and the strip becomes a plain, swipeable row
 * (see `.pg-marquee*` in globals.css) — nothing is ever hidden that a still page would show.
 */
export interface FilmFrame {
  key: string;
  src: string;
  alt: string;
}

/** Mixed frame shapes so the strip reads as a contact sheet, not a row of identical tiles. */
const SHAPES = ['aspect-[3/2]', 'aspect-[4/5]', 'aspect-[3/2]', 'aspect-square', 'aspect-[16/10]'];

export function FilmStrip({ frames, label }: { frames: FilmFrame[]; label: string }) {
  if (frames.length === 0) return null;
  return (
    <section aria-label={label} className="relative bg-ink py-4 sm:py-5">
      <Sprockets />
      <div className="pg-marquee my-3 flex gap-[var(--gap)] [--duration:70s] [--gap:0.75rem] sm:my-4">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            aria-hidden={copy === 1 ? true : undefined}
            className={`pg-marquee-track flex shrink-0 gap-[var(--gap)] ${copy === 1 ? 'pg-marquee-dup' : ''}`}
          >
            {frames.map((f, i) => (
              <li
                key={f.key}
                className={`${SHAPES[i % SHAPES.length]} h-[132px] shrink-0 overflow-hidden rounded-[5px] bg-white/5 sm:h-[184px]`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.src}
                  alt={copy === 1 ? '' : f.alt}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </li>
            ))}
          </ul>
        ))}
      </div>
      <Sprockets />
    </section>
  );
}

function Sprockets() {
  return (
    <div
      aria-hidden
      className="mx-auto h-2.5 max-w-none bg-[repeating-linear-gradient(90deg,transparent_0_9px,rgba(234,247,245,0.16)_9px_23px)] [mask-image:linear-gradient(to_right,transparent,#000_4%,#000_96%,transparent)]"
    />
  );
}
