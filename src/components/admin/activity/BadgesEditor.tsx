'use client';

import { IconX } from '@/components/ui/icons';
import { BADGE_ICONS, badgeIcon } from '@/components/ui/badge-icons';
import { inputClass } from '@/components/admin/fields';
import type { BadgeInput } from '@/lib/catalogue/badges';

export function BadgesEditor({
  badges,
  onChange,
}: {
  badges: BadgeInput[];
  onChange: (b: BadgeInput[]) => void;
}) {
  function update(i: number, patch: Partial<BadgeInput>) {
    onChange(badges.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  return (
    <div className="flex flex-col gap-4">
      {badges.map((badge, i) => {
        const Icon = badgeIcon(badge.icon);
        return (
          <div key={i} className="rounded-xl border border-ink/10 p-4">
            <div className="flex items-start gap-2">
              <div className="grid flex-1 gap-2 sm:grid-cols-3">
                <div className="flex items-center gap-2">
                  {Icon ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cream text-teal">
                      <Icon width={18} height={18} />
                    </span>
                  ) : (
                    <span className="h-9 w-9 shrink-0 rounded-lg bg-ink/[0.04]" aria-hidden />
                  )}
                  <select
                    className={inputClass}
                    value={badge.icon}
                    onChange={(e) => update(i, { icon: e.target.value })}
                    aria-label="Badge icon"
                  >
                    <option value="">Choose icon…</option>
                    {BADGE_ICONS.map((b) => (
                      <option key={b.key} value={b.key}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className={inputClass}
                  value={badge.title}
                  onChange={(e) => update(i, { title: e.target.value })}
                  placeholder="Title (e.g. Free cancellation)"
                />
                <input
                  className={inputClass}
                  value={badge.subtitle}
                  onChange={(e) => update(i, { subtitle: e.target.value })}
                  placeholder="Subtitle (e.g. up to 24h before)"
                />
              </div>
              <button
                type="button"
                aria-label="Remove badge"
                onClick={() => onChange(badges.filter((_, idx) => idx !== i))}
                className="shrink-0 pt-2.5 text-ink-muted hover:text-coral"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...badges, { icon: '', title: '', subtitle: '' }])}
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add badge
      </button>
    </div>
  );
}
