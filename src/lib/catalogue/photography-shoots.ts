import { PHOTO_STOCK } from './photography';

export const PHOTOGRAPHY_SHOOTS = [
  {
    key: 'holiday',
    title: 'Holiday',
    summary: 'A relaxed photo session to remember your time in Mauritius.',
    image: PHOTO_STOCK.couple,
    aliases: ['holiday'],
  },
  {
    key: 'beach-shoot',
    title: 'Beach shoot',
    summary: 'Portraits by the lagoon, with the sand and sea as your backdrop.',
    image: PHOTO_STOCK.hero,
    aliases: ['beach-shoot', 'beach-shooting'],
  },
  {
    key: 'trip-explorer',
    title: 'Trip explorer',
    summary: 'Plan a photo outing around the island locations you would like to explore.',
    image: PHOTO_STOCK.passe,
    aliases: ['trip-explorer', 'trip-explorer-photo-experience'],
  },
  {
    key: 'babymoon',
    title: 'Babymoon',
    summary: 'An unhurried maternity session to celebrate the next chapter of your family.',
    image: PHOTO_STOCK.family2,
    aliases: ['babymoon'],
  },
  {
    key: 'proposal',
    title: 'Proposal',
    summary:
      'Plan the surprise together and capture the moment, followed by portraits as a couple.',
    image: PHOTO_STOCK.weddingSunset,
    aliases: ['proposal'],
  },
  {
    key: 'family-kids',
    title: 'Family & kids',
    summary: 'Natural family photographs with time for the little ones to be themselves.',
    image: PHOTO_STOCK.family,
    aliases: ['family', 'family-kids', 'family-and-kids'],
  },
  {
    key: 'boat-row',
    title: 'Boat row',
    summary: 'A waterside portrait session with a rowboat setting, arranged on request.',
    image: PHOTO_STOCK.aerial,
    aliases: ['boat-row'],
  },
  {
    key: 'fashion',
    title: 'Fashion',
    summary: 'An editorial portrait session built around your outfits, style and chosen location.',
    image: PHOTO_STOCK.weddingDetail,
    aliases: ['fashion'],
  },
] as const;

export type PhotographyShoot = (typeof PHOTOGRAPHY_SHOOTS)[number];

/** Match existing renamed packages too, without creating a second card for the same shoot. */
export function matchesPhotographyShoot(
  shoot: PhotographyShoot,
  activity: { slug: string; title: string },
): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return [shoot.key, shoot.title, ...shoot.aliases].some(
    (value) =>
      normalize(value) === normalize(activity.slug) ||
      normalize(value) === normalize(activity.title),
  );
}
