import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importPhotographyGallery, updatePhotographyPhoto } from '@/lib/admin/photography';
import { PHOTOGRAPHY_GALLERY_DEFAULTS, PHOTO_STOCK } from '@/lib/catalogue/photography';
import { fr } from '@/lib/i18n/messages';

const mock = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  limit: vi.fn(),
  insert: vi.fn(),
}));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({
    from: () => ({
      update: mock.update,
      insert: mock.insert,
      select: () => ({ eq: () => ({ limit: mock.limit }) }),
    }),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.update.mockReturnValue({ eq: mock.eq });
  mock.eq.mockResolvedValue({ error: null });
  mock.limit.mockResolvedValue({ data: [], error: null });
  mock.insert.mockResolvedValue({ error: null });
});

describe('gallery replacement', () => {
  it('updates the same row without changing its categories, caption or order', async () => {
    await updatePhotographyPhoto('photo-id', {
      url: ' /new.jpg ',
      mediaType: 'image',
      posterUrl: null,
    });
    expect(mock.update).toHaveBeenCalledWith({
      url: '/new.jpg',
      media_type: 'image',
      poster_url: null,
    });
    expect(mock.eq).toHaveBeenCalledWith('id', 'photo-id');
  });

  it('rejects invalid links and propagates database errors', async () => {
    await expect(updatePhotographyPhoto('x', { url: 'javascript:alert(1)' })).rejects.toThrow(
      'URL',
    );
    await expect(updatePhotographyPhoto('x', { url: '//external.test/x.jpg' })).rejects.toThrow(
      'URL',
    );
    expect(mock.update).not.toHaveBeenCalled();
    mock.eq.mockResolvedValue({ error: new Error('Write denied') });
    await expect(updatePhotographyPhoto('x', { url: '/new.jpg' })).rejects.toThrow('Write denied');
  });
});

describe('editable sample gallery', () => {
  it('inserts the public sample images together with their captions, order and categories', async () => {
    await importPhotographyGallery();
    const rows = mock.insert.mock.calls[0]![0];
    expect(rows).toHaveLength(PHOTOGRAPHY_GALLERY_DEFAULTS.length);
    for (const [i, photo] of PHOTOGRAPHY_GALLERY_DEFAULTS.entries()) {
      expect(rows[i]).toMatchObject({
        url: PHOTO_STOCK[photo.key],
        alt: photo.alt,
        tags: photo.tags,
        position: i,
        slot: 'gallery',
        media_type: 'image',
      });
      expect(fr[photo.alt]).toBeTruthy();
    }
  });

  it('does not overwrite or duplicate an existing gallery', async () => {
    mock.limit.mockResolvedValue({ data: [{ id: 'existing' }], error: null });
    await importPhotographyGallery();
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('does not insert when the initial read fails', async () => {
    mock.limit.mockResolvedValue({ data: null, error: new Error('Read denied') });
    await expect(importPhotographyGallery()).rejects.toThrow('Read denied');
    expect(mock.insert).not.toHaveBeenCalled();
  });
});
