import type { ComponentType, SVGProps } from 'react';
import {
  IconCar,
  IconCheck,
  IconDocument,
  IconGlobe,
  IconGrid,
  IconPin,
  IconSearch,
  IconSliders,
  IconStar,
  IconTag,
} from '@/components/ui/icons';
import { assertPricingValid, type ActivityFormValues } from '@/lib/admin/activity-write';

/**
 * The tour editor's panes.
 *
 * The editor used to be one 1,548-line form of nine stacked cards — about six screens of scrolling
 * to reach the pricing tiers, and "Description & details" had quietly become a bin holding the
 * summary, the meeting point, the map coordinates, the price-list PDF, the supplement and the
 * pricing mode. This registry is the re-grouping: one screen-sized pane per subject, reachable in
 * one click from the rail.
 *
 * Order matters — it is the rail's order, and it runs roughly in the order a tour gets written.
 */
export type SectionId =
  | 'basics'
  | 'description'
  | 'media'
  | 'pricing'
  | 'itinerary'
  | 'logistics'
  | 'inclusions'
  | 'badges'
  | 'search'
  | 'french';

/** What every pane gets: the whole form value plus the container's single-key setter. Panes are
 *  presentational — they never load or save, so the save path stayed exactly one code path. */
export interface PaneProps {
  v: ActivityFormValues;
  set: <K extends keyof ActivityFormValues>(key: K, val: ActivityFormValues[K]) => void;
}

export interface SectionMeta {
  id: SectionId;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Hidden from the restricted 'seo' content role — RLS blocks the option/price tables for it. */
  staffOnly?: boolean;
}

export const SECTIONS: SectionMeta[] = [
  { id: 'basics', label: 'Basics', icon: IconSliders },
  { id: 'description', label: 'Description', icon: IconDocument },
  { id: 'media', label: 'Photos & files', icon: IconGrid },
  { id: 'pricing', label: 'Pricing & options', icon: IconTag, staffOnly: true },
  { id: 'itinerary', label: 'Itinerary', icon: IconPin },
  { id: 'logistics', label: 'Logistics', icon: IconCar },
  { id: 'inclusions', label: 'Inclusions', icon: IconCheck },
  { id: 'badges', label: 'Badges', icon: IconStar },
  { id: 'search', label: 'Search appearance', icon: IconSearch },
  { id: 'french', label: 'Français', icon: IconGlobe },
];

export function visibleSections(contentOnly: boolean): SectionMeta[] {
  return contentOnly ? SECTIONS.filter((s) => !s.staffOnly) : SECTIONS;
}

/** The first visible pane — where the editor opens, and where an unknown `?s=` falls back to. */
export function defaultSection(contentOnly: boolean): SectionId {
  return visibleSections(contentOnly)[0]?.id ?? 'basics';
}

export function isSectionId(value: string | null, contentOnly: boolean): value is SectionId {
  return visibleSections(contentOnly).some((s) => s.id === value);
}

/** The badge on a rail item: how many photos / options / stops / badges the pane holds. */
export function sectionCount(v: ActivityFormValues, id: SectionId): number | null {
  switch (id) {
    case 'media':
      return v.images.length;
    case 'pricing':
      return v.options.length;
    case 'itinerary':
      return v.itinerary.length;
    case 'badges':
      return v.badges.length;
    default:
      return null;
  }
}

/**
 * Which panes hold a problem that would fail the save, keyed by pane.
 *
 * One pane is visible at a time, so an error about a private option is useless while you are
 * looking at Basics — the rail carries a dot instead. These mirror the save path exactly rather
 * than restating it: the two required-field checks come from `save()` in ActivityForm, and the
 * pricing rules ARE `assertPricingValid`, the same function the save calls, so the two cannot
 * drift apart.
 */
export function sectionIssues(
  v: ActivityFormValues,
  contentOnly: boolean,
): Partial<Record<SectionId, string>> {
  const issues: Partial<Record<SectionId, string>> = {};
  if (!v.title.trim()) issues.basics = 'A title is required.';
  else if (!v.slug.trim()) issues.basics = 'A URL slug is required.';
  // contentOnly saves skip assertPricingValid (RLS blocks the tables), so flagging it would point
  // at a pane the role can't even open.
  if (!contentOnly) {
    try {
      assertPricingValid(v);
    } catch (err) {
      issues.pricing = err instanceof Error ? err.message : 'This tour’s pricing is incomplete.';
    }
  }
  return issues;
}
