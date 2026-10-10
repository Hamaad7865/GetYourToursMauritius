/** DOM id of a stop's card in the results canvas. */
export function stopCardId(placeId: string): string {
  return `zilai-stop-${placeId}`;
}

/**
 * Bring a stop's card into view and mark it for a moment. Used wherever a stop is pointed at from
 * somewhere else — its name in ZilAi's reply, its pin on the map, its tile in the map's rail.
 *
 * Deferred a frame because the caller usually opens the canvas (or switches a phone to the Plan tab)
 * in the same breath, and the card cannot be scrolled to until it is laid out.
 */
export function focusStopCard(placeId: string): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const card = document.getElementById(stopCardId(placeId));
    if (!card) return;
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    card.setAttribute('data-flash', 'true');
    window.setTimeout(() => card.removeAttribute('data-flash'), 1600);
  });
}

/** Case-, accent- and punctuation-insensitive key for matching a name ZilAi wrote to a stop. */
export function nameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
