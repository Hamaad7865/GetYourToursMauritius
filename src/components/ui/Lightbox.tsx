'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import type { ViewerItem } from '@/lib/images/viewer-slides';
import type { LightboxViewerProps } from './LightboxViewer';

/** One thing in a gallery: a photo, an uploaded video, or a YouTube / Vimeo link. */
export type LightboxItem = ViewerItem;

/** Shown for the moment the viewer's code takes to arrive on the first open: the same dark backdrop, so
 *  nothing flashes, with a quiet spinner. */
function ViewerLoading() {
  const t = useT();
  return (
    <div
      role="status"
      aria-label={t('Loading…')}
      className="fixed inset-0 z-[9999] grid place-items-center bg-[rgb(7,30,36)]"
    >
      <span
        aria-hidden
        className="h-8 w-8 animate-spin rounded-full border-2 border-white/25 border-t-white"
      />
    </div>
  );
}

/** Stands in when the viewer's code cannot be fetched: a tab left open across a deploy asks for a file the new
 *  build no longer has, or the connection drops. It closes the viewer, so a failed load costs the visitor one
 *  click instead of throwing the whole page to its error screen. */
function ViewerUnavailable({ onClose }: LightboxViewerProps) {
  useEffect(() => {
    onClose();
  }, [onClose]);
  return null;
}

// The viewer — the library, its plugins and their stylesheets — loads on demand and never on the server: a
// static import would put all of it in the first paint of every tour page, for something most visitors never open.
const Viewer = dynamic(
  () => import('./LightboxViewer').catch(() => ({ default: ViewerUnavailable })),
  { ssr: false, loading: () => <ViewerLoading /> },
);

/** Start fetching the viewer ahead of the click (a hover, a focus, a touch), so the first open is instant.
 *  Safe to call again and again: the module is fetched once. A failed fetch here is not an error — the real
 *  open tries again and, if that fails too, falls back to `ViewerUnavailable`. */
export function preloadLightbox(): void {
  void import('./LightboxViewer').catch(() => undefined);
}

/**
 * The full-screen photo viewer, as the galleries use it: render it while the viewer should be open, and
 * `onClose` when the visitor leaves it. See `./LightboxViewer` for what it does and why callers need no
 * dialog plumbing of their own.
 */
export function Lightbox(props: { items: LightboxItem[]; index: number; onClose: () => void }) {
  // Focus goes back to what opened the viewer. The library does this from a focus event, which a browser
  // does not send when the page is not focused; reading `activeElement` does not depend on one — it is
  // what the app's other dialogs (`useDialog`) do. Read once, before the viewer takes focus.
  const [opener] = useState(() =>
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      if (opener?.isConnected) opener.focus?.();
    },
    [opener],
  );
  return <Viewer {...props} />;
}
