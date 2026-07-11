import type { ActivityBadge } from '@/lib/validation/tours';

export interface BadgeInput {
  icon: string;
  title: string;
  subtitle: string;
}

/** Trim, drop rows missing an icon or title, cap field lengths + the count. The form's source of truth on save. */
export function normalizeBadges(rows: BadgeInput[]): ActivityBadge[] {
  const out: ActivityBadge[] = [];
  for (const r of rows) {
    const icon = r.icon.trim();
    const title = r.title.trim().slice(0, 60);
    const subtitle = r.subtitle.trim().slice(0, 120);
    if (!icon || !title) continue;
    out.push({ icon, title, subtitle });
    if (out.length >= 8) break;
  }
  return out;
}
