/* Element ids the homepage's pieces use to find each other. Kept in a dependency-free module so the
 * client header can import one without dragging a server component into its bundle. */

/** Wraps the hero's search field. While it is on screen the hero owns the search; once it scrolls
 *  under the header, the header's compact copy takes over (see GygHeader `searchDocksOnScroll`). */
export const HERO_SEARCH_ID = 'hero-search';
