'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { isVideoUrl } from '@/lib/media';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * The booking's private online gallery (/bookings/:ref#gallery). Loads through the
 * owner-gated gallery API — signed-in owner or staff only — and renders nothing at all until
 * the studio has uploaded photos, so bookings without a gallery look exactly as before.
 */
export function BookingGallery({ bookingRef }: { bookingRef: string }) {
  const t = useT();
  const { session } = useAuth();
  const [photos, setPhotos] = useState<{ id: string; url: string }[] | null>(null);

  const load = useCallback(async () => {
    if (!session) {
      setPhotos(null);
      return;
    }
    try {
      const res = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingRef)}/gallery`, {
        headers: { authorization: `Bearer ${session.access_token}` },
      }).then((r) => r.json());
      if (res.ok) {
        const list = (res.data?.photos ?? []) as { id: unknown; url: unknown }[];
        setPhotos(
          list
            .filter((p) => typeof p.url === 'string' && p.url)
            .map((p) => ({ id: String(p.id ?? ''), url: p.url as string })),
        );
      } else {
        setPhotos([]);
      }
    } catch {
      setPhotos([]);
    }
  }, [bookingRef, session]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!photos || photos.length === 0) return null;
  return (
    <section
      id="gallery"
      aria-label={t('Your gallery')}
      className="mt-8 scroll-mt-24 border-t border-ink/10 pt-7"
    >
      <h2 className="m-0 mb-1 text-[22px] font-extrabold tracking-tight text-ink">
        {t('Your gallery')}
      </h2>
      <p className="m-0 mb-4 text-[13.5px] text-ink-muted">
        {t('Your photos are ready — tap any photo to view it full size.')}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p) =>
          isVideoUrl(p.url) ? (
            <video
              key={p.id}
              src={p.url}
              controls
              playsInline
              preload="metadata"
              className="aspect-square w-full rounded-xl bg-ink object-cover"
            />
          ) : (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group block overflow-hidden rounded-xl"
            >
              <img
                src={p.url}
                alt=""
                loading="lazy"
                className="aspect-square w-full object-cover transition duration-300 group-hover:scale-[1.03]"
              />
            </a>
          ),
        )}
      </div>
    </section>
  );
}
