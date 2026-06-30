/**
 * Decorative animated hero scene for /rent: a coral car driving along a coastal road. The car bobs in
 * place while the road dashes + palms stream past and the wheels spin (pure CSS keyframes in
 * globals.css; frozen to a parked still under prefers-reduced-motion). Layered behind the hero text — a
 * left scrim keeps the white title/intro legible. No JS, no client bundle, edge-safe.
 */

function Palm({ scale = 1, dim = 'text-[#0a4a50]' }: { scale?: number; dim?: string }) {
  return (
    <svg
      width={44 * scale}
      height={72 * scale}
      viewBox="0 0 44 72"
      fill="none"
      className={`shrink-0 self-end ${dim}`}
      aria-hidden
    >
      {/* trunk */}
      <path d="M21 70c0-16 1-28 2-38" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      {/* fronds */}
      <g fill="currentColor">
        <path d="M23 30c-9-7-19-7-22-2 6-1 13 0 19 5z" />
        <path d="M23 30c9-7 19-7 22-2-6-1-13 0-19 5z" />
        <path d="M23 31c-6-9-15-12-21-9 6 1 12 4 16 11z" />
        <path d="M23 31c6-9 15-12 21-9-6 1-12 4-16 11z" />
        <path d="M23 31c-1-10-7-17-13-18 4 4 7 10 8 18z" />
      </g>
    </svg>
  );
}

function Wheel({ cx }: { cx: number }) {
  return (
    <g transform={`translate(${cx} 57)`}>
      <g className="gyt-wheel">
        <circle r="11" fill="#0c2b30" stroke="#05151a" strokeWidth="2" />
        <circle r="4.6" fill="#c2d2d3" />
        <g stroke="#7f9698" strokeWidth="1.7">
          <line x1="0" y1="-9" x2="0" y2="9" />
          <line x1="-9" y1="0" x2="9" y2="0" />
          <line x1="-6.4" y1="-6.4" x2="6.4" y2="6.4" />
          <line x1="-6.4" y1="6.4" x2="6.4" y2="-6.4" />
        </g>
        <circle r="1.9" fill="#0c2b30" />
      </g>
    </g>
  );
}

const PALMS = [1, 0.82, 1.15, 0.9, 1.05, 0.78];

export function CarHero() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Sun */}
      <svg className="gyt-sun absolute right-[7%] top-[16%] h-14 w-14 text-[#FFD27A]" viewBox="0 0 60 60" fill="none">
        <circle cx="30" cy="30" r="13" fill="currentColor" opacity="0.95" />
        <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.7">
          <line x1="30" y1="3" x2="30" y2="11" />
          <line x1="30" y1="49" x2="30" y2="57" />
          <line x1="3" y1="30" x2="11" y2="30" />
          <line x1="49" y1="30" x2="57" y2="30" />
          <line x1="11" y1="11" x2="16" y2="16" />
          <line x1="44" y1="44" x2="49" y2="49" />
          <line x1="49" y1="11" x2="44" y2="16" />
          <line x1="16" y1="44" x2="11" y2="49" />
        </g>
      </svg>

      {/* Palms streaming past, just above the road */}
      <div className="absolute bottom-[50px] left-0 right-0 h-24">
        <div className="gyt-scenery flex w-max items-end gap-16 will-change-transform sm:gap-24">
          {[...PALMS, ...PALMS].map((s, i) => (
            <Palm key={i} scale={s} dim={i % 3 === 0 ? 'text-[#0c545b]' : 'text-[#0a4a50]'} />
          ))}
        </div>
      </div>

      {/* Road */}
      <div className="absolute inset-x-0 bottom-0 h-[56px] bg-[#083e44]">
        <div className="absolute inset-x-0 top-0 h-[3px] bg-white/15" />
        <div className="gyt-road absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 bg-[repeating-linear-gradient(to_right,rgba(255,255,255,0.55)_0,rgba(255,255,255,0.55)_28px,transparent_28px,transparent_56px)]" />
      </div>

      {/* Car (bobs in place; wheels spin) */}
      <div className="absolute bottom-[12px] left-1/2 -translate-x-1/2 sm:left-[62%]">
        <div className="gyt-car-bob will-change-transform">
          <svg width="150" height="74" viewBox="0 0 150 74" fill="none">
            <ellipse cx="75" cy="68" rx="62" ry="4.5" fill="#03262b" opacity="0.28" />
            {/* body */}
            <path
              d="M6 47c0-6 4-8 10-9l24-1c6-8 14-15 30-15h25c13 0 21 8 27 16l13 3c6 1 9 4 9 9v4c0 3-2 4-5 4H11c-3 0-5-2-5-5z"
              fill="#F2735F"
            />
            {/* windows */}
            <path d="M48 37c5-7 11-11 22-11h12v11z" fill="#D7F4F1" />
            <path d="M88 26h6c11 0 18 5 23 11H88z" fill="#D7F4F1" />
            <line x1="86" y1="27" x2="86" y2="47" stroke="#d2543f" strokeWidth="1.6" />
            {/* trims */}
            <path d="M6 47c0-6 4-8 10-9l24-1" stroke="#d2543f" strokeWidth="1.4" fill="none" opacity="0.7" />
            <circle cx="143" cy="49" r="2.6" fill="#FFE9A8" />
            <circle cx="9" cy="49" r="2.2" fill="#b23a2a" />
            <Wheel cx={42} />
            <Wheel cx={110} />
          </svg>
        </div>
      </div>

      {/* Left scrim so the white hero title/intro stays legible over the scene */}
      <div className="absolute inset-0 bg-gradient-to-r from-[#03262b]/85 via-[#0a4953]/35 to-transparent" />
    </div>
  );
}
