'use client';

import { useEffect } from 'react';

const KEY = 'gytm:recent';

/** Records a viewed activity slug (most-recent-first, deduped, capped) so the home
 *  page's "Continue planning" rail can resurface it. Renders nothing. */
export function RecordView({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      const prev = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as string[];
      const next = [slug, ...prev.filter((s) => s !== slug)].slice(0, 12);
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* ignore storage errors */
    }
  }, [slug]);

  return null;
}
