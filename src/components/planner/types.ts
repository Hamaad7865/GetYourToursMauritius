/** A message in the ZilAi chat. Text bubbles plus the design's rich place + summary cards, and (range
 *  mode) a branded Belle Mare Tours activity recommendation card anchored to a trip date. */
export type ChatMsg =
  | { role: 'user' | 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'place'; id: string; why?: string }
  | { role: 'assistant'; kind: 'summary' }
  | { role: 'assistant'; kind: 'activity'; slug: string; date: string };

/** An opening-hours nudge: a stop that closes early sits too late in the order. */
export interface Boost {
  place: string;
  close: string;
  id: string;
}
