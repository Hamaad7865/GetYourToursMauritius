'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { PHOTOGRAPHY_CATEGORY } from '@/lib/catalogue/photography';

interface PackageOption {
  slug: string;
  title: string;
  status: string;
}

/**
 * Tour editor → Logistics: which photography packages this tour offers as an add-on. Stored as slugs
 * in `extra.photographyAddOns`; the booking card lists them once a date is picked and opens the
 * chosen package for the same day and party. Nothing here is priced — each package books through its
 * own option and supplements.
 */
export function PhotographyAddOnsField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [packages, setPackages] = useState<PackageOption[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: err } = await getBrowserSupabase()
        .from('activities')
        .select('slug, title, status')
        .eq('category', PHOTOGRAPHY_CATEGORY as never)
        .order('sort');
      if (!active) return;
      if (err) setError(true);
      setPackages(
        (data ?? []).map((p) => ({
          slug: p.slug as string,
          title: p.title as string,
          status: p.status as string,
        })),
      );
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggle = (slug: string, on: boolean) =>
    onChange(on ? [...value.filter((s) => s !== slug), slug] : value.filter((s) => s !== slug));
  // A slug saved earlier whose package was since renamed or deleted: show it so it can be removed.
  const orphans = packages ? value.filter((s) => !packages.some((p) => p.slug === s)) : [];

  return (
    <div className="flex flex-col gap-2 border-t border-[#EAEEF0] pt-4">
      <div>
        <p className="text-sm font-bold text-ink">Photography add-ons</p>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          Offer a photographer on this tour. After picking a date, the guest can add a ticked
          package for the same day — it goes in the same cart and checkout.
        </p>
      </div>
      {packages === null ? (
        <p className="text-[12.5px] text-ink-muted">Loading packages…</p>
      ) : error ? (
        <p className="text-[12.5px] text-coral">Couldn’t load the photography packages.</p>
      ) : packages.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">
          No photography packages yet —{' '}
          <Link href="/admin/photography/new" className="font-bold text-teal hover:underline">
            create one
          </Link>
          .
        </p>
      ) : (
        packages.map((p) => (
          <label key={p.slug} className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={value.includes(p.slug)}
              onChange={(e) => toggle(p.slug, e.target.checked)}
            />
            {p.title}
            {p.status !== 'published' && (
              <span className="rounded-full bg-ink/10 px-2 py-0.5 text-[11px] font-bold text-ink-muted">
                Draft — hidden until published
              </span>
            )}
          </label>
        ))
      )}
      {orphans.map((slug) => (
        <label key={slug} className="flex items-center gap-2.5 text-sm font-medium text-ink-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-teal"
            checked
            onChange={() => toggle(slug, false)}
          />
          {slug} <span className="text-[11px]">(no longer a package — untick to remove)</span>
        </label>
      ))}
    </div>
  );
}
