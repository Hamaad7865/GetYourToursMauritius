/** The planner's chat types live in `lib` so the history serializer and the chat share one
 *  definition; re-exported here because every planner component imports them from this path. */
export type { ChatMsg, Boost, TripProposal, TripProposalDay } from '@/lib/planner/chat';
