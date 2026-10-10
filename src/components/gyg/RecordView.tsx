'use client';

import { useEffect } from 'react';
import { recordRecentView } from '@/lib/recent/views';

/** Records a viewed activity slug (most-recent-first, deduped, capped) so the home
 *  page's "Continue planning" rail can resurface it. Renders nothing. */
export function RecordView({ slug }: { slug: string }) {
  useEffect(() => {
    recordRecentView(slug);
  }, [slug]);

  return null;
}
