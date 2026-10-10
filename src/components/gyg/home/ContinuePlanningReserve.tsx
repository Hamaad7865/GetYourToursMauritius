import { RECENT_VIEWS_KEY } from '@/lib/recent/views';

/* Shared by the rail (client) and its pre-paint script (server) so the two can never read different
 * storage keys or target different elements. No 'use client' here on purpose — see below. */

export const CONTINUE_SECTION_ID = 'continue-planning';
export const WISHLIST_KEY = 'gytm:wishlist';
export const CART_KEY = 'gytm:cart';

/**
 * Runs before first paint: if this browser holds anything the "Continue planning" rail would show,
 * it un-hides the server-rendered skeleton so the rail's space is already in the layout when the
 * page first appears. Without it every returning visitor would watch the whole page jump down ~230px
 * at hydration.
 */
const RESERVE_SCRIPT = `(function(){try{var k=['${RECENT_VIEWS_KEY}','${CART_KEY}','${WISHLIST_KEY}'];for(var i=0;i<k.length;i++){var v=JSON.parse(localStorage.getItem(k[i])||'[]');if(v&&v.length){document.getElementById('${CONTINUE_SECTION_ID}').setAttribute('data-on','1');return}}}catch(e){}})()`;

/**
 * The pre-paint half of the rail. A SERVER component on purpose: an inline script only executes when
 * it arrives in the HTML, so rendering it from the client component would do nothing on a client-side
 * navigation and make React warn about it. Must sit directly after <ContinuePlanning/> in the document.
 */
export function ContinuePlanningReserve() {
  return <script dangerouslySetInnerHTML={{ __html: RESERVE_SCRIPT }} />;
}
