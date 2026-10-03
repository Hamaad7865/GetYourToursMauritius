'use client';

import { useState } from 'react';
import { IconChevron, IconGrip, IconPlay, IconX } from '@/components/ui/icons';
import { inputClass } from '@/components/admin/fields';
import { moveItem } from '@/lib/admin/reorder';
import { uploadActivityImage, type ImageInput } from '@/lib/admin/activity-write';
import { videoSource } from '@/lib/media';

/** The little picture beside a row: a photo, a video file's first frame, a YouTube still, or a dark
 *  tile (Vimeo offers none) — each with a play mark when it is a video, never a broken image. */
function Preview({ url, alt }: { url: string; alt: string }) {
  const video = videoSource(url);
  const frame = 'h-14 w-20 rounded-lg object-cover';
  return (
    <>
      {video?.kind === 'file' ? (
        <video src={url} muted playsInline preload="metadata" className={`${frame} bg-ink`} />
      ) : video?.kind === 'youtube' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={video.thumbUrl} alt={alt || 'video preview'} className={frame} />
      ) : video ? (
        <span aria-hidden className={`block ${frame} bg-ink`} />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt || 'preview'} className={frame} />
      )}
      {video && (
        <span
          aria-hidden
          className="absolute inset-0 m-auto grid h-7 w-7 place-items-center rounded-full bg-ink/65 text-white"
        >
          <IconPlay width={13} height={13} />
        </span>
      )}
    </>
  );
}

export function ImagesEditor({
  images,
  slug,
  onChange,
  firstNumber = 1,
  gridTiles = 5,
}: {
  images: ImageInput[];
  slug: string;
  onChange: (images: ImageInput[]) => void;
  /** The number shown on the first row. Default 1 (the first photo IS the lead); a list that sits after a
   *  separate cover starts at 2. */
  firstNumber?: number;
  /** How many photos the page's grid shows (the lead plus four): rows up to this number are teal, the rest
   *  open under "View all". */
  gridTiles?: number;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function update(i: number, patch: Partial<ImageInput>) {
    onChange(images.map((img, idx) => (idx === i ? { ...img, ...patch } : img)));
  }

  // Live-reorder as the dragged photo hovers over another row (same pattern as the Tours card reorder).
  function onDragOverRow(e: React.DragEvent, overIndex: number) {
    if (dragIndex === null || dragIndex === overIndex) return;
    e.preventDefault();
    onChange(moveItem(images, dragIndex, overIndex));
    setDragIndex(overIndex);
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const added: ImageInput[] = [];
      for (const file of Array.from(files)) {
        const url = await uploadActivityImage(file, slug, { webSize: true });
        added.push({ url, alt: '' });
      }
      onChange([...images, ...added]);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Upload failed (is the storage bucket set up?).',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {images.map((img, i) => (
        <div
          key={i}
          onDragOver={(e) => onDragOverRow(e, i)}
          onDrop={(e) => e.preventDefault()}
          className={`flex items-center gap-2 rounded-xl border border-ink/10 p-2 transition-opacity ${
            dragIndex === i ? 'opacity-40' : ''
          }`}
        >
          <div
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            aria-label={`Drag to reorder photo ${i + 1}`}
            title="Drag to reorder"
            className="grid h-9 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-ink-muted hover:text-teal active:cursor-grabbing"
          >
            <IconGrip width={16} height={16} />
          </div>
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              aria-label={`Move photo ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onChange(moveItem(images, i, i - 1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-teal disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconChevron width={16} height={16} className="rotate-180" />
            </button>
            <button
              type="button"
              aria-label={`Move photo ${i + 1} down`}
              disabled={i === images.length - 1}
              onClick={() => onChange(moveItem(images, i, i + 1))}
              className="grid h-6 w-6 place-items-center rounded text-ink-muted hover:text-teal disabled:cursor-not-allowed disabled:opacity-30"
            >
              <IconChevron width={16} height={16} />
            </button>
          </div>
          <div className="relative shrink-0">
            <Preview url={img.url} alt={img.alt} />
            <span
              className={`absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold ${
                i + firstNumber <= gridTiles ? 'bg-teal text-white' : 'bg-ink/55 text-white'
              }`}
            >
              {i + firstNumber}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              className={inputClass}
              value={img.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…/photo.jpg — or a YouTube / Vimeo link"
            />
            <input
              className={inputClass}
              value={img.alt}
              onChange={(e) => update(i, { alt: e.target.value })}
              placeholder="Alt text (what the photo shows)"
            />
          </div>
          <button
            type="button"
            aria-label="Remove photo"
            onClick={() => onChange(images.filter((_, idx) => idx !== i))}
            className="shrink-0 text-ink-muted hover:text-coral"
          >
            <IconX width={18} height={18} />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal">
          {uploading ? 'Uploading…' : 'Upload photos or videos'}
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => void onFiles(e.target.files)}
          />
        </label>
        <button
          type="button"
          onClick={() => onChange([...images, { url: '', alt: '' }])}
          className="rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
        >
          Add a link (photo, YouTube or Vimeo)
        </button>
      </div>
      <p className="text-[12px] leading-snug text-ink-muted">
        Videos: upload a short clip, or paste a YouTube / Vimeo link for a long film — very large
        uploads can be rejected by the storage size limit.
      </p>
      {uploadError && <p className="text-[13px] font-medium text-coral">{uploadError}</p>}
    </div>
  );
}
