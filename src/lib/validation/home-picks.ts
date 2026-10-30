import { z } from 'zod';

/**
 * GET /activities/picks — the shared data behind the homepage's first row (api_home_picks). The same
 * answer for every visitor, so it is safe to cache at the edge; what to SHOW a visitor is decided in
 * their browser (chooseHomeRow).
 */
export const homePicksSchema = z.object({
  /** Tomorrow in Mauritius, YYYY-MM-DD: the day `freeTomorrow` is about. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Published tours, most confirmed bookings in the last 90 days first. Order only — no counts. */
  mostBooked: z.array(z.string()),
  /** Published, bookable-online tours with a free seat on `date`, in catalogue order. */
  freeTomorrow: z.array(z.string()),
});
export type HomePicks = z.infer<typeof homePicksSchema>;
