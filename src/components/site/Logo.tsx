import Link from 'next/link';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * Belle Mare Tours logo — full colour on every surface, in one of two files.
 *
 * The artwork's "Belle Mare" script is white, so it only reads on dark backgrounds. `logo-light.svg`
 * is the same artwork with just that script recoloured to the logo's own navy (#00135d) for white
 * surfaces; the pineapple, palms, waves and gold "Tours" are identical in both.
 *
 * Two files rather than a CSS filter, deliberately: the previous logo was a single teal gradient, so
 * `brightness-0 invert` reversed it to white cleanly. This logo is eleven colours — that filter would
 * crush all of them to one white silhouette and merge the palms, pineapple and waves into a blob.
 *
 * Sized taller than the old mark because this one is ~1.75:1 (a stacked scene over two lines of
 * script) where the old was a 4:1 wordmark; at the old h-12 it rendered ~84px wide and was unreadable.
 *
 * Both files are named for their surface rather than one reusing the old `/logo.svg` path. Public
 * assets are served straight through (`images: { unoptimized: true }`) under
 * `Cache-Control: max-age=14400`, and they carry no content hash — so swapping a path's CONTENTS
 * leaves every returning visitor on the previous logo for up to 4h. A new path is the fix; if the
 * artwork is ever replaced again, rename the file rather than overwrite it.
 */
export function Logo({
  tone = 'light',
  href = '/',
  className = 'h-14 w-auto sm:h-16',
  label = 'Belle Mare Tours — home',
}: {
  tone?: 'light' | 'dark';
  /** Where the logo links. Defaults to the public home; the back office passes `/admin`. */
  href?: string;
  /** Size/utility classes on the `<img>` (default = the public-header size). */
  className?: string;
  /** Accessible label for the link. */
  label?: string;
}) {
  return (
    <Link href={href} className="flex shrink-0 items-center no-underline" aria-label={label}>
      <img
        src={tone === 'dark' ? '/logo-dark.svg' : '/logo-light.svg'}
        alt="Belle Mare Tours"
        width={280}
        height={160}
        className={className}
      />
    </Link>
  );
}
