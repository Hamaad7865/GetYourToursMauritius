/** A message in the ZilAi chat. Text bubbles plus the design's rich place + summary cards, and (range
 *  mode) a branded Belle Mare Tours activity recommendation card anchored to a trip date. */
export type ChatMsg =
  | { role: 'user' | 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'place'; id: string; why?: string }
  | { role: 'assistant'; kind: 'summary' }
  /** `date` is null when the visitor hasn't chosen one — the card then invites them to pick, rather
   *  than naming a day nobody selected. */
  | { role: 'assistant'; kind: 'activity'; slug: string; date: string | null };

/** An opening-hours nudge: a stop that closes early sits too late in the order. */
export interface Boost {
  place: string;
  close: string;
  id: string;
}
