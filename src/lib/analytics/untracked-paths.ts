/**
 * Pages Google Tag Manager never loads on: the back office.
 *
 * Staff work in /admin all day, so tracking it put roughly 230 staff sessions a month into Google
 * Analytics as "Direct" visitors (seen 2026-11-03), drowning the real ones. The GTM bootstrap in
 * `GoogleTagManager.tsx` runs before React, so it tests this pattern itself: one RegExp, whose `.source`
 * is inlined there, and this helper for everything else.
 *
 * A page load decides it. GTM that is already running keeps running if the visitor follows a link into
 * /admin, but no public page links there: staff open the back office directly.
 */
export const UNTRACKED_PATH = /^\/admin(?:\/|$)/;

/** Whether GTM must stay off on this pathname. */
export function isUntrackedPath(pathname: string): boolean {
  return UNTRACKED_PATH.test(pathname);
}
