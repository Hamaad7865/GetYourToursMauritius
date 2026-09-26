'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PhotographyPackageForm } from '@/components/admin/PhotographyPackageForm';
import { AvailabilityEditor } from '@/components/admin/AvailabilityEditor';
import { ActivityForm } from '@/components/admin/ActivityForm';
import { IconCalendar, IconChevron, IconSettings } from '@/components/ui/icons';
import { IconCamera } from '@/components/ui/icons';

const TABS = [
  {
    id: 'package',
    label: 'Package',
    hint: 'Price, guests, add-ons, cover & inspiration',
    icon: IconCamera,
  },
  {
    id: 'dates',
    label: 'Dates & capacity',
    hint: 'Bookable days, closed dates, shoots per day',
    icon: IconCalendar,
  },
  {
    id: 'all',
    label: 'All settings',
    hint: 'Full editor — photos, description, French, SEO',
    icon: IconSettings,
  },
] as const;

type TabId = (typeof TABS)[number]['id'];

function isTab(value: string | null): value is TabId {
  return TABS.some((t) => t.id === value);
}

/**
 * The package studio: everything about one photography package in one screen. "Package" is the
 * curated quick form; "Dates & capacity" and "All settings" are the same editors the tour screens
 * use — one save path each, nothing re-implemented. The tab is in the URL (?tab=) so the
 * dashboard's "Dates" button lands directly on the calendar.
 */
function StudioInner({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab: TabId = isTab(params.get('tab')) ? (params.get('tab') as TabId) : 'package';

  function select(next: TabId) {
    router.replace(`/admin/photography/${id}/edit?tab=${next}`, { scroll: false });
  }

  return (
    <div className="pb-16">
      <Link
        href="/admin/photography"
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted transition hover:text-teal-dark"
      >
        <IconChevron width={15} height={15} className="rotate-90" /> Photography studio
      </Link>

      <div
        role="tablist"
        aria-label="Package sections"
        className="mb-6 flex w-fit max-w-full gap-1 overflow-x-auto rounded-full border border-ink/10 bg-white p-1.5 shadow-[0_4px_18px_-10px_rgba(10,46,54,0.15)]"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              title={t.hint}
              onClick={() => select(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-bold transition ${
                on ? 'bg-ink text-white shadow-sm' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Icon width={14} height={14} aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Mounted on demand — each editor owns its own load/save. */}
      {tab === 'package' && <PhotographyPackageForm packageId={id} embedded />}
      {tab === 'dates' && <AvailabilityEditor activityId={id} />}
      {tab === 'all' && <ActivityForm mode="edit" id={id} />}
    </div>
  );
}

export function PhotographyStudio({ id }: { id: string }) {
  return (
    <Suspense>
      <StudioInner id={id} />
    </Suspense>
  );
}
