import type { TransferRegion } from './transfers';

/**
 * Curated, well-known Mauritius places for the point-to-point (location-to-location) transfer picker —
 * shown ALONGSIDE the listed hotels so a guest can pick "Grand Baie" or "Flic en Flac" without hunting for
 * a specific resort. Each place's `region` is chosen to MATCH the SQL `area_region()` classifier (and its
 * TS mirror `areaRegion()`), so the instant display price equals the server-charged region-band fare
 * cent-for-cent. When a guest picks one of these, the booking sends its `label` as the free-text
 * pickupArea/dropoffArea and the server re-derives the region (zero-trust). Keep IN SYNC with
 * `area_region()` whenever places are added/reclassified.
 */
export interface TransferLocation {
  /** Stable id (kebab) — only for React keys / dedupe; not sent to the server. */
  id: string;
  /** Display + the exact text sent as the free-text area (so `areaRegion(label)` === `region`). */
  label: string;
  region: TransferRegion;
}

export const TRANSFER_LOCATIONS: TransferLocation[] = [
  // North
  { id: 'grand-baie', label: 'Grand Baie', region: 'North' },
  { id: 'pereybere', label: 'Pereybère', region: 'North' },
  { id: 'cap-malheureux', label: 'Cap Malheureux', region: 'North' },
  { id: 'trou-aux-biches', label: 'Trou aux Biches', region: 'North' },
  { id: 'mont-choisy', label: 'Mont Choisy', region: 'North' },
  { id: 'pointe-aux-canonniers', label: 'Pointe aux Canonniers', region: 'North' },
  { id: 'balaclava', label: 'Balaclava', region: 'North' },
  { id: 'pointe-aux-piments', label: 'Pointe aux Piments', region: 'North' },
  { id: 'grand-gaube', label: 'Grand Gaube', region: 'North' },
  { id: 'port-louis', label: 'Port Louis', region: 'North' },
  // East
  { id: 'belle-mare', label: 'Belle Mare', region: 'East' },
  { id: 'trou-deau-douce', label: "Trou d'Eau Douce", region: 'East' },
  { id: 'palmar', label: 'Palmar', region: 'East' },
  { id: 'poste-lafayette', label: 'Poste Lafayette', region: 'East' },
  { id: 'roches-noires', label: 'Roches Noires', region: 'East' },
  { id: 'centre-de-flacq', label: 'Centre de Flacq', region: 'East' },
  // South
  { id: 'mahebourg', label: 'Mahébourg', region: 'South' },
  { id: 'blue-bay', label: 'Blue Bay', region: 'South' },
  { id: 'pointe-desny', label: "Pointe d'Esny", region: 'South' },
  { id: 'bel-ombre', label: 'Bel Ombre', region: 'South' },
  { id: 'souillac', label: 'Souillac', region: 'South' },
  { id: 'chamarel', label: 'Chamarel', region: 'South' },
  { id: 'grand-port', label: 'Grand Port', region: 'South' },
  // West
  { id: 'flic-en-flac', label: 'Flic en Flac', region: 'West' },
  { id: 'tamarin', label: 'Tamarin', region: 'West' },
  { id: 'riviere-noire', label: 'Rivière Noire (Black River)', region: 'West' },
  { id: 'le-morne', label: 'Le Morne', region: 'West' },
  { id: 'wolmar', label: 'Wolmar', region: 'West' },
  { id: 'albion', label: 'Albion', region: 'West' },
  { id: 'la-gaulette', label: 'La Gaulette', region: 'West' },
  // Central
  { id: 'curepipe', label: 'Curepipe', region: 'Central' },
  { id: 'quatre-bornes', label: 'Quatre Bornes', region: 'Central' },
  { id: 'moka', label: 'Moka', region: 'Central' },
  { id: 'vacoas', label: 'Vacoas', region: 'Central' },
  { id: 'ebene', label: 'Ébène', region: 'Central' },
  { id: 'rose-hill', label: 'Rose Hill', region: 'Central' },
];
