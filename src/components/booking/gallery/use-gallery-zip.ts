'use client';

import { useCallback, useRef, useState } from 'react';
import JSZip from 'jszip';
import type { TFn, ZipEntrySpec, ZipQuality } from '@/lib/booking/gallery-view';

/**
 * Client-side "Download all": fetches each media URL, optionally recompresses photos to a
 * web-size JPEG, packs everything into ONE JSZip archive and hands the blob to the browser.
 * Progress surfaces through the returned job so the caller can render the design's zip toast;
 * the finished archive downloads itself (no extra Save step — the browser owns the file dialog).
 */

export interface ZipJob {
  name: string;
  total: number;
  done: number;
  status: 'running' | 'done' | 'error';
}

export const WEB_SIZE_MAX_PX = 2048;
export const WEB_SIZE_JPEG_QUALITY = 0.85;

/**
 * Photo → max-side 2048px JPEG. Canvas needs CORS-clean pixels; when the fetch or decode fails
 * (opaque response, huge bitmap), the ORIGINAL bytes go in the zip instead — a working download
 * always beats a perfect one.
 */
async function downscaleToWeb(blob: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, WEB_SIZE_MAX_PX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        WEB_SIZE_JPEG_QUALITY,
      );
    });
  } catch {
    return blob;
  }
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has had a chance to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function useGalleryZip(): {
  job: ZipJob | null;
  /** Pack `entries` into `name` and trigger the download. Fire-and-forget. */
  run: (entries: ZipEntrySpec[], quality: ZipQuality, name: string) => void;
  dismiss: () => void;
} {
  const [job, setJob] = useState<ZipJob | null>(null);
  const jobRef = useRef<ZipJob | null>(null);
  jobRef.current = job;

  const dismiss = useCallback(() => setJob(null), []);

  const run = useCallback((entries: ZipEntrySpec[], quality: ZipQuality, name: string) => {
    if (jobRef.current?.status === 'running') return; // one zip at a time
    if (!entries.length) return;
    void (async () => {
      setJob({ name, total: entries.length, done: 0, status: 'running' });
      try {
        const zip = new JSZip();
        for (const entry of entries) {
          const res = await fetch(entry.url, { mode: 'cors' });
          let blob: Blob = await res.blob();
          if (!entry.video && quality === 'web') blob = await downscaleToWeb(blob);
          zip.file(entry.name, blob);
          const done = (jobRef.current?.done ?? 0) + 1;
          setJob((j) => (j && j.status === 'running' ? { ...j, done } : j));
        }
        const archive = await zip.generateAsync({ type: 'blob' });
        saveBlob(archive, name);
        setJob({ name, total: entries.length, done: entries.length, status: 'done' });
        setTimeout(() => {
          setJob((j) => (j?.status === 'done' && j.name === name ? null : j));
        }, 5000);
      } catch {
        setJob((j) =>
          j
            ? { ...j, status: 'error', total: j.total }
            : { name, total: entries.length, done: 0, status: 'error' },
        );
      }
    })();
  }, []);

  return { job, run, dismiss };
}

/** Toast copy for the current job — extracted so the component stays declarative. */
export function zipJobLines(job: ZipJob, t: TFn): { title: string; sub: string } {
  if (job.status === 'error')
    return { title: t('The download failed'), sub: t('Please try again.') };
  if (job.status === 'done') {
    return { title: t('Your ZIP is downloading'), sub: job.name };
  }
  return {
    title: t('Preparing your ZIP'),
    sub: t('{done} of {total} files', { done: job.done, total: job.total }),
  };
}
