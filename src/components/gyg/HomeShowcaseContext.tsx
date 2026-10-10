'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { TourSummary } from '@/lib/validation/tours';

/* Marks that we're rendering the homepage, so the navbar "Activities" item can scroll to the
 * catalogue sections instead of navigating away. Off the homepage the provider isn't mounted,
 * so `useHomeShowcase()` returns null and the nav item just links to /activities.
 *
 * It also carries the catalogue the page fetched on the server, so the homepage's client sections
 * (the "Continue planning" rail, the tabbed rails) read ONE copy instead of each taking the list as
 * its own prop and serialising it twice into the page payload. */

const NO_ACTIVITIES: TourSummary[] = [];
const Ctx = createContext<TourSummary[] | null>(null);

export function HomeShowcaseProvider({
  activities = NO_ACTIVITIES,
  children,
}: {
  activities?: TourSummary[];
  children: ReactNode;
}) {
  return <Ctx.Provider value={activities}>{children}</Ctx.Provider>;
}

export function useHomeShowcase(): boolean | null {
  return useContext(Ctx) ? true : null;
}

/** The homepage's catalogue. Empty off the homepage (and when the catalogue fetch failed). */
export function useHomeActivities(): TourSummary[] {
  return useContext(Ctx) ?? NO_ACTIVITIES;
}

/** Smooth-scroll to the catalogue sections. No-op (returns false) off the homepage. */
export function showActivitiesOnHome(onHome: boolean | null): boolean {
  if (!onHome) return false;
  document.getElementById('home-showcase')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
