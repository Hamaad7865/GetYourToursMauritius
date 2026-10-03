'use client';

import { lazyViewer } from '@/components/ui/lazyViewer';
import type { GalleryViewerProps } from './GalleryViewer';

const { LazyViewer, preload } = lazyViewer<GalleryViewerProps>(() => import('./GalleryViewer'));

/**
 * The customers' full-screen gallery viewer: render it while a file is open, and `onClose` when they leave it.
 * Photos and films, favourites, a download of the original, a slideshow — see `./GalleryViewer`. It is fetched on
 * demand and fails safe, and hands focus back to what opened it — see `@/components/ui/lazyViewer`.
 */
export const GalleryLightbox = LazyViewer;

/** Start fetching the viewer ahead of the click (a hover, a focus, a touch), so the first open is instant. */
export const preloadGalleryLightbox = preload;
