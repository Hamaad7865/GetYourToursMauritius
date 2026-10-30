'use client';

import { useEffect } from 'react';
import { recordInterest } from '@/lib/recent/interest';

/** Records that the visitor read a guide, with the tours it shows, so the homepage's first row can
 *  lead with them (see chooseHomeRow). Renders nothing. Mirrors <RecordView>. */
export function RecordInterest({ topic, slugs }: { topic: string; slugs: string[] }) {
  // A joined key, so a new array with the same tours does not re-record on every render.
  const key = slugs.join('|');
  useEffect(() => {
    recordInterest(topic, key ? key.split('|') : []);
  }, [topic, key]);

  return null;
}
