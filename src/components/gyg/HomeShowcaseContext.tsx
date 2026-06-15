'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/* Lets the navbar "Activities" item drive the home showcase: clicking it on the homepage
 * swaps the section from Categories to Activities (and scrolls to it). Off the homepage the
 * provider isn't mounted, so `useHomeShowcase()` returns null and the nav item just links. */

export type ShowcaseView = 'categories' | 'activities';

interface ShowcaseCtx {
  view: ShowcaseView;
  setView: (view: ShowcaseView) => void;
}

const Ctx = createContext<ShowcaseCtx | null>(null);

export function HomeShowcaseProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ShowcaseView>('categories');
  return <Ctx.Provider value={{ view, setView }}>{children}</Ctx.Provider>;
}

export function useHomeShowcase(): ShowcaseCtx | null {
  return useContext(Ctx);
}

/** Switch the showcase to a view and scroll it into focus. No-op off the homepage. */
export function showActivitiesOnHome(ctx: ShowcaseCtx | null): boolean {
  if (!ctx) return false;
  ctx.setView('activities');
  document.getElementById('home-showcase')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}
