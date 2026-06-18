export interface LngLat {
  lat: number;
  lng: number;
}

/** Pick-up bases (ported from the design). The customer's exact pickup is taken at checkout; this
 *  drives the route drawing + the "from pick-up" / "return to pick-up" drive times. */
export interface Pickup extends LngLat {
  id: string;
  name: string;
}
export const PICKUPS: Pickup[] = [
  { id: 'belleMare', name: 'Belle Mare (our base)', lat: -20.205, lng: 57.76 },
  { id: 'grandBaie', name: 'Grand Baie hotels', lat: -20.012, lng: 57.582 },
  { id: 'portLouis', name: 'Port Louis', lat: -20.161, lng: 57.501 },
  { id: 'airport', name: 'SSR Airport', lat: -20.43, lng: 57.683 },
  { id: 'leMorne', name: 'Le Morne hotels', lat: -20.45, lng: 57.323 },
];

/** Ready-made road trips. `stops` are REAL planner_places ids (resolved at runtime). */
export interface Preset {
  id: string;
  name: string;
  stops: string[];
  grad: string;
}
export const PRESETS: Preset[] = [
  {
    id: 'south',
    name: 'South in a Day',
    stops: ['le-morne-beach', 'chamarel-waterfall', 'chamarel-seven-coloured-earth', 'maconde-viewpoint'],
    grad: 'linear-gradient(135deg,#0E8C92,#0B5C63)',
  },
  {
    id: 'north',
    name: 'North Highlights',
    stops: ['cap-malheureux-church', 'grand-baie-beach', 'pamplemousses-botanical-garden'],
    grad: 'linear-gradient(135deg,#13A0A6,#0E8C92)',
  },
  {
    id: 'east',
    name: 'East & Island Escape',
    stops: ['belle-mare-beach', 'ile-aux-cerfs'],
    grad: 'linear-gradient(135deg,#F5A623,#C98A12)',
  },
];

export const PLACE_CATEGORIES = [
  'All', 'Beach', 'Waterfall', 'Viewpoint', 'Nature', 'Culture', 'Garden', 'Island', 'Landmark', 'Market',
];
export const PLACE_REGIONS = ['All', 'North', 'South', 'East', 'West', 'Central'];

/** Per-category hue for the colourful gradient thumbnails (the design's `hue`). */
const CATEGORY_HUE: Record<string, number> = {
  Beach: 191, Waterfall: 196, Viewpoint: 205, Nature: 135, Culture: 268,
  Garden: 108, Island: 184, Market: 28, Landmark: 6, Food: 30,
};

/** Stable hue for a place (category first, else a hash of the id). */
export function hueFor(place: { id: string; category: string }): number {
  if (CATEGORY_HUE[place.category] != null) return CATEGORY_HUE[place.category]!;
  let h = 0;
  for (let i = 0; i < place.id.length; i += 1) h = (h * 31 + place.id.charCodeAt(i)) % 360;
  return h;
}

/** The design's two-stop gradient for a thumbnail. */
export function thumbGradient(hue: number): string {
  return `linear-gradient(150deg, hsl(${hue} 55% 62%), hsl(${(hue + 28) % 360} 48% 42%))`;
}

/** Deterministic ~4.5–4.9 rating for a place (the design's display cue). */
export function ratingFor(place: { id: string; category: string }): string {
  return (4.5 + (hueFor(place) % 5) / 10).toFixed(1);
}

/** Duration formatter: "45 min" / "2h" / "2h 30". */
export function fmtDur(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${String(m).padStart(2, '0')}` : `${h}h`;
}
