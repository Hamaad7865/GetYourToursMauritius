import { describe, expect, it } from 'vitest';
import { DEFAULT_POST_TOURS, POST_TOURS, postInterestTopic } from '@/lib/content/tour-links';

/* A blog post tells us what its reader wants only when it has tours of its own. The generic fallback
 * (DEFAULT_POST_TOURS — planning posts: SIM cards, money, entry rules) shows the same three tours to
 * everyone, so recording it would put those three on every reader's homepage. */
describe('postInterestTopic', () => {
  it('names a post that has its own tours', () => {
    expect(POST_TOURS['mauritius-in-december']).toBeDefined();
    expect(postInterestTopic('mauritius-in-december')).toBe('post:mauritius-in-december');
  });

  it('is null for a post on the generic fallback', () => {
    expect(DEFAULT_POST_TOURS.length).toBeGreaterThan(0);
    expect(postInterestTopic('a-post-with-no-tours-of-its-own')).toBeNull();
  });
});
