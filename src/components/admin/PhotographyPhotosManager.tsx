'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addPhotographyPhoto,
  deletePhotographyPhoto,
  loadPhotographyPhotos,
  reorderPhotographyPhotos,
  updatePhotographyPhoto,
  uploadPhotographyPhoto,
} from '@/lib/admin/photography';
import {
  GALLERY_TAGS,
  PHOTO_SLOTS,
  photosIn,
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
      setPhotos([]);
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
    <Card title="Page photos" className="mb-5">
      <p className="mb-4 text-[13px] text-ink-muted">
        The photos on <b>/photography</b> and the price list. Upload your own to replace the
        built-in stand-ins — changes are live on the next page load. Each package’s photos are
        edited with the package (Edit → Photos &amp; files).
      </p>
      {error && <AdminError>{error}</AdminError>}
      {photos === null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col divide-y divide-[#F2F4F6]">
          {PHOTO_SLOTS.map((slot) => (
            <SlotRow
              key={slot.id}
              slot={slot}
              photos={photosIn(photos, slot.id)}
              busy={busySlot === slot.id}
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
        const url = await uploadPhotographyPhoto(file);
        await addPhotographyPhoto(slot.id, { url }, { replace: !multi && i === 0 });
      }
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  async function addLink() {
    const url = link.trim();
    if (!/^https?:\/\/|^\//.test(url)) return;
    await run(() => addPhotographyPhoto(slot.id, { url }, { replace: !multi }));
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
    <section
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
            accept="image/*"
            multiple={multi}
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
          />
          <button type="button" onClick={() => fileRef.current?.click()} className={BTN_GHOST}>
            <IconPlus width={15} height={15} />
            {busy
              ? 'Saving…'
              : multi
                ? 'Upload photos'
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
        {shown.length === 0 && !slot.standIn && (
          <p className="text-[12.5px] text-ink-muted">
            No photos yet — the page shows its built-in stand-in set until you add some.
          </p>
        )}
        {shown.map((p, i) => (
          <figure key={p.id} className="w-40">
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.url}
                alt={p.alt ?? ''}
                className="aspect-[4/3] w-full rounded-lg object-cover"
              />
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
            <AltInput photo={p} run={run} />
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
          placeholder="…or paste an image link (https://…)"
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
    </section>
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
