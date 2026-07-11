/**
 * Animated ocean-waves hero backdrop for the About page — pure CSS/SVG, no photos.
 * A teal→deep-teal "sky to sea" gradient with a soft gold sun glow, and four layered
 * wave bands that drift horizontally at different speeds (parallax). All motion is
 * transform-only (GPU-friendly) and is fully disabled under prefers-reduced-motion.
 * Decorative (aria-hidden) — it sits behind the hero's headline, which carries the meaning.
 * A gentle bottom darkening keeps the white headline well above WCAG AA contrast.
 */
export function HeroWaves() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* sky → sea gradient */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg,#15a3a8 0%,#0E8C92 32%,#0B5C63 64%,#06343a 100%)',
        }}
      />
      {/* soft gold sun glow, top-right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 80% 16%, rgba(233,185,73,0.42), rgba(233,185,73,0) 42%)',
        }}
      />
      {/* faint light shimmer below the sun */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 55% at 80% 18%, rgba(255,255,255,0.12), transparent 52%)',
        }}
      />

      {/* wave bands — back (light foam) to front (deep sea) */}
      <Wave fill="rgba(255,255,255,0.10)" bottom="32%" height="150px" dur="27s" reverse />
      <Wave fill="rgba(43,179,184,0.40)" bottom="18%" height="170px" dur="21s" />
      <Wave fill="rgba(11,92,99,0.80)" bottom="4%" height="190px" dur="16s" reverse />
      <Wave fill="#06343a" bottom="-6%" height="210px" dur="12s" />

      {/* bottom darkening so the headline stays crisp */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, transparent 44%, rgba(4,30,34,0.55) 78%, rgba(4,24,28,0.78) 100%)',
        }}
      />

      <style>{`
        @keyframes gytmWaveL { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes gytmWaveR { from { transform: translateX(-50%); } to { transform: translateX(0); } }
        @media (prefers-reduced-motion: reduce){ .gytm-wave { animation: none !important; } }
      `}</style>
    </div>
  );
}

function Wave({
  fill,
  bottom,
  height,
  dur,
  reverse,
}: {
  fill: string;
  bottom: string;
  height: string;
  dur: string;
  reverse?: boolean;
}) {
  return (
    <div
      className="gytm-wave absolute left-0"
      style={{
        bottom,
        height,
        width: '200%',
        willChange: 'transform',
        animation: `${reverse ? 'gytmWaveR' : 'gytmWaveL'} ${dur} linear infinite`,
      }}
    >
      {/* viewBox is two identical 1440-wide periods, so translateX(-50%) loops seamlessly */}
      <svg
        viewBox="0 0 2880 210"
        preserveAspectRatio="none"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        <path
          d="M0,105 C 240,60 480,60 720,105 C 960,150 1200,150 1440,105 C 1680,60 1920,60 2160,105 C 2400,150 2640,150 2880,105 L 2880,210 L 0,210 Z"
          fill={fill}
        />
      </svg>
    </div>
  );
}
