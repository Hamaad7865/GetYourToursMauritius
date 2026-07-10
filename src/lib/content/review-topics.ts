/** Review relevance buckets. Kept in a leaf module (no imports) so the generated stats + pool files
 *  can share the type without an import cycle. Must mirror TOPIC_PATTERNS in scripts/gen-review-pool.mjs. */
export type ReviewTopic =
  | 'catamaran'
  | 'speedboat'
  | 'dolphin'
  | 'hiking'
  | 'sightseeing'
  | 'transfer'
  | 'rental'
  | 'water'
  | 'air'
  | 'general';
