'use client';

/* eslint-disable @next/next/no-img-element -- gallery photos are external Supabase URLs. */

import { responsiveImage } from '@/lib/images/resize';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import {
  IconChevron,
  IconDownload,
  IconHeart,
  IconLock,
  IconMinus,
  IconPlay,
  IconPlus,
  IconShare,
  IconStar,
  IconX,
} from '@/components/ui/icons';
import { SITE } from '@/lib/seo/site';
import {
  CONFIRM_POLL_INTERVAL_MS,
  CONFIRM_POLL_MAX_MS,
  shouldKeepPollingGallery,
} from '@/lib/checkout/confirm-poll';
import { useScrollToHash } from '@/lib/ui/useScrollToHash';
import { BOOKING_DETAILS_ID, galleryPhase, type GalleryPhase } from '@/lib/booking/booking-view';
import {
  GALLERY_TABS,
  THUMB_ROW_HEIGHTS,
  buildZipEntries,
  filterGalleryByTab,
  galleryHeaderCounts,
  gallerySlug,
  galleryTabCounts,
  parseGalleryResponse,
  readGalleryFavourites,
  toggleFavourite,
  writeGalleryFavourites,
  type GalleryPayload,
  type GalleryPhoto,
  type GalleryTab,
  type ZipQuality,
} from '@/lib/booking/gallery-view';
import { GalleryGrid } from './gallery/GalleryGrid';
import { GalleryLightbox } from './gallery/GalleryLightbox';
import { DownloadAllDialog } from './gallery/DownloadAllDialog';
import { ShareDialog } from './gallery/ShareDialog';
import { useGalleryZip, zipJobLines } from './gallery/use-gallery-zip';

const TAB_LABEL: Record<GalleryTab, string> = {
  all: 'All',
  photos: 'Photos',
  videos: 'Videos',
  favs: 'Favourites',
};

/**
 * The guest's private online gallery (the delivery of a photography booking): hero, filterable
 * justified grid, favourites, select mode, ZIP download, share and lightbox.
 *
 * Three states, all decided by the SERVER (the gallery API withholds the photos, not just the UI):
 * invisible until the studio confirms the gallery complete; a "pay the balance" teaser while the
 * balance is owed (no photo URLs are ever sent for it); the full gallery once it is paid.
 */
