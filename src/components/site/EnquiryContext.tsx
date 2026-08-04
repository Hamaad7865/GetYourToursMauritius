'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/** The activity a visitor is looking at when they open the enquiry form. */
export interface EnquiryActivity {
  id: string;
  title: string;
  slug: string;
}

interface EnquiryContextValue {
  activity: EnquiryActivity | null;
  setActivity: (a: EnquiryActivity | null) => void;
}

const EnquiryContext = createContext<EnquiryContextValue | null>(null);

/**
 * Carries the current activity from a PAGE up to ContactFloat, which is mounted in the site layout —
 * above every page in the tree, so props can't reach it. The page publishes into this provider
 * instead (see {@link SetEnquiryContext}), which keeps the title synchronous: the panel shows the
 * right chip the instant it opens, with no extra fetch.
 *
 * Pages that publish nothing leave `activity` null, and ContactFloat falls back to the pathname.
 */
export function EnquiryContextProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<EnquiryActivity | null>(null);
  const value = useMemo(() => ({ activity, setActivity }), [activity]);
  return <EnquiryContext.Provider value={value}>{children}</EnquiryContext.Provider>;
}

/** Null outside the provider, so ContactFloat degrades to a generic form rather than throwing. */
export function useEnquiryActivity(): EnquiryActivity | null {
  return useContext(EnquiryContext)?.activity ?? null;
}

/**
 * Rendered by an activity detail page to publish its activity for the duration of that page. Clears
 * on unmount so navigating to an unrelated page can't leave a stale chip behind — the cleanup is the
 * whole reason this is an effect rather than a render-time write.
 *
 * Renders nothing (same shape as RecordView, which the same page already uses).
 */
export function SetEnquiryContext({ activity }: { activity: EnquiryActivity }) {
  const ctx = useContext(EnquiryContext);
  const setActivity = ctx?.setActivity;
  const { id, title, slug } = activity;

  useEffect(() => {
    if (!setActivity) return;
    setActivity({ id, title, slug });
    return () => setActivity(null);
    // Depend on the FIELDS, not the object: the page rebuilds the literal on every render, which
    // would otherwise clear-and-reset the context in a loop.
  }, [setActivity, id, title, slug]);

  return null;
}
