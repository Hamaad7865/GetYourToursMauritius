/**
 * Fallback shoot-type enquiry cards (WhatsApp "Price on request" cards on /photography when no
 * live package matches). Emptied 2026-09-25 by the owner: only real bookable packages show now.
 * Kept as a typed empty list (with the matcher below) so /admin/photography/new keeps working
 * and a shoot type can be re-added here later without rewiring the callers.
 */
export interface PhotographyShoot {
  key: string;
  title: string;
  summary: string;
  image: string;
  aliases: readonly string[];
}

export const PHOTOGRAPHY_SHOOTS: readonly PhotographyShoot[] = [];

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
