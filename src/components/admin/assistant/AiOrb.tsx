import type { CSSProperties } from 'react';

/**
 * Belle Mare AI's mark: a gold sun with two teal planets, drawn in CSS gradients.
 *
 * The big orb follows the pointer. Nothing here re-renders for that: the panel writes `--nx`,
 * `--ny` (-1…1, where the pointer is from the orb) and `--near` (0…1, how close) on an ancestor,
 * and each layer moves by its own depth through `calc()`. Under reduced motion the layers are held
 * still in globals.css (`.bmai-orb-layer`), and the bob stops.
 */

/** A layer's place and its parallax depth (how far it travels with the pointer). */
function layer(depth: number, style: CSSProperties): CSSProperties {
  return {
    ...style,
    transform: `translate(calc(var(--nx, 0) * ${depth * 9}px), calc(var(--ny, 0) * ${depth * 7}px))`,
  };
}

/** The highlight moves a little towards the pointer, so the light seems to come from it. */
const HX = 'calc(34% + var(--nx, 0) * 16%)';
const HY = 'calc(28% + var(--ny, 0) * 16%)';
const at = (dx: number, dy: number) =>
  `calc(${HX} + ${dx}%) calc(${HY} + ${dy}%)`.replace(/\+ -/g, '- ');

export function AiOrb() {
  return (
    <div aria-hidden="true" className="bmai-orb relative h-[128px] w-[168px]">
      <span
        className="bmai-orb-layer absolute bottom-[-4px] left-[34px] h-[14px] w-[100px] rounded-full blur-[2px]"
        style={{
          background: 'radial-gradient(closest-side, rgba(0,0,0,0.55), transparent)',
          transform:
            'translateX(calc(var(--nx, 0) * -6px)) scaleX(calc(1 - var(--near, 0) * 0.08))',
        }}
      />
      <span
        className="bmai-orb-layer absolute left-[10px] top-[44px] h-[52px] w-[52px] rounded-full"
        style={layer(0.45, {
          background: `radial-gradient(circle at ${at(4, 4)}, #C6F1EA 0%, #5CC5BA 32%, #1E8A82 68%, #0C4E4A 100%)`,
          boxShadow: 'inset -6px -8px 14px rgba(4,40,38,0.45)',
        })}
      />
      <span
        className="bmai-orb-layer absolute left-[40px] top-[10px] h-[88px] w-[88px] rounded-full"
        style={layer(1, {
          background: `radial-gradient(circle at ${HX} ${HY}, #FFF6E2 0%, #FFD48E 22%, #F7A649 58%, #D9732A 84%, #B0561A 100%)`,
          boxShadow:
            'inset -10px -12px 22px rgba(140,55,10,0.38), 0 14px 40px rgba(244,160,70,calc(0.22 + var(--near, 0) * 0.18))',
        })}
      />
      <span
        className="bmai-orb-layer absolute left-[108px] top-[58px] h-[46px] w-[46px] rounded-full"
        style={layer(1.7, {
          background: `radial-gradient(circle at ${at(-2, -2)}, #D8F6F1 0%, #6FD0C5 30%, #23958C 66%, #0E5753 100%)`,
          boxShadow: 'inset -6px -7px 12px rgba(4,40,38,0.45), 0 8px 18px rgba(0,0,0,0.35)',
        })}
      />
      <span
        className="bmai-orb-layer absolute left-[30px] top-[92px] h-[22px] w-[22px] rounded-full"
        style={layer(2.4, {
          background: `radial-gradient(circle at ${HX} ${HY}, #FFF1D2 0%, #F7C27A 45%, #D07A2E 100%)`,
          boxShadow: 'inset -3px -4px 6px rgba(120,50,10,0.35)',
        })}
      />
    </div>
  );
}

/** The small sun beside each answer. */
export function OrbAvatar({ size = 26, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 32% 28%, #FFF1D2, #FFC978 30%, #F29A3A 70%, #C9661C)',
        boxShadow: '0 0 14px rgba(244,160,70,0.35)',
      }}
    />
  );
}

/** The launcher's mark: the sun with one teal planet, small enough for the top bar. */
export function OrbMark({ size = 20 }: { size?: number }) {
  const planet = Math.round(size * 0.46);
  return (
    <span aria-hidden="true" className="relative block" style={{ width: size, height: size }}>
      <span
        className="absolute left-0 top-0 rounded-full"
        style={{
          width: Math.round(size * 0.78),
          height: Math.round(size * 0.78),
          background:
            'radial-gradient(circle at 34% 28%, #FFF6E2 0%, #FFD48E 22%, #F7A649 58%, #D9732A 100%)',
        }}
      />
      <span
        className="absolute bottom-0 right-0 rounded-full ring-2 ring-white"
        style={{
          width: planet,
          height: planet,
          background: 'radial-gradient(circle at 32% 28%, #D8F6F1 0%, #6FD0C5 30%, #23958C 70%)',
        }}
      />
    </span>
  );
}
