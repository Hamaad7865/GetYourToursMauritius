import { describe, expect, it } from 'vitest';
import { isVideoUrl, videosFirst } from '@/lib/media';

describe('media url detection', () => {
  it('spots uploaded video files and nothing else', () => {
    expect(isVideoUrl('https://cdn.example/v/clip.mp4')).toBe(true);
    expect(isVideoUrl('https://cdn.example/v/CLIP.MOV?token=abc')).toBe(true);
    expect(isVideoUrl('/galleries/a.webm')).toBe(true);
    expect(isVideoUrl('https://cdn.example/p/photo.jpg')).toBe(false);
    expect(isVideoUrl('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isVideoUrl('')).toBe(false);
  });

  it('orders videos before photos, stably', () => {
    const items = [
      { url: 'https://x/a.jpg' },
      { url: 'https://x/b.mp4' },
      { url: 'https://x/c.jpg' },
      { url: 'https://x/d.mov' },
    ];
    expect(videosFirst(items).map((i) => i.url)).toEqual([
      'https://x/b.mp4',
      'https://x/d.mov',
      'https://x/a.jpg',
      'https://x/c.jpg',
    ]);
    expect(videosFirst([])).toEqual([]);
  });
});
