import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { IconCamera } from '@/components/ui/icons';

/**
 * Content-column section on PRIVATE tour pages (sightseeing excluded — see the caller):
 * tells the customer a photographer can join their tour. Links only — the package page
 * prices and books the shoot itself.
 */
export async function PrivateTourPhotography() {
  const t = await getT();
  return (
    <section className="mt-8 border-t border-ink/10 pt-7">
      <div className="flex items-start gap-3.5 rounded-2xl border border-teal/25 bg-gradient-to-r from-teal/[0.07] to-transparent px-4 py-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal text-white">
          <IconCamera width={20} height={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-extrabold text-ink">
            {t('Add a photographer to your private tour')}
          </span>
          <span className="mt-1 block text-[13.5px] leading-snug text-ink/70">
            {t(
              'Exploring as a private group? A professional photographer can join your tour and capture the day — portraits, candid moments and group shots, delivered in a private online gallery. Choose a photography package for the same day as your tour.',
            )}
          </span>
          <Link
            href="/photography/packages"
            className="mt-2.5 inline-block text-[13.5px] font-bold text-teal-dark underline underline-offset-4 hover:text-teal"
          >
            {t('Browse photography packages')}
          </Link>
        </span>
      </div>
    </section>
  );
}
