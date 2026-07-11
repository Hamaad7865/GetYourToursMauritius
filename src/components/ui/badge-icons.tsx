import type { SVGProps } from 'react';
import {
  IconClock,
  IconUsers,
  IconGlobe,
  IconCheck,
  IconCalendar,
  IconBolt,
  IconShield,
  IconPin,
  IconStar,
  IconHeart,
  IconWallet,
  IconTrophy,
  IconChat,
  IconTag,
} from '@/components/ui/icons';

type IconCmp = (p: SVGProps<SVGSVGElement>) => React.ReactElement;

/** Curated, on-brand icon set the admin can pick from for custom badges. `key` is stored in extra.badges. */
export const BADGE_ICONS: { key: string; label: string; Icon: IconCmp }[] = [
  { key: 'clock', label: 'Clock / duration', Icon: IconClock },
  { key: 'users', label: 'Group / people', Icon: IconUsers },
  { key: 'globe', label: 'Languages / globe', Icon: IconGlobe },
  { key: 'check', label: 'Check', Icon: IconCheck },
  { key: 'calendar', label: 'Calendar / cancellation', Icon: IconCalendar },
  { key: 'bolt', label: 'Instant / bolt', Icon: IconBolt },
  { key: 'shield', label: 'Shield / safety', Icon: IconShield },
  { key: 'pin', label: 'Pickup / location', Icon: IconPin },
  { key: 'star', label: 'Star', Icon: IconStar },
  { key: 'heart', label: 'Heart', Icon: IconHeart },
  { key: 'wallet', label: 'Payment / wallet', Icon: IconWallet },
  { key: 'trophy', label: 'Award', Icon: IconTrophy },
  { key: 'chat', label: 'Guide / support', Icon: IconChat },
  { key: 'tag', label: 'Price / tag', Icon: IconTag },
];

const BY_KEY = new Map(BADGE_ICONS.map((b) => [b.key, b.Icon]));
/** Resolve a stored icon key to its component, or null when unknown. */
export function badgeIcon(key: string): IconCmp | null {
  return BY_KEY.get(key) ?? null;
}
