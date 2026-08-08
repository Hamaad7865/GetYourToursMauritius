/** The planner conversation's message shapes. Pure data — kept in `lib` (not with the components)
 *  so the history serializer can own the same type the chat renders, with no drift between them. */

/** A message in the ZilAi chat. Text bubbles plus the design's rich place + summary cards, a branded
 *  Belle Mare Tours activity recommendation anchored to a trip date, and a multi-day split ZilAi is
 *  offering the visitor. */
export type ChatMsg =
  | { role: 'user' | 'assistant'; kind: 'text'; text: string }
  | { role: 'assistant'; kind: 'place'; id: string; why?: string }
  | { role: 'assistant'; kind: 'summary' }
  /** `date` is null when the visitor hasn't chosen one — the card then invites them to pick, rather
   *  than naming a day nobody selected. */
  | { role: 'assistant'; kind: 'activity'; slug: string; date: string | null }
  /** A proposed multi-day split. Rendered as a card; accepting it is what creates the trip. */
  | { role: 'assistant'; kind: 'trip-proposal'; proposal: TripProposal };

/** One day of a proposed split, as the client stores it. Mirrors the agent's `ProposedTripDay`. */
export interface TripProposalDay {
  date: string;
  activitySlug: string | null;
  activityTitle: string | null;
  note: string | null;
}

export interface TripProposal {
  from: string;
  to: string;
  days: TripProposalDay[];
}

/** An opening-hours nudge: a stop that closes early sits too late in the order. */
export interface Boost {
  place: string;
  close: string;
  id: string;
}
