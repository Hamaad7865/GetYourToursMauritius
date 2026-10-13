/**
 * The safety net for resized photos (see ./resize.ts), as ONE inline script rendered first thing in <body>
 * — and only when resizing is switched on.
 *
 * It listens on the whole window, in the CAPTURE phase (an image's `error` event does not bubble), and when
 * a picture that was rewritten to a /cdn-cgi/image/ URL fails — feature off on this host (404), origin not
 * allow-listed (403), free quota used up (error 9422) — it puts the original back. `srcset` and `sizes` go
 * FIRST: if only `src` were reset, the browser would keep choosing from the broken candidates and the
 * picture would stay broken.
 *
 * Idempotent rather than one-shot: it swaps whenever the image's `src` is NOT already the original, and
 * stops when it is. So a photo that is broken everywhere (its original fails too) cannot loop, while
 * anything that puts the resized URL back later still gets rescued again. `data-src-original` stays on the
 * element for that reason.
 *
 * Why not React's `onError`: it misses images that fail BEFORE hydration, and it would turn every server
 * component that shows a photo into a client component.
 */
export const IMAGE_FALLBACK_SCRIPT =
  "(function(){window.addEventListener('error',function(e){var t=e.target;" +
  "if(!t||t.tagName!=='IMG')return;var o=t.getAttribute('data-src-original');" +
  "if(!o||t.getAttribute('src')===o)return;" +
  "t.removeAttribute('srcset');t.removeAttribute('sizes');t.src=o;},true);})();";
