'use client';

import { responsiveImage } from '@/lib/images/resize';
import { PHOTO_THUMB } from '@/lib/images/presets';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconExpand,
  IconHeart,
  IconHeartFill,
  IconPause,
  IconPlay,
  IconVolume,
  IconVolumeX,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@/components/ui/icons';
import { isVideoUrl } from '@/lib/media';
import {
  formatClock,
  mediaBaseName,
  type GalleryPhoto,
  type TFn,
} from '@/lib/booking/gallery-view';

/* eslint-disable @next/next/no-img-element -- gallery photos are external Supabase URLs. */

/**
 * Fullscreen gallery viewer per the handoff: counter + filename, zoom in/out/reset (buttons,
 * wheel, click toggle, drag-to-pan), video playback with seek / mute / fullscreen, a thumbnail
 * strip, prev/next (buttons + swipe), a 4s slideshow with a progress bar, download and
 * favourite. Keyboard: Esc, arrows, +/−, 0, Space (video play/pause). Body scroll locks while
 * open. Pinch-zoom is the one design gesture intentionally left out (buttons/wheel/click cover
 * it on desktop; pinch keeps native page-zoom semantics on touch).
 */

const SLIDESHOW_MS = 4000;

export function GalleryLightbox({
  t,
  items,
  initialIndex,
  slideshow,
  favs,
  onToggleFav,
  onDownload,
  onClose,
}: {
  t: TFn;
  items: readonly GalleryPhoto[];
  initialIndex: number;
  slideshow: boolean;
  favs: ReadonlySet<string>;
  onToggleFav: (id: string) => void;
  onDownload: (photo: GalleryPhoto) => void;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [dir, setDir] = useState(1);
  const [pct, setPct] = useState(100);
  const [grabbing, setGrabbing] = useState(false);
  const [show, setShow] = useState(slideshow);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [hint, setHint] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const z = useRef(1);
  const tx = useRef(0);
  const ty = useRef(0);
  const drag = useRef<{ x0: number; y0: number; tx0: number; ty0: number; moved: boolean } | null>(
    null,
  );
  const hintShown = useRef(false);

  const item = items[index];
  const isVideo = item ? isVideoUrl(item.url) : false;

  const applyTf = useCallback((anim: boolean) => {
    const el = wrapRef.current;
    if (!el) return;
    el.style.transition = anim ? 'transform .3s cubic-bezier(0.22,1,0.36,1)' : 'none';
    el.style.transform = `translate3d(${tx.current}px,${ty.current}px,0) scale(${z.current})`;
  }, []);

  const clampPan = useCallback(() => {
    const el = wrapRef.current;
    const st = stageRef.current;
    if (!el || !st) return;
    const mx = Math.max(0, (el.offsetWidth * z.current - st.clientWidth) / 2);
    const my = Math.max(0, (el.offsetHeight * z.current - st.clientHeight) / 2);
    tx.current = Math.max(-mx, Math.min(mx, tx.current));
    ty.current = Math.max(-my, Math.min(my, ty.current));
  }, []);

  const resetZoom = useCallback(
    (anim: boolean) => {
      z.current = 1;
      tx.current = 0;
      ty.current = 0;
      applyTf(anim);
      setPct(100);
    },
    [applyTf],
  );

  const go = useCallback(
    (d: number) => {
      const n = items.length;
      if (n < 2) return;
      z.current = 1;
      tx.current = 0;
      ty.current = 0;
      setDir(d);
      setIndex((i) => (i + d + n) % n);
      setPct(100);
      setTime(0);
    },
    [items.length],
  );

  const jump = useCallback(
    (i: number) => {
      if (i === index) return;
      setDir(i > index ? 1 : -1);
      z.current = 1;
      tx.current = 0;
      ty.current = 0;
      setIndex(i);
      setPct(100);
      setTime(0);
    },
    [index],
  );

  const zoomAt = useCallback(
    (z2: number, cx: number, cy: number, anim: boolean) => {
      const next = Math.max(1, Math.min(4, z2));
      const k = next / z.current;
      tx.current = cx - k * (cx - tx.current);
      ty.current = cy - k * (cy - ty.current);
      z.current = next;
      if (next <= 1.001) {
        z.current = 1;
        tx.current = 0;
        ty.current = 0;
      }
      clampPan();
      applyTf(anim);
      setPct(Math.round(z.current * 100));
    },
    [clampPan, applyTf],
  );

  const zoomBy = useCallback(
    (f: number) => {
      if (isVideo) return;
      zoomAt(z.current * f, 0, 0, true);
    },
    [isVideo, zoomAt],
  );

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      setShow(false);
      void v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, []);

  // First-open hint pill (once per mount).
  useEffect(() => {
    if (hintShown.current) return;
    hintShown.current = true;
    setHint(true);
    const id = setTimeout(() => setHint(false), 3800);
    return () => clearTimeout(id);
  }, []);

  // Body scroll lock + Esc/arrows/+/-/0/Space.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.5);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.5);
      else if (e.key === '0') resetZoom(true);
      else if (e.key === ' ' && isVideo) {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [go, onClose, isVideo, zoomBy, resetZoom, togglePlay]);

  // Wheel zoom (native listener: must be non-passive).
  useEffect(() => {
    const st = stageRef.current;
    if (!st) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!item || isVideoUrl(item.url)) return;
      const r = st.getBoundingClientRect();
      const cx = e.clientX - r.left - r.width / 2;
      const cy = e.clientY - r.top - r.height / 2;
      zoomAt(z.current * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0022)), cx, cy, false);
    };
    st.addEventListener('wheel', onWheel, { passive: false });
    return () => st.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoomAt reads/writes refs only
  }, [item]);

  // Keep the active thumbnail in view.
  useEffect(() => {
    const strip = stripRef.current;
    const btn = strip?.querySelector(`[data-idx="${index}"]`);
    if (strip && btn && 'offsetLeft' in btn) {
      const b = btn as HTMLElement;
      strip.scrollTo({
        left: b.offsetLeft - strip.clientWidth / 2 + b.offsetWidth / 2,
        behavior: 'smooth',
      });
    }
  }, [index]);

  // Slideshow: 4s per photo; a video item advances itself on 'ended' instead.
  useEffect(() => {
    if (!show || !item || isVideo) return;
    const id = setTimeout(() => go(1), SLIDESHOW_MS);
    return () => clearTimeout(id);
  }, [show, index, item, isVideo, go]);

  // Attempt autoplay when landing on a video.
  useEffect(() => {
    const v = videoRef.current;
    if (v && isVideo) void v.play().catch(() => {});
  }, [index, isVideo]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, y0: e.clientY, tx0: tx.current, ty0: ty.current, moved: false };
    if (z.current > 1) setGrabbing(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (z.current > 1) {
      tx.current = d.tx0 + dx;
      ty.current = d.ty0 + dy;
      clampPan();
    } else {
      tx.current = dx;
      ty.current = 0;
    }
    applyTf(false);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    setGrabbing(false);
    if (!d || !item) return;
    const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (isVideo) {
        togglePlay();
        return;
      }
      const st = stageRef.current;
      const r = st?.getBoundingClientRect();
      if (!r) return;
      if (z.current > 1) resetZoom(true);
      else zoomAt(2.5, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2, true);
      return;
    }
    if (z.current === 1) {
      if (dx < -70) go(1);
      else if (dx > 70) go(-1);
      else {
        tx.current = 0;
        ty.current = 0;
        applyTf(true);
      }
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    v.currentTime = ratio * duration;
    setTime(ratio * duration);
  };

  const fullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void rootRef.current?.requestFullscreen?.();
    } catch {
      /* unsupported — button is a no-op */
    }
  };

  if (!item) return null;
  const fav = favs.has(item.id);
  const anim = dir < 0 ? 'animate-gallery-lb-in-l' : 'animate-gallery-lb-in-r';

  const toolBtn =
    'grid h-10 w-10 place-items-center rounded-full text-white transition hover:bg-white/15 disabled:opacity-35';

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('Photo viewer')}
      className="animate-gallery-fade-in fixed inset-0 z-[280] flex flex-col bg-[#061a1f] text-white"
    >
      {/* Top bar */}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-2 py-2.5 pl-5 pr-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="whitespace-nowrap text-[15px] font-bold tabular-nums">
            {index + 1} / {items.length}
          </span>
          <span className="truncate text-[13px] text-[#9fb5b8]">{mediaBaseName(item.url)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-0.5">
          <button
            type="button"
            onClick={() => zoomBy(1 / 1.5)}
            disabled={isVideo}
            aria-label={t('Zoom out')}
            className={toolBtn}
          >
            <IconZoomOut width={20} height={20} />
          </button>
          <button
            type="button"
            onClick={() => resetZoom(true)}
            disabled={isVideo}
            aria-label={t('Reset zoom')}
            className="h-10 min-w-[58px] rounded-full px-2 text-[13px] font-bold tabular-nums transition hover:bg-white/15 disabled:opacity-35"
          >
            {isVideo ? '100%' : `${pct}%`}
          </button>
          <button
            type="button"
            onClick={() => zoomBy(1.5)}
            disabled={isVideo}
            aria-label={t('Zoom in')}
            className={toolBtn}
          >
            <IconZoomIn width={20} height={20} />
          </button>
          <span className="mx-1.5 h-[22px] w-px bg-white/15" aria-hidden="true" />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? t('Pause slideshow') : t('Play slideshow')}
            title={t('Slideshow')}
            className={`${toolBtn} ${show ? 'bg-white/15' : ''}`}
          >
            {show ? <IconPause width={16} height={16} /> : <IconPlay width={16} height={16} />}
          </button>
          <button
            type="button"
            onClick={() => onToggleFav(item.id)}
            aria-label={fav ? t('Remove from favourites') : t('Add to favourites')}
            className={toolBtn}
          >
            {fav ? (
              <IconHeartFill width={20} height={20} className="text-coral" />
            ) : (
              <IconHeart width={20} height={20} />
            )}
          </button>
          <button
            type="button"
            onClick={() => onDownload(item)}
            aria-label={t('Download')}
            className={toolBtn}
          >
            <IconDownload width={20} height={20} />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className={`${toolBtn} ml-1 bg-white/10 hover:bg-white/20`}
          >
            <IconX width={20} height={20} />
          </button>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden"
        style={{
          cursor: isVideo ? 'pointer' : grabbing ? 'grabbing' : pct > 100 ? 'grab' : 'zoom-in',
        }}
      >
        {show && (
          <span
            key={`bar-${index}`}
            className="animate-gallery-bar absolute left-0 top-0 z-[2] h-[3px] w-full bg-coral"
          />
        )}
        <span
          className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3.5 py-2 text-[13px] font-semibold transition-opacity duration-500"
          style={{ opacity: hint && !isVideo ? 1 : 0 }}
        >
          {t('Scroll to zoom · drag to move')}
        </span>
        <div ref={wrapRef} className="relative will-change-transform">
          {isVideo ? (
            <div key={item.id} className={`relative overflow-hidden rounded-md ${anim}`}>
              <video
                ref={videoRef}
                src={item.url}
                playsInline
                muted={muted}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                onEnded={() => {
                  setPlaying(false);
                  if (show) go(1);
                }}
                className="block max-h-[calc(100vh-176px)] max-w-[calc(100vw-40px)] rounded-md shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)] sm:max-w-[calc(100vw-160px)]"
              />
              {!playing && (
                <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-[72px] w-[72px] -translate-x-1/2 -translate-y-1/2 animate-pop place-items-center rounded-full bg-white/90 text-ink shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                  <IconPlay width={26} height={26} className="ml-1" />
                </span>
              )}
              {/* Video controls */}
              <div
                data-nodrag="1"
                className="absolute inset-x-0 bottom-0 flex cursor-default flex-col gap-1.5 rounded-b-md bg-gradient-to-t from-black/70 to-transparent px-3 pb-2.5 pt-8"
              >
                <div
                  role="slider"
                  aria-label={t('Seek')}
                  aria-valuemin={0}
                  aria-valuemax={Math.round(duration)}
                  aria-valuenow={Math.round(time)}
                  onClick={seek}
                  className="relative flex h-4 cursor-pointer items-center"
                >
                  <div className="relative h-1 w-full rounded-full bg-white/30">
                    <div
                      className="absolute bottom-0 left-0 top-0 rounded-full bg-white"
                      style={{ width: `${duration ? (time / duration) * 100 : 0}%` }}
                    />
                    <span
                      className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                      style={{ left: `${duration ? (time / duration) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={playing ? t('Pause') : t('Play')}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full transition hover:bg-white/15"
                  >
                    {playing ? (
                      <IconPause width={16} height={16} />
                    ) : (
                      <IconPlay width={16} height={16} />
                    )}
                  </button>
                  <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums">
                    {formatClock(time)} / {formatClock(duration)}
                  </span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={() => setMuted((m) => !m)}
                    aria-label={muted ? t('Unmute') : t('Mute')}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full transition hover:bg-white/15"
                  >
                    {muted ? (
                      <IconVolumeX width={18} height={18} />
                    ) : (
                      <IconVolume width={18} height={18} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={fullscreen}
                    aria-label={t('Full screen')}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full transition hover:bg-white/15"
                  >
                    <IconExpand width={17} height={17} />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <img
              key={item.id}
              {...responsiveImage(item.url, { sizes: '100vw', widths: [1600, 2400] })}
              alt=""
              draggable={false}
              className={`block max-h-[calc(100vh-176px)] max-w-[calc(100vw-40px)] select-none rounded shadow-[0_30px_80px_-24px_rgba(0,0,0,0.7)] sm:max-w-[calc(100vw-160px)] ${anim}`}
            />
          )}
        </div>

        {items.length > 1 && (
          <>
            <button
              type="button"
              data-nodrag="1"
              onClick={() => go(-1)}
              aria-label={t('Previous')}
              className="absolute left-3 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur-sm transition hover:bg-white/20"
            >
              <IconChevronLeft width={24} height={24} />
            </button>
            <button
              type="button"
              data-nodrag="1"
              onClick={() => go(1)}
              aria-label={t('Next')}
              className="absolute right-3 top-1/2 grid h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 backdrop-blur-sm transition hover:bg-white/20"
            >
              <IconChevronRight width={24} height={24} />
            </button>
          </>
        )}
      </div>

      {/* Thumbnail strip */}
      <div ref={stripRef} className="flex flex-none gap-1.5 overflow-x-auto px-4 pb-4 pt-3">
        {items.map((p, i) => {
          const video = isVideoUrl(p.url);
          return (
            <button
              key={p.id}
              type="button"
              data-idx={i}
              onClick={() => jump(i)}
              aria-label={t('Open item {n}', { n: i + 1 })}
              aria-current={i === index}
              className={`relative h-14 w-16 flex-none overflow-hidden rounded-md transition ${
                i === index ? 'opacity-100 ring-2 ring-white' : 'opacity-50 hover:opacity-100'
              }`}
            >
              {video ? (
                <video
                  src={p.url}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  {...responsiveImage(p.url, PHOTO_THUMB)}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              )}
              {video && (
                <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-black/60">
                  <IconPlay width={7} height={7} className="text-white" />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