export function BookingGallery({
  bookingRef,
  onPhase,
}: {
  bookingRef: string;
  /** Reports what this section found, so the page can step the booking card aside (booking-view.ts). */
  onPhase?: (phase: GalleryPhase) => void;
}) {
  const { session, loading: authLoading } = useAuth();
  const t = useT();
  const [data, setData] = useState<GalleryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  /** Bumped to look again — the post-payment poll below. */
  const [reloadTick, setReloadTick] = useState(0);

  const [tab, setTab] = useState<GalleryTab>('all');
  const [favs, setFavs] = useState<ReadonlySet<string>>(new Set());
  const [selMode, setSelMode] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [sizeIdx, setSizeIdx] = useState(1);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [lb, setLb] = useState<{ index: number; slideshow: boolean } | null>(null);
  const [dlOpen, setDlOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const zip = useGalleryZip();

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/v1/bookings/${bookingRef}/gallery`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
      .then(async (res) =>
        res.ok ? parseGalleryResponse(await res.json().catch(() => null)) : null,
      )
      .then((payload) => {
        if (cancelled) return;
        // A failed look-again (a transient error while polling after a payment) must not blank a
        // gallery we already know about — keep what we have.
        setData((cur) => payload ?? cur ?? { photos: [] });
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session, bookingRef, reloadTick]);

  useEffect(() => {
    setFavs(new Set(readGalleryFavourites(bookingRef)));
  }, [bookingRef]);

  const photos = useMemo(() => data?.photos ?? [], [data]);
  const meta = data?.meta ?? null;
  // A locked gallery carries NO photos (the API never sends the URLs), so "does a gallery exist" is
  // the truthful count in meta, not the length of the array.
  const locked = Boolean(data?.locked) && (meta?.photoCount ?? 0) > 0;
  const showsGallery = Boolean(data) && (photos.length > 0 || locked);

  // Tell the page what we found: for a delivered gallery opened by its own link it hides the
  // booking-confirmation card above us (the guest came for the photos, not the receipt).
  const phase = galleryPhase({
    authLoading,
    hasSession: Boolean(session),
    hasData: data !== null,
    open: showsGallery && !locked,
  });
  useEffect(() => {
    onPhase?.(phase);
  }, [phase, onPhase]);

  // Landing from a payment: the balance settles asynchronously, so while the gallery still reads
  // locked look again until it opens or the confirmation window elapses.
  useEffect(() => {
    if (!locked) return;
    const justPaid = new URLSearchParams(window.location.search).has('just_paid');
    const startedAt = Date.now();
    const keepGoing = () =>
      shouldKeepPollingGallery({
        locked: true,
        justPaid,
        elapsedMs: Date.now() - startedAt,
        maxMs: CONFIRM_POLL_MAX_MS,
      });
    if (!keepGoing()) return; // not reached from a payment — nothing to wait for
    const timer = setInterval(() => {
      if (!keepGoing()) {
        clearInterval(timer);
        return;
      }
      setReloadTick((n) => n + 1);
    }, CONFIRM_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [locked]);

  // The delivery email links to /bookings/REF#gallery; the section only exists once this fetch lands.
  useScrollToHash('gallery', showsGallery);

  const counts = useMemo(() => galleryTabCounts(photos, favs), [photos, favs]);
  const visible = useMemo(() => filterGalleryByTab(photos, tab, favs), [photos, tab, favs]);
  const rowHeight = THUMB_ROW_HEIGHTS[Math.min(sizeIdx, THUMB_ROW_HEIGHTS.length - 1)]!;

  const toggleFav = useCallback(
    (id: string) => {
      setFavs((cur) => {
        const next = toggleFavourite(cur, id);
        writeGalleryFavourites(bookingRef, next);
        return next;
      });
    },
    [bookingRef],
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onRatio = useCallback((id: string, ratio: number) => {
    setRatios((cur) => (Math.abs((cur[id] ?? 0) - ratio) > 0.01 ? { ...cur, [id]: ratio } : cur));
  }, []);

  const downloadOne = useCallback(
    (photo: GalleryPhoto) => {
      const [entry] = buildZipEntries([photo], {
        includePhotos: true,
        includeVideos: true,
        quality: 'originals',
        slug: gallerySlug(bookingRef),
      });
      if (entry)
        zip.run([entry], 'originals', `${gallerySlug(bookingRef)}-${entry.name.split('.')[0]}.zip`);
    },
    [bookingRef, zip],
  );

  const confirmDownloadAll = useCallback(
    (quality: ZipQuality, includePhotos: boolean, includeVideos: boolean) => {
      zip.run(
        buildZipEntries(photos, {
          includePhotos,
          includeVideos,
          quality,
          slug: gallerySlug(bookingRef),
        }),
        quality,
        `${gallerySlug(bookingRef)}.zip`,
      );
      setDlOpen(false);
    },
    [photos, zip, bookingRef],
  );

  // Nothing at all until we know a gallery exists: an ordinary tour booking (or a signed-out
  // visitor) must look exactly as it did before galleries existed — no skeleton, no layout jump.
  if (!session || loading || !data || !showsGallery) return null;

  /* ---- locked: delivered, but the balance is still due (no photo URLs were sent) ---- */
  if (locked) {
    return (
      <section id="gallery" className="mx-auto max-w-shell scroll-mt-6 px-6 py-10">
        <div className="relative overflow-hidden rounded-[18px] border border-ink/10 bg-white">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 flex flex-wrap gap-2 p-4 opacity-70 blur-[2px]"
          >
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                className="animate-gallery-shimmer rounded-[10px]"
                style={{ flexGrow: (i % 3) + 1, flexBasis: 200 + (i % 3) * 80, height: 150 }}
              />
            ))}
          </div>
          <div className="relative mx-auto flex max-w-md flex-col items-center gap-3 px-8 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-teal-tint text-teal-dark">
              <IconLock width={22} height={22} />
            </span>
            <h2 className="text-xl font-extrabold tracking-tight text-ink">
              {t('This gallery is waiting on the balance')}
            </h2>
            <p className="text-sm leading-relaxed text-ink-muted">
              {t(
                'Your photos are edited and ready. Pay the remaining balance and your private gallery opens instantly.',
              )}
            </p>
            <button
              type="button"
              onClick={() => {
                // The pay box sits higher up this same page (BookingConfirmation); fall back to the
                // top if it isn't rendered (e.g. the balance settled a moment ago).
                const box = document.getElementById('balance-payment');
                if (box) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
                else window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="mt-2 rounded-full bg-teal px-6 py-3 text-sm font-bold text-white transition hover:bg-teal-dark"
            >
              {typeof data?.balanceDueMinor === 'number' ? (
                <>
                  {t('Pay the balance')} · <Price eur={data.balanceDueMinor / 100} />
                </>
              ) : (
                t('Pay the balance')
              )}
            </button>
          </div>
        </div>
      </section>
    );
  }

  /* ---- unlocked: the full gallery ---- */
  const cover = photos[0]!;
  const shootDateLabel = meta?.shootDate
    ? new Date(meta.shootDate).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <section id="gallery" className="scroll-mt-6">
      {/* hero */}
      <div className="relative flex h-[clamp(340px,52vh,520px)] items-end overflow-hidden bg-ink text-white">
        <img
          {...responsiveImage(cover.url, { sizes: '100vw', widths: [1200, 1600, 2400] })}
          alt=""
          className="animate-gallery-ken-burns absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/35 to-ink/10" />
        <div className="relative mx-auto flex w-full max-w-shell flex-col gap-3 px-6 pb-10">
          <p className="animate-fade-up flex items-center gap-2 text-[13px] font-semibold text-white/80">
            {/* The gallery's own link hides the booking-confirmation card; "Your booking" brings it
                back (the page scrolls to it) and "Gallery" returns to the photos alone. */}
            <a
              href={`#${BOOKING_DETAILS_ID}`}
              // The card is about to appear ABOVE what the guest is looking at. From anywhere but the
              // top of the page the browser's scroll anchoring then holds the viewport on the gallery
              // and nothing seems to happen, so start from the top (BookingPageBody scrolls to it).
              onClick={() => window.scrollTo({ top: 0, behavior: 'instant' })}
              className="underline-offset-4 transition hover:text-white hover:underline"
            >
              {t('Your booking')}
            </a>
            <span aria-hidden>›</span>
            <a
              href="#gallery"
              className="underline-offset-4 transition hover:text-white hover:underline"
            >
              {t('Gallery')}
            </a>
          </p>
          <h1 className="animate-fade-up text-balance text-[clamp(32px,5vw,60px)] font-bold leading-[1.02] tracking-[-0.03em]">
            {meta?.packageTitle ?? t('Your gallery')}
          </h1>
          <p className="animate-fade-up text-[15px] text-white/85">
            {[
              shootDateLabel,
              meta?.location ?? null,
              t('{photos} photos · {videos} videos', galleryHeaderCounts(meta, counts)),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => setDlOpen(true)}
              className="flex items-center gap-2.5 rounded-full bg-white px-[22px] py-[13px] text-[15px] font-bold text-ink transition hover:bg-teal-tint"
            >
              <IconDownload width={18} height={18} />
              {t('Download all')}
            </button>
            <button
              type="button"
              onClick={() => setLb({ index: 0, slideshow: true })}
              className="flex items-center gap-2.5 rounded-full border-[1.5px] border-white/70 bg-ink/25 px-5 py-[11.5px] text-[15px] font-bold text-white backdrop-blur transition hover:bg-white/15"
            >
              <IconPlay width={14} height={14} />
              {t('Slideshow')}
            </button>
            <button
              type="button"
              onClick={() => setShareOpen(true)}
              className="flex items-center gap-2.5 rounded-full border-[1.5px] border-white/70 bg-ink/25 px-5 py-[11.5px] text-[15px] font-bold text-white backdrop-blur transition hover:bg-white/15"
            >
              <IconShare width={17} height={17} />
              {t('Share')}
            </button>
          </div>
        </div>
      </div>

      {/* sticky toolbar */}
      <div className="sticky top-0 z-30 border-b border-ink/10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-[64px] max-w-shell flex-wrap items-center gap-x-5 gap-y-2 px-6 py-3">
          {!selMode ? (
            <>
              <div
                role="tablist"
                aria-label={t('Filter gallery')}
                className="flex max-w-full gap-1.5 overflow-x-auto"
              >
                {GALLERY_TABS.map((id) => {
                  const on = tab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(id)}
                      className={`flex flex-none items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        on
                          ? 'border-ink bg-ink text-white'
                          : 'border-ink/10 bg-white text-ink hover:border-ink/30'
                      }`}
                    >
                      {t(TAB_LABEL[id])}
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          on ? 'bg-white/15 text-white' : 'bg-ink/[0.06] text-teal-dark'
                        }`}
                      >
                        {counts[id]}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="ml-auto flex items-center gap-2.5">
                <div
                  className="flex items-center gap-0.5 rounded-full border border-ink/10 p-[3px]"
                  title={t('Thumbnail size')}
                >
                  <button
                    type="button"
                    aria-label={t('Smaller thumbnails')}
                    disabled={sizeIdx === 0}
                    onClick={() => setSizeIdx((i) => Math.max(0, i - 1))}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full transition hover:bg-ink/5 disabled:opacity-35"
                  >
                    <IconMinus width={16} height={16} />
                  </button>
                  <span aria-hidden className="flex h-[18px] items-end gap-[3px] px-1">
                    {THUMB_ROW_HEIGHTS.map((_, i) => (
                      <span
                        key={i}
                        className={`w-[5px] rounded-[3px] transition ${i === sizeIdx ? 'bg-teal' : 'bg-ink/20'}`}
                        style={{ height: 5 + i * 4 }}
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    aria-label={t('Larger thumbnails')}
                    disabled={sizeIdx >= THUMB_ROW_HEIGHTS.length - 1}
                    onClick={() => setSizeIdx((i) => Math.min(THUMB_ROW_HEIGHTS.length - 1, i + 1))}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full transition hover:bg-ink/5 disabled:opacity-35"
                  >
                    <IconPlus width={16} height={16} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setSelMode(true)}
                  className="rounded-full border border-ink/10 bg-white px-[18px] py-2.5 text-sm font-bold text-ink transition hover:border-ink"
                >
                  {t('Select')}
                </button>
              </div>
            </>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-x-3.5 gap-y-2">
              <button
                type="button"
                aria-label={t('Cancel selection')}
                onClick={() => {
                  setSelMode(false);
                  setSelected(new Set());
                }}
                className="grid h-10 w-10 place-items-center rounded-full border border-ink/10 bg-white transition hover:border-ink"
              >
                <IconX width={18} height={18} />
              </button>
              <span className="text-[15px] font-bold text-ink">
                {t('{n} selected', { n: selected.size })}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.size >= visible.length ? new Set() : new Set(visible.map((p) => p.id)),
                  )
                }
                className="px-1 py-2 text-sm font-bold text-teal-dark"
              >
                {selected.size >= visible.length ? t('Deselect all') : t('Select all')}
              </button>
              <div className="ml-auto flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => {
                    for (const id of selected) if (!favs.has(id)) toggleFav(id);
                    setSelMode(false);
                    setSelected(new Set());
                  }}
                  className="flex items-center gap-2 rounded-full border border-ink/10 bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:border-ink disabled:opacity-50"
                >
                  <IconHeart width={16} height={16} />
                  {t('Add to favourites')}
                </button>
                <button
                  type="button"
                  disabled={selected.size === 0}
                  onClick={() => {
                    zip.run(
                      buildZipEntries(
                        photos.filter((p) => selected.has(p.id)),
                        {
                          includePhotos: true,
                          includeVideos: true,
                          quality: 'originals',
                          slug: gallerySlug(bookingRef),
                        },
                      ),
                      'originals',
                      `${gallerySlug(bookingRef)}-selection.zip`,
                    );
                    setSelMode(false);
                    setSelected(new Set());
                  }}
                  className="flex items-center gap-2 rounded-full bg-teal-dark px-[18px] py-2.5 text-sm font-bold text-white transition hover:bg-teal disabled:opacity-50"
                >
                  <IconDownload width={16} height={16} />
                  {t('Download ({n})', { n: selected.size })}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* grid */}
      <div className="mx-auto flex max-w-shell flex-col gap-4 px-6 py-6">
        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-ink/15 px-4 py-16 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-coral/10 text-coral">
              <IconHeart width={22} height={22} />
            </span>
            <h3 className="mt-1 text-lg font-bold text-ink">{t('No favourites yet')}</h3>
            <p className="text-sm text-ink-muted">
              {t('Tap the heart on any photo or video to save it here.')}
            </p>
          </div>
        ) : (
          <GalleryGrid
            t={t}
            photos={visible}
            rowHeight={rowHeight}
            selMode={selMode}
            selected={selected}
            favs={favs}
            ratios={ratios}
            onRatio={onRatio}
            onOpen={(p) => setLb({ index: visible.indexOf(p), slideshow: false })}
            onToggleFav={toggleFav}
            onToggleSelect={toggleSelect}
            onDownload={downloadOne}
          />
        )}

        {/* review band */}
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[18px] bg-teal-tint px-7 py-6">
          <span aria-hidden className="flex gap-[3px] text-gold-light">
            {Array.from({ length: 5 }).map((_, i) => (
              <IconStar key={i} width={18} height={18} />
            ))}
          </span>
          <div className="flex min-w-[240px] flex-1 flex-col gap-1">
            <span className="text-lg font-bold text-ink">{t('Loved your photos?')}</span>
            <span className="text-sm leading-relaxed text-ink-muted">
              {t('A short review helps other couples and families find us.')}
            </span>
          </div>
          <a
            href={SITE.googleReview}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-teal"
          >
            {t('Leave a Google review')}
          </a>
        </div>
      </div>

      {/* dialogs + lightbox + zip toast */}
      {dlOpen && (
        <DownloadAllDialog
          t={t}
          photos={photos}
          onConfirm={confirmDownloadAll}
          onClose={() => setDlOpen(false)}
        />
      )}
      {shareOpen && <ShareDialog t={t} onClose={() => setShareOpen(false)} />}
      {lb && (
        <GalleryLightbox
          t={t}
          items={visible}
          initialIndex={Math.max(0, lb.index)}
          slideshow={lb.slideshow}
          favs={favs}
          onToggleFav={toggleFav}
          onDownload={downloadOne}
          onClose={() => setLb(null)}
        />
      )}
      {zip.job && (
        <div
          role="status"
          className="animate-gallery-fade-in fixed bottom-5 right-5 z-[250] flex items-center gap-3 rounded-2xl border border-ink/10 bg-white p-4 shadow-[0_24px_50px_-20px_rgba(10,46,54,0.45)]"
        >
          {zip.job.status === 'running' ? (
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-teal/30 border-t-teal" />
          ) : zip.job.status === 'done' ? (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-teal text-white">
              <IconChevron width={14} height={14} className="-rotate-90" />
            </span>
          ) : (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-coral text-white">
              <IconX width={14} height={14} />
            </span>
          )}
          <div className="flex flex-col">
            <span className="text-sm font-bold text-ink">{zipJobLines(zip.job, t).title}</span>
            <span className="max-w-[260px] truncate text-xs text-ink-muted">
              {zipJobLines(zip.job, t).sub}
            </span>
          </div>
          <button
            type="button"
            aria-label={t('Dismiss')}
            onClick={zip.dismiss}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-muted transition hover:bg-ink/5 hover:text-ink"
          >
            <IconX width={14} height={14} />
          </button>
        </div>
      )}
    </section>
  );
}
