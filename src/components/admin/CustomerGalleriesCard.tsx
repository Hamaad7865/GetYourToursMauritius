'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addGalleryPhotos,
  loadCustomerGalleries,
  loadGalleryPhotos,
  removeGalleryPhoto,
  sendGalleryLink,
  type CustomerGalleryRow,
} from '@/lib/admin/photography';
import { prepareZipPhotos } from '@/lib/admin/gallery-zip';
import { PNotice, P_BTN_SMALL, P_BTN_SMALL_GHOST, PSection } from '@/components/admin/photo-kit';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';

/**
 * One gallery per photography booking. The studio uploads the finished photos here (they land in
 * the public activity-images bucket under galleries/<ref>/), then "Send gallery link" emails the
 * guest their private gallery (/bookings/:ref#gallery). Rows without photos can't be sent yet.
 */
export function CustomerGalleriesCard() {
  const [rows, setRows] = useState<CustomerGalleryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Record<string, { id: string; url: string }[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /** Live upload progress (done/total); total 0 while the ZIP is being prepared. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [sent, setSent] = useState<Record<string, { url: string; emailed: boolean }>>({});

  const load = useCallback(async () => {
    try {
      setRows(await loadCustomerGalleries());
      setError(null);
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Could not load galleries.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(ref: string, bookingId: string) {
    if (openRef === ref) {
      setOpenRef(null);
      return;
    }
    setOpenRef(ref);
    if (photos[ref]) return;
    try {
      const list = await loadGalleryPhotos(bookingId);
      setPhotos((cur) => ({ ...cur, [ref]: list }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the gallery.');
    }
  }

  async function refreshPhotos(row: CustomerGalleryRow) {
    const list = await loadGalleryPhotos(row.bookingId);
    setPhotos((cur) => ({ ...cur, [row.ref]: list }));
    await load();
  }

  async function upload(row: CustomerGalleryRow, files: FileList | null) {
    if (!files?.length || uploading) return;
    setUploading(true);
    setProgress(null);
    setError(null);
    try {
      await addGalleryPhotos(row.ref, row.bookingId, Array.from(files), (done, total) =>
        setProgress({ done, total }),
      );
      await refreshPhotos(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the photos.');
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function uploadZip(row: CustomerGalleryRow, file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setProgress({ done: 0, total: 0 });
    setError(null);
    try {
      // The browser unzips first, then the files go up through the normal gallery path with
      // live progress. Full quality — nothing is downscaled or recompressed.
      const { files, picked, skipped } = await prepareZipPhotos(file, file.name);
      if (!files.length) {
        setError(
          picked === 0
            ? 'No photos or videos found in that ZIP — it needs image or video files.'
            : 'None of the ZIP’s files could be used.',
        );
        return;
      }
      await addGalleryPhotos(row.ref, row.bookingId, files, (done, total) =>
        setProgress({ done, total }),
      );
      await refreshPhotos(row);
      if (skipped > 0) {
        setError(
          `${files.length} files uploaded, ${skipped} skipped (not media, or over the cap).`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that ZIP file.');
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  async function remove(row: CustomerGalleryRow, photoId: string) {
    setError(null);
    try {
      await removeGalleryPhoto(photoId);
      await refreshPhotos(row);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the photo.');
    }
  }

  async function send(row: CustomerGalleryRow) {
    setBusy(row.ref);
    setError(null);
    try {
      const result = await sendGalleryLink(row.ref);
      setSent((cur) => ({ ...cur, [row.ref]: result }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the gallery link.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PSection
      title="Customer galleries"
      description={
        <>
          Upload each shoot’s finished photos here, then press <b>Send gallery link</b> — the guest
          gets an email with a link to their private gallery on their booking page.
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <PNotice tone="error">{error}</PNotice>
        </div>
      )}
      {rows === null ? (
        <div className="space-y-2.5">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-xl border border-ink/10 bg-teal-tint/30"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-ink/15 bg-teal-tint/40 px-5 py-6 text-center text-[13px] font-medium text-ink-muted">
          No confirmed photography bookings right now.
        </p>
      ) : (
        <ul className="divide-y divide-ink/5">
          {rows.map((r) => {
            const done = sent[r.ref];
            const isOpen = openRef === r.ref;
            return (
              <li key={r.ref} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void open(r.ref, r.bookingId)}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink">
                        {r.customerName} · {r.packageTitle}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {r.ref}
                        {r.shootDate
                          ? ` · shoot ${new Date(r.shootDate).toLocaleDateString('en-GB', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                              timeZone: 'Indian/Mauritius',
                            })}`
                          : ''}{' '}
                        · {r.photoCount === 0 ? 'no photos yet' : `${r.photoCount} photos`}
                      </p>
                    </span>
                    <IconChevron
                      width={16}
                      height={16}
                      aria-hidden
                      className={`shrink-0 text-ink-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={busy === r.ref || r.photoCount === 0}
                    onClick={() => void send(r)}
                    title={
                      r.photoCount === 0 ? 'Upload photos first' : 'Email the guest their gallery'
                    }
                    className={P_BTN_SMALL}
                  >
                    {busy === r.ref ? 'Sending…' : done ? 'Send again' : 'Send gallery link'}
                  </button>
                </div>
                {done && (
                  <p className="mt-1 text-xs font-semibold text-teal-dark">
                    {done.emailed
                      ? `Emailed to ${r.customerEmail}.`
                      : `Email not sent — share this link with the guest: ${done.url}`}
                  </p>
                )}
                {isOpen && (
                  <div className="mt-3 rounded-xl border border-ink/10 bg-teal-tint/40 p-3.5">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                      {(photos[r.ref] ?? []).map((p) => (
                        <span
                          key={p.id}
                          className="relative overflow-hidden rounded-xl ring-1 ring-ink/10"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.url}
                            alt=""
                            loading="lazy"
                            className="aspect-square w-full object-cover"
                          />
                          <button
                            type="button"
                            aria-label="Remove photo"
                            onClick={() => void remove(r, p.id)}
                            className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-ink/70 text-white transition hover:bg-coral"
                          >
                            <IconX width={12} height={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <label
                        className={`${P_BTN_SMALL} cursor-pointer ${uploading ? 'opacity-50' : ''}`}
                      >
                        <IconPlus width={14} height={14} />{' '}
                        {uploading ? 'Uploading…' : 'Upload photos'}
                        <input
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          disabled={uploading}
                          className="sr-only"
                          onChange={(e) => {
                            void upload(r, e.target.files);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      <label
                        className={`${P_BTN_SMALL_GHOST} cursor-pointer ${uploading ? 'opacity-50' : ''}`}
                        title="One ZIP with the whole shoot — photos and videos, uploaded at full quality"
                      >
                        <IconPlus width={14} height={14} /> Upload ZIP
                        <input
                          type="file"
                          accept=".zip,application/zip,application/x-zip-compressed"
                          disabled={uploading}
                          className="sr-only"
                          onChange={(e) => {
                            void uploadZip(r, e.target.files?.[0]);
                            e.target.value = '';
                          }}
                        />
                      </label>
                      {uploading && (
                        <span className="text-xs font-semibold text-teal-dark" role="status">
                          {progress && progress.total > 0
                            ? `Uploading ${progress.done}/${progress.total}…`
                            : 'Preparing photos…'}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PSection>
  );
}
