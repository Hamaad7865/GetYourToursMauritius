import type { Metadata } from 'next';
import { publicServiceContext } from '@/lib/http/context';
import { getSeoMeta } from '@/lib/services/seo';
import { getLocale } from '@/lib/i18n/server';
import { localeAlternates } from '@/lib/i18n/routing';

/**
 * Merge the admin-editable `seo_meta` override for `path` over a page's built-in metadata.
 * Lets the SEO editor tune a public page's <title>, meta description and OG image from
 * /admin/seo without a deploy. Fail-open: any error (table not migrated yet, DB offline)
 * returns the built-in defaults — an override can slow a page down, never break it.
 *
 * Also the single place that tags `openGraph.locale` for every page that routes through here —
 * it already reads the visitor's locale for the SEO lookup above, so this doesn't add a new
 * cookie read. A shared French page must announce itself as `fr_FR`, not the `en_GB` every
 * caller used to hardcode; this always wins over whatever a caller's own `defaults.openGraph`
 * set; callers no longer need to (and shouldn't) hardcode it themselves.
 *
 * For the same reason it owns `alternates`, which is now more than a canonical: French lives at
 * /fr/<path>, so each page has to declare BOTH URLs plus the canonical for the one being rendered.
 * Overriding whatever the caller passed is deliberate — a hand-written `canonical` here would name
 * the English URL on a French page, which tells Google the French page is a duplicate and drops it
 * from the index. Callers should pass their English path and let this build the set.
 */
export async function overrideMetadata(path: string, defaults: Metadata): Promise<Metadata> {
  const locale = await getLocale();
  const ogLocale = locale === 'fr' ? 'fr_FR' : 'en_GB';
  const alternates = localeAlternates(path, locale);
  try {
    const o = await getSeoMeta(publicServiceContext(locale), path);
    if (!o || (!o.title && !o.description && !o.ogImageUrl)) {
      return {
        ...defaults,
        alternates,
        openGraph: { ...(defaults.openGraph ?? {}), locale: ogLocale },
      };
    }

    const merged: Metadata = { ...defaults, alternates };
    const og = { ...(defaults.openGraph ?? {}), locale: ogLocale } as NonNullable<
      Metadata['openGraph']
    >;
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
    return {
      ...defaults,
      alternates,
      openGraph: { ...(defaults.openGraph ?? {}), locale: ogLocale },
    };
  }
}
