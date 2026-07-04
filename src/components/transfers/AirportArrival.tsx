/**
 * Decorative hero visual for /airport-transfers: a real photo of a just-landed traveller walking to
 * their waiting car outside the terminal — the exact "we're already there when you land" moment. Shown
 * as a framed panel on the right of the hero: it fades + rises into place on load, then drifts through a
 * very slow Ken Burns zoom for ambient life. Right side only, hidden below xl so it never crowds the
 * headline. Pure CSS (keyframes in globals.css); frozen to a still under prefers-reduced-motion; no
 * client JS. Purely ambient, so aria-hidden + pointer-events-none.
 *
 * NOTE: public/hero/airport-arrival.jpg is currently a low-res stock preview — swap in the licensed
 * full-resolution file at the same path for production (no code change needed).
 */
export function AirportArrival() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] hidden xl:block">
      {/* centering lives on this wrapper so the entrance/zoom transforms below stay conflict-free */}
      <div className="absolute right-[3%] top-1/2 w-[clamp(340px,27vw,540px)] -translate-y-1/2">
        <div className="gyt-arrival-in relative overflow-hidden rounded-[20px] shadow-[0_30px_60px_-20px_rgba(2,20,24,0.7)] ring-1 ring-white/15">
          {/* eslint-disable-next-line @next/next/no-img-element -- CF Pages serves images unoptimized. */}
          <img
            src="/hero/airport-arrival.jpg"
            alt=""
            width={540}
            height={360}
            decoding="async"
            className="gyt-arrival-zoom block aspect-[3/2] w-full object-cover"
          />
          {/* inner hairline so the panel reads as a crafted frame, not a pasted rectangle */}
          <div className="pointer-events-none absolute inset-0 rounded-[20px] ring-1 ring-inset ring-black/10" />
        </div>
      </div>
    </div>
  );
}
