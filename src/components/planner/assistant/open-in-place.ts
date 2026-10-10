import type { MouseEvent } from 'react';

/**
 * Whether a click on a link should be handled in place (open the assistant) rather than followed.
 * Anything that asks the browser for a new tab or window — a modifier key, the middle button — is
 * the visitor's own choice and is left alone, so the link keeps working as a link.
 */
export function opensInPlace(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}
