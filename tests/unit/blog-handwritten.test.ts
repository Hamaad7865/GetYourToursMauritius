import { describe, expect, it } from 'vitest';
import { HANDWRITTEN_POSTS, HANDWRITTEN_POSTS_FR } from '@/lib/content/blog-handwritten';
import { getPost, localisedPost, posts, RELATED_POSTS } from '@/lib/content/blog';

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
