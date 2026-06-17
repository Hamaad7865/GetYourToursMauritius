'use client';

import type { CSSProperties } from 'react';
import { projectToMap, outlinePath } from '@/lib/planner/map-projection';
import { useReducedMotion } from './useReducedMotion';

export interface MapStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const TEAL = '#0E8C92';
const TEAL_D = '#0B5C63';
const CORAL = '#F76C5E';
const INK = '#0A2E36';

/**
 * Stylized Mauritius map — a hand-traced SVG island (lagoon halo + land + contour) with the route
 * drawn pickup → stops → pickup, numbered coral teardrop pins, a pulsing pickup marker and drive-time
 * chips per leg. Ported from the design handoff; coordinates are real (planner_places + pickups).
 * Visual only — the legend credits Google Maps, where the booking re-times the day for real.
 */
export function MauritiusMap({
  pickup,
  stops,
  segMinutes,
  lastAdded,
  routeKey,
}: {
  pickup: { lat: number; lng: number };
  stops: MapStop[];
  /** Drive minutes per leg: pickup→stop1, …, stopN→pickup (length = stops.length + 1). */
  segMinutes: number[];
  lastAdded: string | null;
  routeKey: number;
}) {
  const reduced = useReducedMotion();
  const pk = projectToMap(pickup.lng, pickup.lat);
  const stopPts = stops.map((s) => ({ ...s, ...projectToMap(s.lng, s.lat) }));
  const routePts = [pk, ...stopPts.map((s) => ({ x: s.x, y: s.y })), pk];
  const routeD = routePts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const outlineD = outlinePath();

  const routeStyle: CSSProperties = {
    filter: 'drop-shadow(0 2px 4px rgba(14,140,146,.4))',
    strokeDashoffset: reduced ? 0 : undefined,
    animation: reduced ? 'none' : 'drawRoute 1.1s ease forwards',
    ['--len' as string]: '1400',
  };

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ background: 'linear-gradient(180deg,#D9F0EE 0%,#C5E8E6 100%)' }}>
      <svg
        key={routeKey}
        viewBox="0 0 760 1000"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={
          stops.length
            ? `Map of Mauritius showing ${stops.length} planned stops and the driving route`
            : 'Map of Mauritius — your planned stops will appear here'
        }
      >
        <defs>
          <radialGradient id="planner-lagoon" cx="50%" cy="42%" r="62%">
            <stop offset="0%" stopColor="#EAF7F5" />
            <stop offset="70%" stopColor="#CFEAE7" />
            <stop offset="100%" stopColor="#A9D9D5" />
          </radialGradient>
          <linearGradient id="planner-land" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#EAF7F5" />
            <stop offset="100%" stopColor="#D3ECE8" />
          </linearGradient>
          <filter id="planner-soft">
            <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#0B5C63" floodOpacity="0.18" />
          </filter>
        </defs>

        {/* lagoon halo */}
        <path d={outlineD} fill="url(#planner-lagoon)" transform="translate(380 500) scale(1.14) translate(-380 -500)" opacity={0.55} />
        {/* land */}
        <path d={outlineD} fill="url(#planner-land)" stroke="#9FD2CD" strokeWidth={2.5} filter="url(#planner-soft)" />
        {/* interior contour */}
        <path d={outlineD} fill="none" stroke="#BFE0DC" strokeWidth={1.5} transform="translate(380 500) scale(0.86) translate(-380 -500)" opacity={0.6} />

        {/* route */}
        {stopPts.length > 0 && (
          <path d={routeD} fill="none" stroke={TEAL} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 11" style={routeStyle} />
        )}
        {stopPts.length > 0 && (
          <path
            d={`M${pk.x.toFixed(1)} ${pk.y.toFixed(1)} L${stopPts[stopPts.length - 1]!.x.toFixed(1)} ${stopPts[stopPts.length - 1]!.y.toFixed(1)}`}
            fill="none"
            stroke={TEAL_D}
            strokeWidth={2}
            strokeDasharray="5 7"
            opacity={0.4}
          />
        )}

        {/* drive chips per leg (pickup→stop1 … stop(n-1)→stopn) */}
        {stopPts.map((s, i) => {
          const a = i === 0 ? pk : stopPts[i - 1]!;
          const mx = (a.x + s.x) / 2;
          const my = (a.y + s.y) / 2;
          return (
            <g key={`seg${i}`} transform={`translate(${mx} ${my})`}>
              <rect x={-24} y={-13} width={48} height={26} rx={13} fill="#fff" stroke="#D8ECEA" strokeWidth={1.5} style={{ filter: 'drop-shadow(0 2px 5px rgba(10,46,54,.14))' }} />
              <text x={0} y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill={TEAL_D} fontFamily="'Plus Jakarta Sans',sans-serif">
                {segMinutes[i] ?? 0}m
              </text>
            </g>
          );
        })}

        {/* pickup marker */}
        <g transform={`translate(${pk.x} ${pk.y})`}>
          {!reduced && <circle r={14} fill={INK} opacity={0.18} style={{ transformOrigin: 'center', animation: 'pulseRing 2.2s infinite ease-out' }} />}
          <circle r={9} fill="#fff" stroke={INK} strokeWidth={3} />
          <circle r={3.5} fill={INK} />
        </g>

        {/* stop pins */}
        {stopPts.map((s, i) => (
          <g
            key={s.id}
            transform={`translate(${s.x} ${s.y})`}
            style={{ transformOrigin: 'center', animation: !reduced && s.id === lastAdded ? 'dropPin .5s cubic-bezier(.2,1.3,.4,1) both' : 'none' }}
          >
            <path d="M0 6 C-9 -6 -13 -12 -13 -19 A13 13 0 1 1 13 -19 C13 -12 9 -6 0 6 Z" fill={CORAL} stroke="#fff" strokeWidth={2.5} style={{ filter: 'drop-shadow(0 4px 6px rgba(247,108,94,.45))' }} />
            <circle cx={0} cy={-19} r={9} fill="#fff" />
            <text x={0} y={-15} textAnchor="middle" fontSize={13} fontWeight={800} fill={CORAL} fontFamily="'Plus Jakarta Sans',sans-serif">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>

      {/* legend */}
      <div className="absolute bottom-3.5 left-3.5 flex items-center gap-2 rounded-[11px] border border-[#DCEDEB] bg-white/90 px-2.5 py-1.5 shadow-[0_6px_16px_rgba(10,46,54,.10)] backdrop-blur">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 13l4 4L19 7" stroke={TEAL} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[11.5px] font-bold text-teal-dark">Drive times from Google Maps</span>
      </div>

      {stopPts.length === 0 && (
        <div className="absolute left-3.5 right-3.5 top-3.5 text-center">
          <span className="inline-block rounded-[11px] border border-[#DCEDEB] bg-white/90 px-3 py-1.5 text-[12.5px] font-semibold text-ink-muted">
            Mauritius — your stops will pin here
          </span>
        </div>
      )}
    </div>
  );
}
