import { z } from 'zod';

/** One category's standard content, as returned by `api_content_defaults`. Every list defaults to []
 *  so a partially-populated row (e.g. catamaran has no highlights) parses cleanly. */
export const contentDefaultsSchema = z.object({
  highlights: z.array(z.string()).default([]),
  inclusions: z.array(z.string()).default([]),
  exclusions: z.array(z.string()).default([]),
  whatToBring: z.array(z.string()).default([]),
  importantInfo: z.array(z.string()).default([]),
});

/** The whole table, keyed by `activities.category`. */
export const contentDefaultsMapSchema = z.record(z.string(), contentDefaultsSchema);

export type ContentDefaultsInput = z.infer<typeof contentDefaultsSchema>;
