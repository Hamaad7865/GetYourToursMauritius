'use client';

import { useState } from 'react';
import { AirportQuote } from './AirportQuote';
import { HotelToHotelQuote } from './HotelToHotelQuote';

const TEAL = '#0E8C92';
const INK = '#11201F';

/**
 * Segmented toggle in the page's #quote slot: Airport ↔ Hotel (the existing AirportQuote) or
 * Hotel ↔ Hotel (the new point-to-point console). A client island so the rest of the page — its hero,
 * JSON-LD, canonical and metadata — stays a server component and the airport SEO is untouched.
 */
export function TransferModeSwitch() {
  const [mode, setMode] = useState<'airport' | 'hotel'>('airport');
  return (
    <div>
      <div className="mb-6 flex justify-center">
      <div
        className="inline-flex rounded-full border p-1"
        style={{ borderColor: 'rgba(17,32,31,0.15)', background: '#fff' }}
      >
        {(
          [
            ['airport', 'Airport ↔ Hotel'],
            ['hotel', 'Hotel ↔ Hotel'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className="rounded-full px-5 py-2 text-[14px] font-bold transition"
            style={mode === m ? { background: TEAL, color: '#fff' } : { color: INK }}
          >
            {label}
          </button>
        ))}
      </div>
      </div>
      {mode === 'airport' ? <AirportQuote /> : <HotelToHotelQuote />}
    </div>
  );
}
