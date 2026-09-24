'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPhotographyPhoto,
  importPhotographyGallery,
  deletePhotographyPhoto,
  loadPhotographyPhotos,
  reorderPhotographyPhotos,
  updatePhotographyPhoto,
  uploadPhotographyPhoto,
} from '@/lib/admin/photography';
import {
  GALLERY_TAGS,
  PHOTO_SLOTS,
  PHOTOGRAPHY_GALLERY_DEFAULTS,
  PHOTO_STOCK,
  mediaThumb,
  photosIn,
  videoSource,
  type GalleryTag,
  type PhotoSlot,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';
import { IconChevron, IconPlus, IconX } from '@/components/ui/icons';
import { AdminError, BTN_GHOST, Card, INPUT_CLS } from '@/components/admin/ui';

const TAG_LABEL: Record<GalleryTag, string> = {
  weddings: 'Weddings',
  films: 'Films',
  couples: 'Couples',
  family: 'Family',
};

const ACTIVE_SLOTS: PhotoSlot[] = ['gallery', 'hero', 'pricing-hero', 'gallery-hero'];

/**
 * Every photo on /photography and /photography/packages, slot by slot: upload (or paste a link),
 * replace, remove, and — for the gallery — tag and reorder. Changes save immediately and show on the
 * site on the next page load. A slot with no photo shows its built-in stand-in, labelled as such.
 * (Each package's own photos are edited in the tour editor, with the package.)
 */
export function PhotographyPhotosManager() {
  const [photos, setPhotos] = useState<PhotographyPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<PhotoSlot | null>(null);

  const load = useCallback(async () => {
    try {
      setPhotos(await loadPhotographyPhotos());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? `${err.message} — has the photography_photos migration been applied?`
          : 'Could not load the photos.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(slot: PhotoSlot, fn: () => Promise<void>) {
    setBusySlot(slot);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <Card title="Gallery & page images" className="mb-5">
      <p className="mb-4 text-[13px] text-ink-muted">
        Manage the gallery on <b>/photography</b>, the price list and <b>/photography/gallery</b>.
        Replace any image, edit its description, choose categories or change the order. Changes are
        live on the next page load. Each package’s photos are edited with the package (Edit → Photos
        &amp; files).
      </p>
      {error && (
        <>
          <AdminError>{error}</AdminError>
          <button type="button" onClick={() => void load()} className={BTN_GHOST}>
            Reload images
          </button>
        </>
      )}
      {photos === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col divide-y divide-[#F2F4F6]">
          {ACTIVE_SLOTS.map((id) => PHOTO_SLOTS.find((slot) => slot.id === id)!).map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              photos={photosIn(photos, slot.id)}
              busy={busySlot !== null}
              run={(fn) => run(slot.id, fn)}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

function SlotRow({
  slot,
  photos,
  busy,
  run,
}: {
  slot: (typeof PHOTO_SLOTS)[number];
  photos: PhotographyPhoto[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const multi = slot.id === 'gallery';
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = multi ? Array.from(files) : [files[0]!];
    await run(async () => {
      for (const [i, file] of list.entries()) {
        const isVideo = file.type.startsWith('video/');
        if (isVideo && !multi) throw new Error('Videos can only go in the gallery.');
        let url: string;
        try {
          url = await uploadPhotographyPhoto(file);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // Storage caps a single upload's size — a long film belongs on YouTube / Vimeo instead.
          if (/exceed|too large|payload/i.test(msg)) {
            throw new Error(
              `“${file.name}” is too large to upload. Put long films on YouTube or Vimeo and paste the link here instead.`,
            );
          }
          throw err;
        }
        await addPhotographyPhoto(
          slot.id,
          { url, mediaType: isVideo ? 'video' : 'image' },
          { replace: !multi && i === 0 },
        );
      }
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function addLink() {
    const url = link.trim();
    if (!/^https?:\/\/|^\//.test(url)) return;
    const isVideo = videoSource(url) !== null;
    await run(async () => {
      if (isVideo && !multi) throw new Error('Videos can only go in the gallery.');
      await addPhotographyPhoto(
        slot.id,
        { url, mediaType: isVideo ? 'video' : 'image' },
        { replace: !multi },
      );
    });
    setLink('');
  }

  function move(i: number, dir: -1 | 1) {
    const ids = photos.map((p) => p.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void run(() => reorderPhotographyPhotos(ids));
  }

  const shown = multi ? photos : photos.slice(0, 1);

  return (
    <fieldset
      id={`photography-${slot.id}`}
      aria-label={slot.label}
      disabled={busy}
      className={`py-4 first:pt-0 last:pb-0 ${busy ? 'pointer-events-none opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-extrabold text-ink">{slot.label}</h3>
          {slot.hint && <p className="text-[12px] text-ink-muted">{slot.hint}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={multi ? 'image/*,video/*' : 'image/*'}
            multiple={multi}
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className={BTN_GHOST}>
            <IconPlus width={15} height={15} />
            {busy
              ? 'Saving…'
              : multi
                ? 'Upload photos or videos'
                : photos.length
                  ? 'Replace photo'
                  : 'Upload photo'}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        {shown.length === 0 && slot.standIn && (
          <figure className="w-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.standIn}
              alt=""
              className="aspect-[4/3] w-full rounded-lg object-cover opacity-70 grayscale-[30%]"
            />
            <figcaption className="mt-1 text-[11.5px] font-semibold text-ink-muted">
              Built-in stand-in
            </figcaption>
          </figure>
        )}
        {shown.length === 0 && multi && (
          <div>
            <p className="mb-3 text-[12.5px] text-ink-muted">
              These sample images are currently on the website. Make them editable to swap
              individual photos, or upload your own to start a new gallery.
            </p>
            <div className="mb-3 flex flex-wrap gap-2">
              {PHOTOGRAPHY_GALLERY_DEFAULTS.map((photo) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={photo.key}
                  src={PHOTO_STOCK[photo.key]}
                  alt={photo.alt}
                  className="h-20 w-24 rounded-lg object-cover"
                />
              ))}
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(importPhotographyGallery)}
              className={BTN_GHOST}
            >
              Make sample gallery editable
            </button>
          </div>
        )}
        {shown.map((p, i) => (
          <figure key={p.id} className="w-40">
            <div className="relative">
              <MediaThumb photo={p} />
              {p.mediaType === 'video' && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">
                  Video
                </span>
              )}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => {
                  if (window.confirm('Remove this photo from the page?'))
                    void run(() => deletePhotographyPhoto(p.id));
                }}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-coral shadow hover:bg-white"
              >
                <IconX width={14} height={14} />
              </button>
              {multi && (
                <div className="absolute bottom-1.5 left-1.5 flex gap-1">
                  <button
                    type="button"
                    aria-label="Move earlier"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-ink shadow disabled:opacity-40"
                  >
                    <IconChevron width={13} height={13} className="rotate-90" />
                  </button>
                  <button
                    type="button"
                    aria-label="Move later"
                    disabled={i === shown.length - 1}
                    onClick={() => move(i, 1)}
                    className="grid h-6 w-6 place-items-center rounded-full bg-white/90 text-ink shadow disabled:opacity-40"
                  >
                    <IconChevron width={13} height={13} className="-rotate-90" />
                  </button>
                </div>
              )}
            </div>
            <ReplaceMedia photo={p} run={run} />
            <AltInput photo={p} run={run} />
            {p.mediaType === 'video' && <CoverControl photo={p} run={run} />}
            {multi && (
              <div className="mt-1 flex flex-wrap gap-1">
                {GALLERY_TAGS.map((tag) => {
                  const on = p.tags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        void run(() =>
                          updatePhotographyPhoto(p.id, {
                            tags: on ? p.tags.filter((x) => x !== tag) : [...p.tags, tag],
                          }),
                        )
                      }
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        on ? 'bg-teal text-white' : 'bg-ink/[0.06] text-ink-muted hover:text-ink'
                      }`}
                    >
                      {TAG_LABEL[tag]}
                    </button>
                  );
                })}
              </div>
            )}
          </figure>
        ))}
      </div>

      <div className="mt-3 flex max-w-lg gap-2">
        <input
          className={INPUT_CLS}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder={
            multi
              ? '…or paste an image, YouTube or Vimeo link'
              : '…or paste an image link (https://…)'
          }
          aria-label={`Image link for ${slot.label}`}
        />
        <button
          type="button"
          disabled={!link.trim()}
          onClick={() => void addLink()}
          className={BTN_GHOST}
        >
          {multi ? 'Add' : 'Use'}
        </button>
      </div>
    </fieldset>
  );
}

function ReplaceMedia({
  photo,
  run,
}: {
  photo: PhotographyPhoto;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');
  return (
    <div className="mt-2">
      <input
        ref={fileRef}
        type="file"
        accept={photo.slot === 'gallery' ? 'image/*,video/*' : 'image/*'}
        aria-label="Replacement file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          void run(async () => {
            const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
            if (!file.type.startsWith('image/') && mediaType !== 'video')
              throw new Error('Choose an image or video file.');
            if (mediaType === 'video' && photo.slot !== 'gallery')
              throw new Error('Videos can only go in the gallery.');
            const url = await uploadPhotographyPhoto(file);
            await updatePhotographyPhoto(photo.id, { url, mediaType, posterUrl: null });
          });
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className={`${BTN_GHOST} w-full`}
      >
        {photo.mediaType === 'video' ? 'Replace video' : 'Replace image'}
      </button>
      <details className="mt-1 text-xs text-ink-muted">
        <summary className="cursor-pointer py-1">Replace using a link</summary>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          aria-label="Replacement URL"
          placeholder="https://…"
          className={`${INPUT_CLS} mt-1`}
        />
        <button
          type="button"
          disabled={!link.trim()}
          className={`${BTN_GHOST} mt-1`}
          onClick={() =>
            void run(async () => {
              const mediaType = videoSource(link) ? 'video' : 'image';
              if (mediaType === 'video' && photo.slot !== 'gallery')
                throw new Error('Videos can only go in the gallery.');
              await updatePhotographyPhoto(photo.id, { url: link, mediaType, posterUrl: null });
              setLink('');
            })
          }
        >
          Save replacement
        </button>
      </details>
    </div>
  );
}

/** Alt text, saved on blur — it is what screen readers and Google read for the photo. */
function AltInput({
  photo,
  run,
}: {
  photo: PhotographyPhoto;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [alt, setAlt] = useState(photo.alt ?? '');
  return (
    <input
      value={alt}
      onChange={(e) => setAlt(e.target.value)}
      onBlur={() => {
        if ((photo.alt ?? '') !== alt.trim())
          void run(() => updatePhotographyPhoto(photo.id, { alt }));
      }}
      placeholder="Describe the photo"
      aria-label="Photo description"
      className="mt-1.5 w-full rounded-md border border-[#E2E7EA] bg-[#F7F8FA] px-2 py-1 text-[12px] text-ink outline-none focus:border-teal focus:bg-white"
    />
  );
}

/** What a tile shows: the photo, a video's cover / YouTube frame, or an uploaded video's first frame. */
function MediaThumb({ photo }: { photo: PhotographyPhoto }) {
  const thumb = mediaThumb(photo);
  if (thumb) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumb}
        alt={photo.alt ?? ''}
        className="aspect-[4/3] w-full rounded-lg object-cover"
      />
    );
  }
  const src = videoSource(photo.url);
  return src?.kind === 'file' ? (
    <video
      src={`${src.src}#t=0.1`}
      muted
      playsInline
      preload="metadata"
      className="aspect-[4/3] w-full rounded-lg bg-ink object-cover"
    />
  ) : (
    <span className="grid aspect-[4/3] w-full place-items-center rounded-lg bg-ink text-[11px] font-bold text-white/70">
      Video link
    </span>
  );
}

/** A video's cover image — shown on the tile and in the film strip before it plays. */
function CoverControl({
  photo,
  run,
}: {
  photo: PhotographyPhoto;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          void run(async () => {
            const url = await uploadPhotographyPhoto(file);
            await updatePhotographyPhoto(photo.id, { posterUrl: url });
          });
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold text-ink-muted hover:text-ink"
      >
        {photo.posterUrl ? 'Replace cover' : 'Add cover image'}
      </button>
      {photo.posterUrl && (
        <button
          type="button"
          onClick={() => void run(() => updatePhotographyPhoto(photo.id, { posterUrl: null }))}
          className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-bold text-ink-muted hover:text-coral"
        >
          Remove cover
        </button>
      )}
    </div>
  );
}
