'use client';

import { useState } from 'react';
import { IconChevron, IconGrip, IconX } from '@/components/ui/icons';
import { inputClass } from '@/components/admin/fields';
import { moveItem } from '@/lib/admin/reorder';
import { uploadActivityImage, type ImageInput } from '@/lib/admin/activity-write';

export function ImagesEditor({
  images,
  slug,
  onChange,
}: {
  images: ImageInput[];
  slug: string;
  onChange: (images: ImageInput[]) => void;
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
        const url = await uploadActivityImage(file, slug);
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.alt || 'preview'}
              className="h-14 w-20 rounded-lg object-cover"
            />
            <span
              className={`absolute left-1 top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold ${
                i < 5 ? 'bg-teal text-white' : 'bg-ink/55 text-white'
              }`}
            >
              {i + 1}
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              className={inputClass}
              value={img.url}
              onChange={(e) => update(i, { url: e.target.value })}
              placeholder="https://…/photo.jpg"
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
          {uploading ? 'Uploading…' : 'Upload photos'}
          <input
            type="file"
            accept="image/*"
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
          Add image URL
        </button>
      </div>
      {uploadError && <p className="text-[13px] font-medium text-coral">{uploadError}</p>}
    </div>
  );
}
