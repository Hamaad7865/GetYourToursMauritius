'use client';

import { createContext, useContext, type ReactNode } from 'react';

/* Marks that we're rendering the homepage, so the navbar "Activities" item can scroll to the
 * catalogue sections instead of navigating away. Off the homepage the provider isn't mounted,
 * so `useHomeShowcase()` returns null and the nav item just links to /activities. */

const Ctx = createContext<boolean>(false);

export function HomeShowcaseProvider({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={true}>{children}</Ctx.Provider>;
}

export function useHomeShowcase(): boolean | null {
  return useContext(Ctx) ? true : null;
}

/** Smooth-scroll to the catalogue sections. No-op (returns false) off the homepage. */
export function showActivitiesOnHome(onHome: boolean | null): boolean {
  if (!onHome) return false;
  document.getElementById('home-showcase')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
