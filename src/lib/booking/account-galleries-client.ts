/**
 * The browser's call to `GET /api/v1/account/galleries`. Two components ask for the same list on the
 * same navigation — the account nav (does the customer have any, so should the Galleries tab exist?)
 * and the Galleries page itself — so concurrent callers with the same access token share ONE request.
 */
import { parseAccountGalleriesResponse, type GalleryCard } from './gallery-cards';

const inFlight = new Map<string, Promise<GalleryCard[] | null>>();

/**
 * The signed-in customer's galleries, or null when the list could not be loaded: a network error, a
 * non-200 answer, or a body that is not the `{ ok, data }` envelope. `[]` means "loaded, none yet".
 */
export function fetchAccountGalleries(accessToken: string): Promise<GalleryCard[] | null> {
  const pending = inFlight.get(accessToken);
  if (pending) return pending;
  const request = fetch('/api/v1/account/galleries', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
    .then(async (res) => (res.ok ? parseAccountGalleriesResponse(await res.json()) : null))
    .catch(() => null)
    .finally(() => {
      inFlight.delete(accessToken);
    });
  inFlight.set(accessToken, request);
  return request;
}
