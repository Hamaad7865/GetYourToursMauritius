import { hueFor, thumbGradient } from './planner-constants';

/** The design's colourful gradient place tile (no photos needed) — a hue per category + initial. */
export function Thumb({ place, size = 52 }: { place: { id: string; name: string; category: string }; size?: number }) {
  const hue = hueFor(place);
  return (
    <div
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-xl"
      style={{ width: size, height: size, background: thumbGradient(hue) }}
      aria-hidden
    >
      <span className="font-display font-semibold text-white/90" style={{ fontSize: size * 0.42 }}>
        {place.name[0]}
      </span>
      <div className="absolute inset-0" style={{ background: 'radial-gradient(80% 60% at 70% 0%, rgba(255,255,255,.28), transparent)' }} />
    </div>
  );
}
