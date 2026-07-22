'use client';

import { useT } from '@/components/site/PreferencesProvider';
import { useBooking } from './BookingProvider';
import { durationLabel } from '@/lib/catalogue/detail';
import { badgeIcon } from '@/components/ui/badge-icons';
import { RevealGroup } from '@/components/site/RevealGroup';
import {
  IconBolt,
  IconCalendar,
  IconClock,
  IconGlobe,
  IconPin,
  IconUsers,
  IconWallet,
} from '@/components/ui/icons';

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
  const { selectedOption, activity } = useBooking();
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
                  <span className="block text-[15px] font-bold leading-tight text-ink">
                    {b.title}
                  </span>
                  {b.subtitle ? (
                    <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">
                      {b.subtitle}
                    </span>
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
  // Payment is taken at checkout (instantly) — never promise "pay later". The instant-confirmation
  // reassurance is its own fact further down, so this slot carries the payment-security one. Neither
  // claim holds for an inquiry-only activity (skydiving-style) — it has no checkout/payment at all.
  if (!activity.inquiryOnly) {
    facts.push({
      icon: <IconWallet width={22} height={22} />,
      title: t('Secure payment'),
      sub: t('Card payment protected by Peach.'),
    });
  }
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
  if (pickupAvailable) {
    // Sightseeing tours (flat per-vehicle price) genuinely INCLUDE transport. Per-person / per-group
    // activities charge a region-based pickup add-on at checkout, so never say "included" there — it
    // reads as if the displayed price covers pickup, then checkout is higher.
    facts.push(
      activity.pricingMode === 'vehicle'
        ? {
            icon: <IconPin width={22} height={22} />,
            title: t('Pickup included'),
            sub: t('Hotel or port pickup & drop-off'),
          }
        : {
            icon: <IconPin width={22} height={22} />,
            title: t('Hotel pickup & drop-off'),
            sub: t('Available at additional cost'),
          },
    );
  } else {
    facts.push({
      icon: <IconPin width={22} height={22} />,
      title: t('Meeting point'),
      sub: t('Shared on your voucher'),
    });
  }
  // Private group — ONLY when the activity is actually marked private (never assumed).
  if (isPrivate) {
    facts.push({
      icon: <IconUsers width={22} height={22} />,
      title: type === 'transport' ? t('Private transfer') : t('Private group'),
      sub: t('Only your party — no strangers'),
    });
  }
  // Adults only — set per activity in admin (e.g. hiking). Also hides the child-seats add-on.
  if (activity.adultsOnly) {
    facts.push({
      icon: <IconUsers width={22} height={22} />,
      title: t('Adults only'),
      sub: t('Minimum age 18 — no children'),
    });
  }
  if (activity.inquiryOnly) {
    facts.push({
      icon: <IconBolt width={22} height={22} />,
      title: t('Personal trip planning'),
      sub: t('We’ll confirm by WhatsApp or email'),
    });
  } else {
    facts.push({
      icon: <IconBolt width={22} height={22} />,
      title: t('Instant confirmation'),
      sub: t('E-voucher sent straight to your inbox'),
    });
  }

  return (
    <div className="border-t border-ink/10 pt-6">
      <RevealGroup className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
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
      </RevealGroup>
    </div>
  );
}
