/* Whether this visit is browsing from Mauritius, as /api/planner/locality last said — kept for the rest
 * of the browser session (sessionStorage), so a second homepage view can put up the on-island row's
 * placeholders before paint instead of switching tiles after load. A yes/no, never the country.
 * No 'use client': the pre-paint script reads the key. */

export const ON_ISLAND_KEY = 'gytm:on-island';

/** true / false as last answered this session; null when never asked or storage is unavailable. */
export function readOnIsland(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(ON_ISLAND_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeOnIsland(onIsland: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(ON_ISLAND_KEY, onIsland ? '1' : '0');
  } catch {
    /* storage unavailable — non-fatal */
  }
}
