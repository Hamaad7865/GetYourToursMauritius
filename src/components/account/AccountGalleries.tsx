'use client';

/* eslint-disable @next/next/no-img-element -- gallery/cover photos are external Supabase URLs. */

import Link from 'next/link';
import { useAuth } from '@/components/auth/AuthProvider';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { IconCamera, IconLock } from '@/components/ui/icons';
import { formatLocaleDate } from '@/lib/i18n/format';
import type { GalleryCard } from '@/lib/booking/gallery-cards';
import { AccountSpinner, SignedOutPrompt } from './AccountChrome';
import { useAccountGalleries } from './useAccountGalleries';

function GalleryCardView({ card }: { card: GalleryCard }) {
  const t = useT();
  const { language } = usePreferences();
  const locked = card.access === 'locked';
  const summary = [
    card.shootDate
      ? formatLocaleDate(card.shootDate, language, {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })
      : null,
    t('{photos} photos · {videos} videos', { photos: card.photoCount, videos: card.videoCount }),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li className="flex flex-col overflow-hidden rounded-card border border-ink/10 bg-white transition-shadow hover:shadow-[0_12px_28px_-18px_rgba(10,46,54,0.45)]">
      <div className="relative aspect-[16/9] overflow-hidden bg-teal-tint">
        {card.coverUrl ? (
          <img src={card.coverUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-teal-dark">
            <IconCamera width={30} height={30} />
          </div>
        )}
        {locked && (
          <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-widest text-white backdrop-blur">
            <IconLock width={12} height={12} />
            {t('Locked')}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h2 className="text-[17px] font-extrabold tracking-tight text-ink">{card.packageTitle}</h2>
        <p className="mt-1 text-[13px] text-ink-muted">{summary}</p>
        {locked && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            {t('Your photos are ready. Pay the remaining balance to unlock them.')}
          </p>
        )}
        <div className="mt-auto pt-4">
          {locked ? (
            <Link
              href={`/bookings/${card.ref}#balance-payment`}
              className="flex items-center justify-center gap-1.5 rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal"
            >
              {t('Pay the balance')} · <Price eur={card.balanceDueMinor / 100} />
            </Link>
          ) : (
            <Link
              href={`/bookings/${card.ref}#gallery`}
              className="flex items-center justify-center rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark"
            >
              {t('View gallery')}
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/** /account/galleries — the customer's delivered photoshoots, open or waiting on the balance. */
export function AccountGalleries() {
  const { session, loading: authLoading } = useAuth();
  const t = useT();
  const galleries = useAccountGalleries(session);

  if (authLoading) return <AccountSpinner />;
  if (!session) {
    return <SignedOutPrompt message={t('Sign in to see your photo galleries from your shoots.')} />;
  }

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('My galleries')}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Your delivered shoots live here — download the photos or share them with family.')}
      </p>

      {galleries.status === 'loading' && (
        <ul aria-busy="true" className="mt-6 grid gap-5 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <li
              key={i}
              className="h-64 animate-pulse rounded-card border border-ink/10 bg-teal-tint/40"
            />
          ))}
        </ul>
      )}

      {galleries.status === 'error' && (
        <div
          role="alert"
          className="mt-6 flex flex-col items-center gap-3 rounded-card border border-ink/10 bg-white px-6 py-10 text-center"
        >
          <p className="text-sm font-medium text-coral-dark">
            {t('We couldn’t load your galleries.')}
          </p>
          <button
            type="button"
            onClick={galleries.retry}
            className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-bold text-ink hover:bg-cream"
          >
            {t('Try again')}
          </button>
        </div>
      )}

      {galleries.status === 'ready' && galleries.cards.length === 0 && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-card border border-dashed border-ink/15 bg-teal-tint/40 px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-teal-dark shadow-sm">
            <IconCamera width={22} height={22} />
          </span>
          <p className="text-sm font-bold text-ink">{t('No galleries yet')}</p>
          <p className="max-w-sm text-sm text-ink-muted">
            {t('When your photographer delivers a shoot, it appears here.')}
          </p>
          <Link
            href="/photography"
            className="mt-2 rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark"
          >
            {t('See the photography packages')}
          </Link>
        </div>
      )}

      {galleries.status === 'ready' && galleries.cards.length > 0 && (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {galleries.cards.map((card) => (
            <GalleryCardView key={card.ref} card={card} />
          ))}
        </ul>
      )}
    </div>
  );
}
