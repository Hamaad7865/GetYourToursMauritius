'use client';

import { useT } from '@/components/site/PreferencesProvider';
import { useBooking } from './BookingProvider';
import { durationLabel } from '@/lib/catalogue/detail';
import { badgeIcon } from '@/components/ui/badge-icons';
import { IconBolt, IconCalendar, IconClock, IconGlobe, IconPin, IconUsers, IconWallet } from '@/components/ui/icons';

/**
 * Two-column "at a glance" facts grid, GetYourGuide style. Client, so the Duration + Start-time facts
 * reflect the SELECTED option (Half day / Full day etc.) — falling back to the activity's own duration
 * and start time when the option doesn't set its own. Everything else is the activity's data (passed as
 * props). The "Loved by travellers" banner is a sibling (see Sections.LovedBanner).
 */
export function QuickFacts({
  durationMinutes,
  languages,
  pickupAvailable,
  type,
  isPrivate,
  cancellationPolicy,
  startWindow,
  badges,
}: {
  /** Activity-level fallbacks; the selected option overrides duration + start time when set. */
  durationMinutes: number | null;
  languages: string[];
  pickupAvailable: boolean;
  type: 'activity' | 'transport';
  isPrivate: boolean;
  cancellationPolicy: string | null;
  startWindow?: string | null;
  badges?: { icon: string; title: string; subtitle: string }[];
}) {
  const t = useT();
  const { selectedOption } = useBooking();
  // Per-option time (Half day vs Full day) overrides the activity default when the option sets it.
  const effDuration = selectedOption?.durationMinutes ?? durationMinutes;
  const effStartWindow = selectedOption?.startWindow ?? startWindow ?? null;

  // Admin-authored custom badges override the derived facts entirely.
  if (badges && badges.length > 0) {
    return (
      <div className="border-t border-ink/10 pt-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          {badges.map((b, i) => {
            const Icon = badgeIcon(b.icon);
            return (
              <div key={`${b.icon}-${b.title}-${i}`} className="flex items-start gap-3.5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-ink">
                  {Icon ? <Icon width={22} height={22} /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-bold leading-tight text-ink">{b.title}</span>
                  {b.subtitle ? (
                    <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{b.subtitle}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const duration = durationLabel(effDuration);
  const facts: Array<{ icon: React.ReactNode; title: string; sub: string }> = [];

  if (cancellationPolicy) {
    facts.push({
      icon: <IconCalendar width={22} height={22} />,
      title: t('Free cancellation'),
      sub: cancellationPolicy,
    });
  }
  facts.push({
    icon: <IconWallet width={22} height={22} />,
    title: t('Reserve now & pay later'),
    sub: t('Book your spot today and settle up closer to the date.'),
  });
  if (duration) {
    facts.push({
      icon: <IconClock width={22} height={22} />,
      title: t('Duration {d}', { d: duration }),
      sub: effStartWindow ?? t('Check availability for start times'),
    });
  }
  if (languages.length > 0) {
    facts.push({
      icon: <IconGlobe width={22} height={22} />,
      title: t('Live tour guide'),
      sub: languages.join(', '),
    });
  }
  facts.push(
    pickupAvailable
      ? {
          icon: <IconPin width={22} height={22} />,
          title: t('Pickup included'),
          sub: t('Hotel or port pickup & drop-off'),
        }
      : {
          icon: <IconPin width={22} height={22} />,
          title: t('Meeting point'),
          sub: t('Shared on your voucher'),
        },
  );
  // Private group — ONLY when the activity is actually marked private (never assumed).
  if (isPrivate) {
    facts.push({
      icon: <IconUsers width={22} height={22} />,
      title: type === 'transport' ? t('Private transfer') : t('Private group'),
      sub: t('Only your party — no strangers'),
    });
  }
  facts.push({
    icon: <IconBolt width={22} height={22} />,
    title: t('Instant confirmation'),
    sub: t('E-voucher sent straight to your inbox'),
  });

  return (
    <div className="border-t border-ink/10 pt-6">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.title} className="flex items-start gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-ink/[0.05] text-ink">
              {f.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold leading-tight text-ink">{f.title}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{f.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
