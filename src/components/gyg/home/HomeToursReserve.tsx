import { INTEREST_KEY } from '@/lib/recent/interest';
import { ON_ISLAND_KEY } from '@/lib/recent/on-island';

/* Shared by the row (client) and its pre-paint script (server). No 'use client' here on purpose. */

export const HOME_TOURS_ID = 'home-tours';

/** If hydration never comes (a script error, a very slow phone), the real tiles come back after this. */
const PLACEHOLDER_FAILSAFE_MS = 2500;

/**
 * Runs before first paint: when this browser already holds a reason for a personal row — guides read,
 * or this visit already known to be in Mauritius — it marks the row so the server's tiles are hidden
 * behind same-size placeholders until the client has chosen. Without it a guide reader would watch
 * "Most booked" flash and then be replaced.
 */
const RESERVE_SCRIPT = `(function(){try{var el=document.getElementById('${HOME_TOURS_ID}');if(!el)return;var v=JSON.parse(localStorage.getItem('${INTEREST_KEY}')||'[]');var on=false;try{on=sessionStorage.getItem('${ON_ISLAND_KEY}')==='1'}catch(e){}if((v&&v.length)||on){el.setAttribute('data-personal','on');setTimeout(function(){el.removeAttribute('data-personal')},${PLACEHOLDER_FAILSAFE_MS})}}catch(e){}})()`;

/**
 * The pre-paint half of the row. A SERVER component on purpose: an inline script only executes when it
 * arrives in the HTML. Must sit directly after <HomeToursRow/> in the document.
 */
export function HomeToursReserve() {
  return <script dangerouslySetInnerHTML={{ __html: RESERVE_SCRIPT }} />;
}
