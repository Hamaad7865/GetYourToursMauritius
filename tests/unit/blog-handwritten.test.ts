import { describe, expect, it } from 'vitest';
import { HANDWRITTEN_POSTS, HANDWRITTEN_POSTS_FR } from '@/lib/content/blog-handwritten';
import { formatPostDate, getPost, localisedPost, posts, RELATED_POSTS } from '@/lib/content/blog';

describe('hand-written blog posts', () => {
  it('are merged into the blog with their own publish date', () => {
    for (const hw of HANDWRITTEN_POSTS) {
      const p = getPost(hw.slug);
      expect(p).not.toBeNull();
      expect(p!.datePublished).toBe(hw.datePublished);
      expect(p!.path).toBe(`/blog/${hw.slug}`);
    }
    expect(new Set(posts.map((p) => p.slug)).size).toBe(posts.length);
  });

  it('format dates in the reader’s language', () => {
    expect(formatPostDate('2026-10-17')).toBe('17 October 2026');
    expect(formatPostDate('2026-10-17', 'fr')).toBe('17 octobre 2026');
    expect(formatPostDate('2026-08-01', 'fr')).toBe('1er août 2026');
  });

  it('take over a generated post without moving any other post’s date', () => {
    const december = getPost('mauritius-in-december')!;
    expect(december.title).toMatch(/2026/);
    expect(december.dateModified).toBe('2026-10-17');
    // Generated dates come from the index in _blog.gen.ts: the first and the post after the replaced
    // one must keep theirs (2026-06-17, then 5 days apart).
    expect(getPost('best-time-to-visit-mauritius')!.datePublished).toBe('2026-06-17');
    const after = posts.filter((p) => p.datePublished === '2026-01-23');
    expect(after).toHaveLength(1);
  });

  it('carry a French overlay that matches the English section layout', () => {
    for (const hw of HANDWRITTEN_POSTS) {
      const fr = HANDWRITTEN_POSTS_FR[hw.slug]!;
      expect(fr.sections).toHaveLength(hw.sections.length);
      fr.sections!.forEach((s, i) =>
        expect(s.paragraphs).toHaveLength(hw.sections[i]!.paragraphs.length),
      );
      expect(fr.faq).toHaveLength(hw.faq.length);
      const localised = localisedPost(getPost(hw.slug)!, 'fr');
      expect(localised.title).toBe(fr.title);
    }
  });

  it('link French prose only to French URLs', () => {
    for (const fr of Object.values(HANDWRITTEN_POSTS_FR)) {
      const hrefs = fr.sections!.flatMap((s) =>
        s.paragraphs.flatMap((para) => Array.from(para.matchAll(/\]\((\/[^)]*)\)/g), (m) => m[1])),
      );
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) expect(href).toMatch(/^\/fr\//);
    }
  });

  it('only names related posts that exist', () => {
    for (const [slug, related] of Object.entries(RELATED_POSTS)) {
      expect(getPost(slug)).not.toBeNull();
      for (const r of related) expect(getPost(r)).not.toBeNull();
    }
  });
});
