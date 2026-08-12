/**
 * The pickup a quote is being priced from — the shape alone, with none of the machinery.
 *
 * This is a separate module because of what importing the pickup MAP costs. `LineTransport` (the
 * per-line "+ Add transport" control) pulls in `PickupMap` → `useGoogleMaps` → the Places/marker loader
 * and the preferences provider, and anything that so much as names its prop type would drag that whole
 * graph into its own bundle — the quotes editor, which mostly never opens the map, and the unit test
 * that imports the editor purely to check the screen is reachable (that import alone went from instant
 * to seconds).
 *
 * So the type and its empty value live here, in a module with no React and no Maps, and the map itself
 * is loaded on demand at the point of use. Nothing else about it changes.
 */

export interface QuotePickup {
  /** The readable address the map resolved (autocomplete / reverse-geocoded pin). */
  label: string;
  /** The resolved point, or null while the operator is typing a free address that has no pin yet.
   *  The transport region — and therefore the fare — is derived from this, never from the text. */
  coords: { lat: number; lng: number } | null;
}

/** No hotel chosen yet: no transfer can be priced, and the fare falls back to 0 for the operator. */
export const EMPTY_PICKUP: QuotePickup = { label: '', coords: null };
