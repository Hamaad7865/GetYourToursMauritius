/**
 * Decorative hero visual for /airport-transfers: the operator's real car photo eases in from the right
 * (as if pulling up to arrivals) once on load, then settles into the same gentle float + soft ground
 * shadow used on the /rent hero — a premium, real-photo feel, not a cartoon. Right side only, hidden
 * below lg so it never crowds the headline; pure CSS (keyframes in globals.css); frozen to a parked
 * still under prefers-reduced-motion; no client JS. Purely ambient, so aria-hidden + pointer-events-none.
 */
export function AirportTaxi() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] hidden overflow-hidden xl:block">
      {/* The car faces left, so sliding in from the right moves it nose-first into place. Fluid width
          (clamp) scales smoothly and stays clear of the left-aligned headline at every width ≥ xl. */}
      <div className="gyt-taxi-in absolute bottom-[8%] right-[2.5%] w-[clamp(360px,28vw,600px)]">
        {/* soft ground shadow (stays low while the car lifts) */}
        <div className="gyt-car-shadow absolute -bottom-2 left-1/2 h-3 w-[78%] -translate-x-1/2 rounded-[50%] bg-[#03181b] blur-md" />
        {/* eslint-disable-next-line @next/next/no-img-element -- CF Pages serves images unoptimized. */}
        <img
          src="/rental/hero-car.png"
          alt=""
          width={922}
          height={525}
          decoding="async"
          className="gyt-car-float relative h-auto w-full drop-shadow-[0_18px_30px_rgba(2,22,24,0.35)]"
        />
      </div>
    </div>
  );
}
