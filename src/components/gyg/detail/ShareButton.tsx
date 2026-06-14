'use client';

import { useState } from 'react';
import { IconShare } from '@/components/ui/icons';

/** Share via the Web Share API where available, otherwise copy the link. */
export function ShareButton({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      /* user cancelled / unsupported */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="flex items-center gap-2 rounded-xl border border-ink/14 px-3.5 py-2 text-[13.5px] font-semibold text-ink hover:border-teal hover:text-teal"
    >
      <IconShare width={16} height={16} /> {copied ? 'Link copied' : 'Share'}
    </button>
  );
}
