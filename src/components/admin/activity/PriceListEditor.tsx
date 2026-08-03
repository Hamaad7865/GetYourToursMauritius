'use client';

import { useState } from 'react';
import { IconDocument, IconX } from '@/components/ui/icons';
import { inputClass } from '@/components/admin/fields';
import { uploadActivityPdf } from '@/lib/admin/activity-write';

export function PriceListEditor({
  url,
  label,
  slug,
  onUrl,
  onLabel,
}: {
  url: string;
  label: string;
  slug: string;
  onUrl: (url: string) => void;
  onLabel: (label: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      onUrl(await uploadActivityPdf(file, slug));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Upload failed (is the storage bucket set up?).',
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {url ? (
        <div className="flex items-center gap-3 rounded-xl border border-ink/10 p-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-coral/10 text-coral">
            <IconDocument width={18} height={18} />
          </span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-0 flex-1 truncate text-[13px] font-semibold text-teal underline"
          >
            {decodeURIComponent(url.split('/').pop() ?? 'price-list.pdf')}
          </a>
          <button
            type="button"
            aria-label="Remove price list"
            onClick={() => onUrl('')}
            className="shrink-0 text-ink-muted hover:text-coral"
          >
            <IconX width={18} height={18} />
          </button>
        </div>
      ) : (
        <label className="cursor-pointer self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal">
          {uploading ? 'Uploading…' : 'Upload PDF'}
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={uploading}
            onChange={(e) => void onFile(e.target.files)}
          />
        </label>
      )}
      <input
        className={inputClass}
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder="Label (optional) — e.g. Casela park entry prices"
      />
      {error && <p className="text-[13px] font-medium text-coral">{error}</p>}
    </div>
  );
}
