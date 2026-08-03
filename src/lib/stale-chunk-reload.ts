/**
 * Recovery for the "my tab is older than the deploy" failure.
 *
 * Chunk filenames carry a content hash, so shipping a release retires the exact URLs an already-open
 * tab is still waiting for. The next lazy import 404s or times out, the page sits half-loaded, and the
 * customer's next click does nothing. (Logged in error_logs on 2026-08-02, on a morning with several
 * deploys.) One reload fetches the current HTML and the chunk names that belong to it.
 *
 * Lives here rather than inside instrumentation-client because the SAME failure arrives through three
 * different doors: window.error, an unhandled promise rejection (a failed `import()` rejects rather
 * than throws), and React's error boundaries — which is the door the logged instance actually came
 * through (`kind: 'react.global'`). Covering only the first two left the real case unhandled.
 */

/** Shared with instrumentation-client, which clears it on a successful load. */
export const CHUNK_RELOAD_FLAG = 'gytm:chunk-reload';

export function isChunkLoadFailure(message: string, error?: unknown): boolean {
  if (error instanceof Error && error.name === 'ChunkLoadError') return true;
  // Safari and Firefox surface the same failure without the ChunkLoadError name.
  return /Loading chunk \S+ failed|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

/**
 * Reload ONCE for a stale-chunk failure. Guarded by a sessionStorage flag so a chunk that is
 * genuinely gone — a broken deploy, an ad-blocker eating the request — cannot put the browser in a
 * refresh loop; the second failure is left alone and simply reported. Never throws: it runs on paths
 * that are already handling a crash.
 */
export function reloadOnceForStaleChunks(message: string, error?: unknown): void {
  if (typeof window === 'undefined') return;
  if (!isChunkLoadFailure(message, error)) return;
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) return; // already tried — don't loop
    sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1');
    window.location.reload();
  } catch {
    /* storage disabled (private mode, embedded webview) — never reload without the guard */
  }
}
