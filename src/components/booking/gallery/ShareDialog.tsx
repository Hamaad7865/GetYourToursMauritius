'use client';

import { useEffect, useState } from 'react';
import { IconLink, IconX } from '@/components/ui/icons';
import type { TFn } from '@/lib/booking/gallery-view';

/**
 * "Share your gallery" dialog: copies the booking-page #gallery link, or hands it to WhatsApp /
 * the mail client. Esc closes; backdrop mousedown closes too. (No guest-download toggle — the
 * gallery is owner-gated by sign-in, so there is nothing to switch off.)
 */

export function ShareDialog({ t, onClose }: { t: TFn; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const link = typeof window === 'undefined' ? '' : `${window.location.href.split('#')[0]}#gallery`;

  const copy = () => {
    try {
      void navigator.clipboard?.writeText(link).catch(() => {});
    } catch {
      /* clipboard unavailable — the label still flips, the link stays selectable */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="animate-gallery-fade-in fixed inset-0 z-[260] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Share your gallery')}
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-float-in relative flex w-full max-w-[460px] flex-col gap-[18px] rounded-2xl bg-white p-7 shadow-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-muted transition hover:bg-ink/5 hover:text-ink"
        >
          <IconX width={18} height={18} />
        </button>
        <div className="flex flex-col gap-1 pr-8">
          <h2 className="m-0 text-2xl font-semibold text-ink">{t('Share your gallery')}</h2>
          <p className="m-0 text-sm leading-relaxed text-ink-muted">
            {t('Share your booking link — your gallery is at the bottom of your booking page.')}
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-ink/15 py-1.5 pl-3.5 pr-1.5">
          <IconLink width={16} height={16} className="flex-none text-ink-muted" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{link}</span>
          <button
            type="button"
            onClick={copy}
            className={`flex-none rounded-lg px-3.5 py-2 text-[13px] font-bold text-white transition ${
              copied ? 'bg-teal' : 'bg-ink hover:bg-ink/85'
            }`}
          >
            {copied ? t('Copied') : t('Copy link')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(`${t('Our photos from Mauritius')}: ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-[150px] flex-1 rounded-xl border border-ink/15 px-3 py-3 text-center text-sm font-bold text-ink transition hover:border-ink"
          >
            {t('Send on WhatsApp')}
          </a>
          <a
            href={`mailto:?subject=${encodeURIComponent(t('Our photos from Mauritius'))}&body=${encodeURIComponent(link)}`}
            className="min-w-[150px] flex-1 rounded-xl border border-ink/15 px-3 py-3 text-center text-sm font-bold text-ink transition hover:border-ink"
          >
            {t('Send by email')}
          </a>
        </div>
      </div>
    </div>
  );
}
