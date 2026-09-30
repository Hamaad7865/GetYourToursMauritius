'use client';

import { useEffect, useState } from 'react';
import { IconCheck, IconDownload, IconX } from '@/components/ui/icons';
import { isVideoUrl } from '@/lib/media';
import type { GalleryPhoto, TFn, ZipQuality } from '@/lib/booking/gallery-view';

/**
 * "Download all" dialog: one ZIP, quality choice (originals vs web-size recompress) and
 * photos/videos include toggles. Esc closes (mousedown on the backdrop too, per the handoff).
 */

export function DownloadAllDialog({
  t,
  photos,
  onConfirm,
  onClose,
}: {
  t: TFn;
  photos: readonly GalleryPhoto[];
  onConfirm: (quality: ZipQuality, includePhotos: boolean, includeVideos: boolean) => void;
  onClose: () => void;
}) {
  const [quality, setQuality] = useState<ZipQuality>('originals');
  const [includePhotos, setIncludePhotos] = useState(true);
  const [includeVideos, setIncludeVideos] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const videos = photos.filter((p) => isVideoUrl(p.url)).length;
  const photoN = photos.length - videos;
  const included = (includePhotos ? photoN : 0) + (includeVideos ? videos : 0);

  const qualities: Array<{ id: ZipQuality; label: string; sub: string }> = [
    { id: 'originals', label: t('Originals'), sub: t('Full resolution, for printing and editing') },
    { id: 'web', label: t('Web size'), sub: t('Smaller files, for sharing online') },
  ];
  const includes: Array<{ on: boolean; label: string; toggle: () => void }> = [
    {
      on: includePhotos,
      label: t('Photos ({n})', { n: photoN }),
      toggle: () => setIncludePhotos((v) => !v),
    },
    {
      on: includeVideos,
      label: t('Videos ({n})', { n: videos }),
      toggle: () => setIncludeVideos((v) => !v),
    },
  ];

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
        aria-label={t('Download all')}
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
          <h2 className="m-0 text-2xl font-semibold text-ink">{t('Download all')}</h2>
          <p className="m-0 text-sm text-ink-muted">
            {t('One ZIP file with everything you choose below.')}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {qualities.map((q) => {
            const on = quality === q.id;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setQuality(q.id)}
                aria-pressed={on}
                className={`flex items-center gap-3.5 rounded-xl border-[1.5px] px-4 py-3.5 text-left transition ${
                  on ? 'border-teal bg-teal-tint' : 'border-ink/15 bg-white hover:border-ink/30'
                }`}
              >
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] ${
                    on ? 'border-teal' : 'border-ink/25'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${on ? 'bg-teal' : 'bg-transparent'}`}
                  />
                </span>
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="text-[15px] font-bold text-ink">{q.label}</span>
                  <span className="text-[13px] text-ink-muted">{q.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-bold text-ink">{t('Include')}</span>
          <div className="flex flex-wrap gap-2">
            {includes.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={c.toggle}
                aria-pressed={c.on}
                className={`flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  c.on
                    ? 'border-ink bg-ink text-white'
                    : 'border-ink/15 bg-white text-ink hover:border-ink/40'
                }`}
              >
                <span
                  className={`grid h-[18px] w-[18px] place-items-center rounded-full border-[1.5px] ${
                    c.on ? 'border-white/50 text-white' : 'border-ink/25 text-ink'
                  }`}
                >
                  <IconCheck
                    width={11}
                    height={11}
                    strokeWidth={3}
                    className={c.on ? 'opacity-100' : 'opacity-0'}
                  />
                </span>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          disabled={!included}
          onClick={() => onConfirm(quality, includePhotos, includeVideos)}
          className={`flex items-center justify-center gap-2.5 rounded-xl bg-teal-dark px-4 py-3.5 text-[15px] font-bold text-white transition hover:bg-teal disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <IconDownload width={18} height={18} />
          {included ? t('Download ZIP · {n} files', { n: included }) : t('Choose what to include')}
        </button>
        <p className="-mt-2 mb-0 text-center text-[12.5px] text-ink-muted">
          {t('You can keep browsing while we prepare it. Wi-Fi recommended.')}
        </p>
      </div>
    </div>
  );
}
