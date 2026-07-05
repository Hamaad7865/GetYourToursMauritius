'use client';

import { useState } from 'react';
import { IconDocument } from '@/components/ui/icons';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Price-list PDF for an activity. The PDF is NEVER auto-loaded: landing on the page shows only a card
 * (label + View + Open/download). The embedded viewer is rendered ONLY after the visitor clicks "View
 * price list" — so a PDF-handler browser extension can't hijack an auto-loading iframe into a new tab,
 * and we don't fetch the PDF on every page view. Inline embedding is desktop-only (unreliable on phones
 * + WhatsApp/Instagram browsers); everywhere, the "Open / download" link is the guaranteed path.
 */
export function PriceListViewer({ url, label }: { url: string; label?: string | null }) {
  const [open, setOpen] = useState(false);
  const t = useT();

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink/12 bg-ink/[0.02] p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-coral/10 text-coral">
          <IconDocument width={22} height={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-bold text-ink">{label || t('Price list')}</div>
          <div className="text-[13px] text-ink-muted">{t('PDF document')}</div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="hidden rounded-xl bg-teal px-4 py-2.5 text-[14px] font-bold text-white transition hover:bg-teal-dark lg:inline-flex"
        >
          {open ? t('Hide') : t('View price list')}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-teal/25 bg-teal/[0.06] px-4 py-2.5 text-[14px] font-bold text-teal transition hover:bg-teal/[0.1]"
        >
          {t('Open / download PDF')}
        </a>
      </div>

      {/* Rendered only after an explicit click (desktop) — so nothing loads the PDF on page open. */}
      {open && (
        <div className="mt-3 hidden overflow-hidden rounded-2xl border border-ink/12 bg-ink/[0.02] shadow-sm lg:block">
          <iframe src={`${url}#view=FitH`} title={t('Price list')} className="h-[78vh] w-full" />
        </div>
      )}
    </div>
  );
}
