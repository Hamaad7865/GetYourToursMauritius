'use client';

import { usePathname } from 'next/navigation';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { useT } from './PreferencesProvider';
import { IconChat } from '@/components/ui/icons';

/**
 * Global floating "chat on WhatsApp" button (bottom-right, every customer-facing page). Sits above
 * the mobile sticky book bar (MobileBookBar, `fixed inset-x-0 bottom-0`) rather than on top of it —
 * hence the taller mobile offset; desktop has no such bar so it sits closer to the corner.
 */
export function WhatsAppFloat() {
  const pathname = usePathname();
  const t = useT();
  if (pathname?.startsWith('/admin')) return null;

  return (
    <a
      href={whatsappUrl(t('Hi Belle Mare Tours! I have a question.'))}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${t('WhatsApp us')} — ${SITE.phone}`}
      className="gyt-wa-float animate-pop group fixed bottom-24 right-4 z-40 flex items-center rounded-full bg-teal text-white shadow-[0_14px_32px_-10px_rgba(14,140,146,0.55)] transition-[box-shadow,background-color] duration-300 hover:bg-teal-dark hover:shadow-[0_18px_38px_-8px_rgba(11,92,99,0.65)] lg:bottom-6"
    >
      <span className="relative grid h-14 w-14 shrink-0 place-items-center">
        <span aria-hidden className="gyt-wa-ring absolute inset-0 rounded-full bg-white/70" />
        <IconChat width={26} height={26} className="relative" />
      </span>
      <span className="max-w-0 overflow-hidden whitespace-nowrap pr-0 text-sm font-bold opacity-0 transition-all duration-300 group-hover:max-w-[9rem] group-hover:pr-5 group-hover:opacity-100">
        {t('WhatsApp us')}
      </span>
    </a>
  );
}
