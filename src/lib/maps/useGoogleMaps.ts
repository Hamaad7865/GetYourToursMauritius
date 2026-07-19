'use client';

import { useEffect, useState } from 'react';

/* Singleton loader for the Google Maps JavaScript API. The script is injected once for the
 * whole app (a second hook just awaits the same promise), so multiple maps never load it
 * twice. It also listens for Google's runtime `gm_authFailure` callback — fired when the key
 * is invalid or an API isn't enabled for the project — and flips every map to `error` so they
 * fall back to a keyless Google Maps link instead of showing Google's grey error overlay. */

export type MapsStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Map ID — REQUIRED by AdvancedMarkerElement (it only renders on a map created with a mapId, which
 * also makes the map vector/WebGL). Set a real one per environment via NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID
 * (create it in Google Cloud → Map Management); `DEMO_MAP_ID` is Google's public id for dev/testing.
 */
export const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID';

const CALLBACK = '__gytmGoogleMapsReady';
let loadPromise: Promise<void> | null = null;
let authFailed = false;
const authSubscribers = new Set<() => void>();

if (typeof window !== 'undefined') {
  // Google calls this global if the API key is rejected at runtime (e.g. API not activated).
  (window as unknown as Record<string, unknown>).gm_authFailure = () => {
    authFailed = true;
    authSubscribers.forEach((fn) => fn());
  };
}

function loadMaps(apiKey: string): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<void>((resolve, reject) => {
    if (typeof window !== 'undefined' && window.google?.maps) {
      resolve();
      return;
    }
    (window as unknown as Record<string, unknown>)[CALLBACK] = () => resolve();
    const script = document.createElement('script');
    const params = new URLSearchParams({
      key: apiKey,
      libraries: 'places,marker,routes',
      loading: 'async',
      callback: CALLBACK,
      v: 'weekly',
      // Pin the results language. Without this, Geocoder/Places return names in the VISITOR'S browser
      // language — and a reverse-geocoded pick-up address flows onto the voucher PDF, whose WinAnsi
      // encoder (toWinAnsi in src/lib/invoice/pdf.ts) DELETES anything outside printable Latin-1. A
      // Cyrillic/Chinese/Arabic address would reach the driver mangled or blank. Matches the
      // `languageCode: 'en'` already used server-side in src/lib/maps/google-places.ts.
      language: 'en',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => reject(new Error('Failed to load the Google Maps script.'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/**
 * Loads the Maps JS API and reports its status. Returns `error` immediately when no key is
 * configured or the key has already been rejected, so callers can render a non-map fallback.
 */
export function useGoogleMaps(): MapsStatus {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const [status, setStatus] = useState<MapsStatus>(() => {
    if (authFailed) return 'error';
    if (typeof window !== 'undefined' && window.google?.maps) return 'ready';
    return apiKey ? 'idle' : 'error';
  });

  useEffect(() => {
    if (!apiKey || authFailed) {
      setStatus('error');
      return;
    }
    const onAuthFail = () => setStatus('error');
    authSubscribers.add(onAuthFail);

    let active = true;
    if (window.google?.maps) {
      setStatus('ready');
    } else {
      setStatus('loading');
      loadMaps(apiKey)
        .then(() => active && !authFailed && setStatus('ready'))
        .catch(() => active && setStatus('error'));
    }
    return () => {
      active = false;
      authSubscribers.delete(onAuthFail);
    };
  }, [apiKey]);

  return status;
}
