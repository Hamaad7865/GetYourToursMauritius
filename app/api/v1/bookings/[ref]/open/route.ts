import { apiHandler } from '@/lib/http/handler';
import { NotFoundError } from '@/lib/services/errors';
import {
  bookingRefLooksValid,
  buildGuestLinkCookie,
  guestLinkLandingPath,
  guestTokenLooksValid,
} from '@/lib/guest/link-cookie';
import { LANG_COOKIE, PREF_MAX_AGE, isLocale } from '@/lib/i18n/config';

export const runtime = 'edge';

type RouteCtx = { params: Promise<{ ref: string }> };

/**
 * GET /api/v1/bookings/:ref/open?t=… — the target of the manage link in a guest booking's emails.
 *
 * ITS WHOLE JOB is to get the token out of the URL before any page loads: it moves it into an httpOnly
 * cookie and redirects to the clean booking page, like /api/v1/quotes/{ref}/open.
 *
 * IT MUST NEVER CHANGE ANYTHING, and it reads nothing. Mail scanners fetch every link in an email
 * (Microsoft's 104.47.x already hit our /verify), so a GET here cannot create a session or move a
 * booking. The token is checked by POST /adopt, after the guest taps "View my booking". It is also why
 * a real ref and an invented one get the same redirect: nothing here can be used to probe which exist.
 */
export const GET = apiHandler<RouteCtx>(async (req, { params }) => {
  const { ref } = await params;
  if (!bookingRefLooksValid(ref)) throw new NotFoundError('Not found');

  const url = new URL(req.url);
  const token = url.searchParams.get('t') ?? '';
  const lang = url.searchParams.get('l');
  const headers = new Headers({
    location: guestLinkLandingPath(ref),
    'cache-control': 'no-store',
  });
  if (guestTokenLooksValid(token)) headers.append('set-cookie', buildGuestLinkCookie(ref, token));
  // /bookings has no /fr URL, so the language is the cookie, and a new device has none yet. Only ever
  // fills that gap: a visitor who has chosen a language keeps it.
  const hasLanguage = (req.headers.get('cookie') ?? '').includes(`${LANG_COOKIE}=`);
  if (isLocale(lang) && lang !== 'en' && !hasLanguage) {
    headers.append(
      'set-cookie',
      `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${PREF_MAX_AGE}; SameSite=Lax`,
    );
  }

  // 302 replaces the history entry, so the tokenised URL is not left in the back button.
  return new Response(null, { status: 302, headers });
});
