'use client';

import { Suspense, lazy, useEffect, useState, type ComponentType } from 'react';
import { useT } from '@/components/site/PreferencesProvider';

/** Shown for the moment a viewer's code takes to arrive on the first open: the same dark backdrop as the viewer,
 *  so nothing flashes, with a quiet spinner. */
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

/**
 * Wraps a full-screen viewer so it is fetched only when somebody opens it, never on the server, and so that it
 * can fail to load without taking the page down. Both of the site's viewers — the tour / package gallery and the
 * customers' own gallery — go through this, so they load, fail and hand focus back the same way.
 *
 * `load` must be `() => import('./TheViewer')`. A viewer is the library, its plugins and their stylesheets: a
 * static import would put all of it in the first paint of a page, for something most visitors never open.
 *
 * - While the code arrives, a dark backdrop with a spinner stands in.
 * - If the code cannot be fetched (a tab left open across a deploy asks for a file the new build no longer has, or
 *   the connection drops) the viewer simply closes: a failed load costs the visitor one click instead of throwing
 *   the whole page to its error screen.
 * - When the viewer closes, focus goes back to what opened it. The library does this from a focus event, which a
 *   browser does not send when the page is not focused; reading `activeElement` does not depend on one — it is
 *   what the app's other dialogs (`useDialog`) do. Read once, before the viewer takes focus.
 *
 * `preload` starts the fetch ahead of the click (a hover, a focus, a touch), so the first open is instant. It is
 * safe to call again and again, and a failed fetch there is not an error: the real open tries again.
 */
export function lazyViewer<P extends { onClose: () => void }>(
  load: () => Promise<{ default: ComponentType<P> }>,
) {
  function Unavailable({ onClose }: P) {
    useEffect(() => {
      onClose();
    }, [onClose]);
    return null;
  }

  const Viewer = lazy(() => load().catch(() => ({ default: Unavailable })));

  function LazyViewer(props: P) {
    const [opener] = useState(() =>
      typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
    );
    useEffect(
      () => () => {
        if (opener?.isConnected) opener.focus?.();
      },
      [opener],
    );
    return (
      <Suspense fallback={<ViewerLoading />}>
        <Viewer {...props} />
      </Suspense>
    );
  }

  function preload(): void {
    void load().catch(() => undefined);
  }

  return { LazyViewer, preload };
}
