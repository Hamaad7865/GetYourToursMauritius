/**
 * Decorative hero visual for /rent: the operator's real car photo (a transparent PNG cutout) floating
 * over the teal hero band, with a soft ground shadow that settles as the car lifts — a premium
 * product-hero feel, not a cartoon. A left scrim keeps the white title/intro legible. Pure CSS
 * (keyframes in globals.css; frozen to a parked still under prefers-reduced-motion). No client JS.
 */

export function CarHero() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Real car, bottom-right, gently floating */}
      <div className="absolute bottom-[7%] right-[2%] w-[62%] max-w-[560px] sm:right-[4%] sm:w-[52%]">
        {/* soft ground shadow (stays low while the car lifts) */}
        <div className="gyt-car-shadow absolute -bottom-2 left-1/2 h-3 w-[78%] -translate-x-1/2 rounded-[50%] bg-[#03181b] blur-md" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/rental/hero-car.png"
          alt=""
          width={922}
          height={525}
          fetchPriority="high"
          className="gyt-car-float relative h-auto w-full drop-shadow-[0_18px_30px_rgba(2,22,24,0.35)]"
        />
      </div>

      {/* Left scrim so the white hero title/intro stays legible over the photo */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#03262b]/85 via-[#0a4953]/35 to-transparent" />
    </div>
  );
}
