import type { Metadata } from 'next';
import { publicServiceContext } from '@/lib/http/context';
import { getSeoMeta } from '@/lib/services/seo';

/**
 * Merge the admin-editable `seo_meta` override for `path` over a page's built-in metadata.
 * Lets the SEO editor tune a public page's <title>, meta description and OG image from
 * /admin/seo without a deploy. Fail-open: any error (table not migrated yet, DB offline)
 * returns the built-in defaults — an override can slow a page down, never break it.
 */
export async function overrideMetadata(path: string, defaults: Metadata): Promise<Metadata> {
  try {
    const o = await getSeoMeta(publicServiceContext(), path);
    if (!o || (!o.title && !o.description && !o.ogImageUrl)) return defaults;

    const merged: Metadata = { ...defaults };
    const og = { ...(defaults.openGraph ?? {}) } as NonNullable<Metadata['openGraph']>;
    if (o.title) {
      // Absolute so the root "%s | …" template never double-brands an already-branded title.
      merged.title = { absolute: o.title };
      og.title = o.title;
    }
    if (o.description) {
      merged.description = o.description;
      og.description = o.description;
    }
    if (o.ogImageUrl) {
      og.images = [{ url: o.ogImageUrl }];
    }
    merged.openGraph = og;
    return merged;
  } catch {
    return defaults;
  }
}
