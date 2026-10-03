import { describe, expect, it } from 'vitest';
import {
  SECTIONS,
  defaultSection,
  isSectionId,
  sectionCount,
  sectionIssues,
  visibleSections,
} from '@/components/admin/activity/sections';
import { EMPTY_ACTIVITY, type ActivityFormValues } from '@/lib/admin/activity-write';

/**
 * The tour editor's pane registry.
 *
 * The editor shows ONE pane at a time, which is what makes these worth guarding: a rule that used
 * to be a visible red paragraph two screens down is now a dot on a rail item, and a pane the
 * restricted 'seo' role must never reach is one `?s=` away. Both failures are silent.
 */

function form(over: Partial<ActivityFormValues> = {}): ActivityFormValues {
  return { ...EMPTY_ACTIVITY, title: 'North Tour', slug: 'north-tour', ...over };
}

const PRIVATE_OPTION = {
  name: 'Private charter',
  durationMinutes: null,
  startWindow: '',
  prices: [],
  isPrivateOption: true,
  privateBaseEur: 90,
  privateIncluded: 4,
  privateExtraEur: 25,
  privateMaxGuests: 8,
};

describe('editor panes', () => {
  it('has no duplicate ids and opens on Basics', () => {
    const ids = SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(defaultSection(false)).toBe('basics');
    expect(defaultSection(true)).toBe('basics');
  });

  it('hides the pricing pane from the restricted content role', () => {
    expect(visibleSections(false).map((s) => s.id)).toContain('pricing');
    expect(visibleSections(true).map((s) => s.id)).not.toContain('pricing');
  });

  it('refuses a ?s=pricing deep link for that role, so it cannot land on a hidden pane', () => {
    expect(isSectionId('pricing', false)).toBe(true);
    expect(isSectionId('pricing', true)).toBe(false);
    expect(isSectionId('nonsense', false)).toBe(false);
    expect(isSectionId(null, false)).toBe(false);
  });

  it('counts what each pane holds', () => {
    const v = form({
      images: [{ url: 'a.jpg', alt: '' }],
      itinerary: [
        { title: 'Port Louis', area: '', description: '', tags: [], options: [] },
        { title: 'Pamplemousses', area: '', description: '', tags: [], options: [] },
      ],
    });
    expect(sectionCount(v, 'media')).toBe(1);
    expect(sectionCount(v, 'itinerary')).toBe(2);
    expect(sectionCount(v, 'basics')).toBeNull();
  });
});

describe('sectionIssues', () => {
  it('is silent on a tour that saves cleanly', () => {
    const v = form({
      options: [
        {
          name: 'Shared',
          durationMinutes: null,
          startWindow: '',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    });
    expect(sectionIssues(v, false)).toEqual({});
  });

  it('points the required fields at Basics', () => {
    expect(sectionIssues(form({ title: '  ' }), false).basics).toMatch(/title/i);
    expect(sectionIssues(form({ slug: '' }), false).basics).toMatch(/slug/i);
  });

  /* The reason this exists: with the old single scroll the private-option-on-a-vehicle-tour
   * conflict was a coral paragraph you eventually scrolled past. Now Pricing may be closed, so the
   * save has to be able to say WHICH pane to open. */
  it('points a pricing rule at the pricing pane, quoting the save path’s own message', () => {
    const v = form({ pricingMode: 'vehicle', options: [PRIVATE_OPTION] });
    expect(sectionIssues(v, false).pricing).toMatch(/private option/i);
    expect(sectionIssues(v, false).basics).toBeUndefined();
  });

  it('catches an under-specified private option before the save does', () => {
    const v = form({ options: [{ ...PRIVATE_OPTION, privateMaxGuests: 2 }] });
    expect(sectionIssues(v, false).pricing).toMatch(/max group size/i);
  });

  /* The seo role's save skips assertPricingValid entirely (RLS blocks the option/price tables), so
   * flagging pricing would put a dot on a pane that role cannot open. */
  it('never flags pricing for the restricted content role', () => {
    const v = form({ pricingMode: 'vehicle', options: [PRIVATE_OPTION] });
    expect(sectionIssues(v, true).pricing).toBeUndefined();
    expect(sectionIssues(form({ title: '' }), true).basics).toMatch(/title/i);
  });

  /* The editor takes uploaded videos and YouTube / Vimeo links as well as photos, but the first image is
   * what every card, search result and share preview shows — a video there is a broken picture. A video
   * list with no photo at all has nothing to put first, so the save has to stop and say which pane. */
  describe('the Photos & files pane', () => {
    const JPG = 'https://x.supabase.co/storage/v1/object/public/activity-images/t/a.jpg';
    const MP4 = 'https://x.supabase.co/storage/v1/object/public/activity-images/t/film.mp4';
    const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const img = (url: string) => ({ url, alt: '' });

    it('flags videos or links with no photo', () => {
      expect(sectionIssues(form({ images: [img(MP4)] }), false).media).toMatch(/photo/i);
      expect(sectionIssues(form({ images: [img(YT), img(MP4)] }), false).media).toMatch(/photo/i);
    });

    it('lets a tour with a photo save, even with a video first (it is moved behind the photo on save)', () => {
      expect(sectionIssues(form({ images: [img(MP4), img(JPG)] }), false).media).toBeUndefined();
      expect(sectionIssues(form({ images: [img(JPG), img(YT)] }), false).media).toBeUndefined();
    });

    it('allows a tour with no photos at all (a draft)', () => {
      expect(sectionIssues(form({ images: [] }), false).media).toBeUndefined();
    });

    it('flags it for the restricted content role too — that role edits the photos', () => {
      expect(sectionIssues(form({ images: [img(MP4)] }), true).media).toMatch(/photo/i);
    });
  });
});
