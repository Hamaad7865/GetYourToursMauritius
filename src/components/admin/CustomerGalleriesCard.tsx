'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  addGalleryPhotos,
  confirmGalleryComplete,
  galleryDeliveryState,
  loadCustomerGalleries,
  loadGalleryPhotos,
  removeGalleryPhoto,
  type CustomerGalleryRow,
  type GalleryDeliveryState,
} from '@/lib/admin/photography';
import { prepareZipPhotos } from '@/lib/admin/gallery-zip';
import {
  PNotice,
  PPill,
  P_BTN,
  P_BTN_SMALL,
  P_BTN_SMALL_GHOST,
  PSection,
} from '@/components/admin/photo-kit';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';

/** What the studio sees, and which press is next, for each stage of the delivery flow. */
const DELIVERY_UI: Record<
  GalleryDeliveryState,
  { pill: string; tone: 'neutral' | 'ok' | 'warn' | 'teal'; hint: string; action: string | null }
> = {
  empty: { pill: 'No photos yet', tone: 'neutral', hint: '', action: null },
  draft: {
    pill: 'Draft',
    tone: 'neutral',
    hint: 'The guest cannot see this gallery yet.',
    action: 'Confirm gallery complete',
  },
  paid_unconfirmed: {
    pill: 'Paid — confirm to deliver',
    tone: 'warn',
    hint: 'The guest has paid in full and is waiting for their gallery link.',
    action: 'Confirm gallery complete',
  },
  awaiting_balance: {
    pill: 'Awaiting balance',
    tone: 'teal',
    hint: 'The balance email is out. The gallery link goes to the guest the moment they pay.',
    action: 'Resend balance email',
  },
  delivered: {
    pill: 'Delivered',
    tone: 'ok',
    hint: 'Paid in full — the guest has their gallery link.',
    action: 'Resend gallery link',
  },
};

/**
 * One gallery per photography booking. The studio uploads the finished photos here (they land in
 * the public activity-images bucket under galleries/<ref>/), then presses "Confirm gallery
 * complete" — the one-press delivery. That stamps the booking (until it is stamped the guest sees no
 * gallery at all) and emails the guest the link to pay their remaining balance; the moment the
 * balance clears they are emailed the link to their private gallery automatically. A guest who had
 * already paid in full gets the gallery link straight away. The same button resends whichever email
 * is next in line. Rows without photos can't be delivered yet.
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
  const [completed, setCompleted] = useState<
    Record<string, { url: string; emailed: boolean; balanceDueMinor: number }>
  >({});

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

  async function complete(row: CustomerGalleryRow) {
    setBusy(row.ref);
    setError(null);
    try {
      const result = await confirmGalleryComplete(row.ref);
      setCompleted((cur) => ({ ...cur, [row.ref]: result }));
      // Reload so the row reflects the new delivery state alongside the rest of the list.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not confirm the gallery.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <PSection
      title="Customer galleries"
      description={
        <>
          Upload each shoot’s finished photos here, then press <b>Confirm gallery complete</b>. The
          guest is emailed a link to pay their remaining balance; the moment it is paid they are
          emailed the link to their private gallery. If they had already paid in full, they get the
          gallery link straight away. Until you confirm, the guest sees nothing.
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
            const state = galleryDeliveryState(r);
            const ui = DELIVERY_UI[state];
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
                  <PPill tone={ui.tone}>{ui.pill}</PPill>
                  {ui.action && (
                    <button
                      type="button"
                      disabled={busy === r.ref}
                      onClick={() => void complete(r)}
                      title={ui.hint}
                      className={
                        state === 'delivered' || state === 'awaiting_balance'
                          ? P_BTN_SMALL_GHOST
                          : P_BTN
                      }
                    >
                      {busy === r.ref ? 'Sending…' : ui.action}
                    </button>
                  )}
                </div>
                {ui.hint && <p className="mt-1 text-xs text-ink-muted">{ui.hint}</p>}
                {(() => {
                  const doneComplete = completed[r.ref];
                  if (!doneComplete) return null;
                  return (
                    <p className="mt-1 text-xs font-semibold text-teal-dark">
                      {doneComplete.balanceDueMinor > 0
                        ? doneComplete.emailed
                          ? `Balance email sent to ${r.customerEmail}.`
                          : `Email not sent — share the balance link with the guest: ${doneComplete.url}`
                        : doneComplete.emailed
                          ? 'Gallery link sent — already paid in full.'
                          : `Email not sent — share this link with the guest: ${doneComplete.url}`}
                    </p>
                  );
                })()}
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
