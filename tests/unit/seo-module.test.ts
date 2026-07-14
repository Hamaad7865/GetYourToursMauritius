import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';

/* The SEO module's pure/mockable pieces: the metadata-override merge (an /admin/seo row beats the
 * built-in defaults, errors fall back), the redirect-input validation, and the blog DB-over-gen
 * merge (a DB post replaces the seed post with the same slug; the seed survives a DB outage). */

vi.mock('@/lib/services/seo', () => ({
  getSeoMeta: vi.fn(),
  listDbPosts: vi.fn(),
  getDbPost: vi.fn(),
  lookupRedirect: vi.fn(),
}));
vi.mock('@/lib/http/context', () => ({
  publicServiceContext: () => ({ db: { rpc: vi.fn() } }),
}));

import { getSeoMeta, listDbPosts, getDbPost } from '@/lib/services/seo';
import { overrideMetadata } from '@/lib/seo/override';
import { redirectFromPathError } from '@/lib/validation/seo';
import { loadPosts, loadPost } from '@/lib/content/blog-live';
import { posts as genPosts } from '@/lib/content/blog';

const DEFAULTS: Metadata = {
  title: { absolute: 'Default Title' },
  description: 'Default description',
  alternates: { canonical: '/rent' },
  openGraph: {
    type: 'website',
    title: 'Default Title',
    description: 'Default description',
    locale: 'en_GB',
  },
};

beforeEach(() => {
  vi.mocked(getSeoMeta).mockReset();
  vi.mocked(listDbPosts).mockReset();
  vi.mocked(getDbPost).mockReset();
});

describe('overrideMetadata', () => {
  it('returns the defaults untouched when there is no override', async () => {
    vi.mocked(getSeoMeta).mockResolvedValue(null);
    expect(await overrideMetadata('/rent', DEFAULTS)).toBe(DEFAULTS);
  });

  it('merges title + description over the defaults (absolute title, OG kept in sync)', async () => {
    vi.mocked(getSeoMeta).mockResolvedValue({
      path: '/rent',
      title: 'Override Title',
      description: 'Override description',
      ogImageUrl: null,
    });
    const m = await overrideMetadata('/rent', DEFAULTS);
    expect(m.title).toEqual({ absolute: 'Override Title' });
    expect(m.description).toBe('Override description');
    const og = m.openGraph as Record<string, unknown>;
    expect(og.title).toBe('Override Title');
    expect(og.description).toBe('Override description');
    expect(og.locale).toBe('en_GB'); // untouched default OG fields survive
    expect(m.alternates).toEqual({ canonical: '/rent' }); // canonical never overridden
  });

  it('a partial override keeps the other defaults (only the OG image swaps)', async () => {
    vi.mocked(getSeoMeta).mockResolvedValue({
      path: '/rent',
      title: null,
      description: null,
      ogImageUrl: 'https://example.com/photo.jpg',
    });
    const m = await overrideMetadata('/rent', DEFAULTS);
    expect(m.title).toEqual({ absolute: 'Default Title' });
    expect((m.openGraph as { images: unknown }).images).toEqual([
      { url: 'https://example.com/photo.jpg' },
    ]);
  });

  it('falls back to the defaults on any error (an override can never break a page)', async () => {
    vi.mocked(getSeoMeta).mockRejectedValue(new Error('db down'));
    expect(await overrideMetadata('/rent', DEFAULTS)).toBe(DEFAULTS);
  });
});

describe('redirectFromPathError', () => {
  it('accepts a plain site path', () => {
    expect(redirectFromPathError('/old-tour', '/mauritius-tours')).toBeNull();
  });
  it.each([
    ['no-slash', '/x', 'must start'],
    ['/', '/x', 'homepage'],
    ['/a?b=1', '/x', 'plain path'],
    ['/a#frag', '/x', 'plain path'],
    ['/same', '/same', 'the same'],
  ])('rejects %s → %s', (from, to, snippet) => {
    expect(redirectFromPathError(from, to)).toContain(snippet);
  });
  it('rejects an external destination', () => {
    expect(redirectFromPathError('/old', 'https://evil.example')).toContain('path on this site');
  });
});

describe('blog-live merge', () => {
  const dbSummary = {
    slug: genPosts[0]!.slug, // clashes with the first seed post — DB must win
    title: 'DB version wins',
    metaTitle: null,
    metaDescription: null,
    excerpt: 'From the database',
    readMins: 7,
    heroImageUrl: null,
    datePublished: '2026-07-10',
  };

  it('a DB post replaces the seed post with the same slug; the rest survive', async () => {
    vi.mocked(listDbPosts).mockResolvedValue([dbSummary]);
    const all = await loadPosts();
    expect(all.filter((p) => p.slug === dbSummary.slug)).toHaveLength(1);
    expect(all.find((p) => p.slug === dbSummary.slug)?.title).toBe('DB version wins');
    expect(all.length).toBe(genPosts.length); // one replaced, none lost
  });

  it('the seed posts still render when the DB read throws', async () => {
    vi.mocked(listDbPosts).mockRejectedValue(new Error('db down'));
    const all = await loadPosts();
    expect(all.length).toBe(genPosts.length);
    expect(all.map((p) => p.slug).sort()).toEqual(genPosts.map((p) => p.slug).sort());
  });

  it('loadPost prefers the DB post and falls back to the seed', async () => {
    vi.mocked(getDbPost).mockResolvedValue({
      ...dbSummary,
      sections: [{ heading: 'H', paragraphs: ['P'] }],
      faq: [],
      status: 'published',
    });
    const p = await loadPost(dbSummary.slug);
    expect(p?.title).toBe('DB version wins');
    expect(p?.sections).toHaveLength(1);

    vi.mocked(getDbPost).mockResolvedValue(null);
    const seed = await loadPost(genPosts[1]!.slug);
    expect(seed?.title).toBe(genPosts[1]!.title);
  });
});
