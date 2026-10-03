'use client';

import type { ViewerItem } from '@/lib/images/viewer-slides';
import type { LightboxViewerProps } from './LightboxViewer';
import { lazyViewer } from './lazyViewer';

/** One thing in a gallery: a photo, an uploaded video, or a YouTube / Vimeo link. */
export type LightboxItem = ViewerItem;

const { LazyViewer, preload } = lazyViewer<LightboxViewerProps>(() => import('./LightboxViewer'));

/**
 * The full-screen photo viewer, as the tour and package galleries use it: render it while the viewer should be
 * open, and `onClose` when the visitor leaves it. It is fetched on demand and fails safe — see `./lazyViewer`;
 * see `./LightboxViewer` for what it does and why callers need no dialog plumbing of their own.
 */
export const Lightbox = LazyViewer;

/** Start fetching the viewer ahead of the click (a hover, a focus, a touch), so the first open is instant. */
export const preloadLightbox = preload;
