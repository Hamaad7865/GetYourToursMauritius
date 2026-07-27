import {
  SEO_PAGES,
  BRAND_SUFFIX,
  effectiveDefaultTitle,
  type SeoPage,
} from '@/lib/seo/page-registry';
import { loadPosts } from '@/lib/content/blog-live';
import type { AuditPage } from '@/lib/seo/audit';
import { areas, areaMetaTitle, areaMetaDescription } from '@/lib/content/areas';
import { transfers, transferMetaTitle, transferMetaDescription } from '@/lib/content/transfers';
import { loadPlaces } from '@/lib/catalogue/places';
import {
  attractionPath,
  attractionMetaTitle,
  attractionMetaDescription,
} from '@/lib/content/attractions';

/**
 * Every public page whose title/description the SEO editor can override, grouped for /admin/seo.
 *
 * The hand-written registry (SEO_PAGES) covers the ~18 hubs and landing pages. The three groups
 * built here cover the CONTENT-MODULE families — attractions, destination guides and hotel
 * transfers — which together are ~75 more URLs that previously needed a deploy to retitle.
 *
 * Deliberately NOT here, because each already has a better editor of its own:
 *   • tours (/activities/…) — the "Search appearance" panel in the activity editor
 *   • blog posts (/blog/…)  — the meta title/description fields in /admin/blog
 * Listing them twice would give two screens that silently overwrite one another.
 *
 * Server-only: `loadPlaces()` reads the database.
 */

export interface SeoPageGroup {
  key: string;
  label: string;
  hint: string;
  pages: SeoPage[];
}

/** Defaults come from the SAME helpers the pages use, so a preview can never drift from the page. */
export async function buildSeoPageGroups(): Promise<SeoPageGroup[]> {
  const groups: SeoPageGroup[] = [
    {
      key: 'core',
      label: 'Main pages',
      hint: 'The homepage, hubs and landing pages — where most of the search demand lands.',
      pages: SEO_PAGES,
    },
    {
      key: 'destinations',
      label: 'Destination guides',
      hint: 'One per region or resort area (/destinations/…).',
      pages: areas.map((a) => ({
        path: a.path,
        label: a.name,
        defaultTitle: areaMetaTitle(a),
        defaultDescription: areaMetaDescription(a),
        templated: true,
      })),
    },
    {
      key: 'transfers',
      label: 'Hotel transfers',
      hint: 'One per resort we quote a fixed airport fare for (/airport-transfers/…).',
      pages: transfers.map((t) => ({
        path: t.path,
        label: t.hotelName,
        defaultTitle: transferMetaTitle(t),
        defaultDescription: transferMetaDescription(t),
        templated: true,
      })),
    },
  ];

  // Attractions come from the database; a fetch failure must not take the whole editor down — the
  // other groups are still perfectly editable without it.
  try {
    const places = await loadPlaces();
    groups.push({
      key: 'attractions',
      label: 'Attractions',
      hint: 'One per place in the attractions guide (/attractions/…).',
      pages: places.map((p) => ({
        path: attractionPath(p.id),
        label: p.name,
        defaultTitle: attractionMetaTitle(p),
        defaultDescription: attractionMetaDescription(p),
        templated: true,
      })),
    });
  } catch (error) {
    console.error('[admin/seo] attraction list failed', error);
  }

  return groups;
}

/**
 * The health panel's page list, minus tours.
 *
 * Titles here are the BUILT-IN values — the client overlays the saved `seo_meta` rows (which it
 * already loads for the editor) via `applyOverrides`, so the panel re-audits live as pages are
 * saved without a round-trip to the server.
 *
 * Tours are deliberately absent: only an authenticated admin session can read
 * `activities.seo_title`, so the client fetches those itself (loadTourSeoRows).
 */
export async function buildAuditPages(): Promise<AuditPage[]> {
  const groups = await buildSeoPageGroups();
  const pages: AuditPage[] = groups.flatMap((g) =>
    g.pages.map((p) => ({
      path: p.path,
      label: p.label,
      group: g.label,
      title: effectiveDefaultTitle(p),
      description: p.defaultDescription,
      editorPath: '/admin/seo',
      overridable: true,
    })),
  );

  // Blog posts read their meta from the post row, not from seo_meta — overridable: false.
  try {
    for (const post of await loadPosts()) {
      pages.push({
        path: post.path,
        label: post.title,
        group: 'Blog',
        // /blog/[slug] returns a PLAIN title, so the root template appends the brand to it.
        title: `${post.metaTitle || post.title}${BRAND_SUFFIX}`,
        description: post.metaDescription,
        editorPath: '/admin/blog',
        overridable: false,
      });
    }
  } catch (error) {
    console.error('[admin/seo] blog list failed', error);
  }

  return pages;
}
