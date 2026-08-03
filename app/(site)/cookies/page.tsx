import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { CookieSettingsButton } from '@/components/site/CookieSettingsButton';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

const UPDATED = '27 July 2026';

export const metadata: Metadata = {
  // absolute: the title already names the brand — stop the root "%s | Belle Mare Tours" template doubling it.
  title: { absolute: `Cookie policy · ${SITE.operator}` },
  description: `Which cookies and similar browser storage ${SITE.name} uses, why, and how to manage them — including analytics cookies, which run only with your consent.`,
  alternates: { canonical: '/cookies' },
};

export default async function CookiesPage() {
  const t = await getT();

  const TOC = [
    { id: 'summary', label: t('In short') },
    { id: 'necessary', label: t('Strictly necessary') },
    { id: 'analytics', label: t('Analytics') },
    { id: 'third-party', label: t('Third-party cookies') },
    { id: 'retention', label: t('How long they last') },
    { id: 'manage', label: t('How to manage or clear cookies') },
    { id: 'more', label: t('More information') },
  ];

  return (
    <InfoPage
      eyebrow={t('Legal')}
      title={t('Cookie policy')}
      intro={t(
        'This page explains the cookies and similar browser storage we use, what each one is for, and the control you have over them.',
      )}
      meta={`${t('Last updated')} ${UPDATED} · ${SITE.legalName}`}
    >
      <LegalArticle toc={TOC}>
        <LegalSection id="summary" title={t('In short')}>
          <Callout tone="success" title={t('Analytics cookies run only if you allow them.')}>
            {t(
              'Necessary cookies keep the site working and are always on. Analytics cookies help us see which pages are useful, and they stay switched off until you accept them. We do not run advertising cookies at all unless you opt in, and we never sell your browsing to anyone.',
            )}
          </Callout>
        </LegalSection>

        <LegalSection id="necessary" title={t('Strictly necessary')}>
          <P>
            {t(
              'These are first-party cookies and browser storage that the site needs to work. They are not optional — without them, signing in, your cart and checkout would not function.',
            )}
          </P>
          <LegalList
            items={[
              <>
                <strong>{t('Staying signed in')}</strong>
                {t(' — keeps your session active so you don’t have to log in on every page.')}
              </>,
              <>
                <strong>{t('Your shopping cart')}</strong>
                {t(' — remembers the activities you’ve added before you check out.')}
              </>,
              <>
                <strong>{t('Booking & checkout progress')}</strong>
                {t(' — holds your selections and step while you complete a booking.')}
              </>,
              <>
                <strong>{t('Language & currency')}</strong>
                {t(' — remembers whether you browse in English or French, and in EUR or USD.')}
              </>,
              <>
                <strong>{t('Your wishlist')}</strong>
                {t(' — saves the activities you’ve marked to come back to.')}
              </>,
              <>
                <strong>{t('Recent searches')}</strong>
                {t(' — shows your latest searches in the search box for convenience.')}
              </>,
              <>
                <strong>{t('In-app notifications')}</strong>
                {t(' — stores booking and cart alerts (for example, a hold about to expire).')}
              </>,
            ]}
          />
          <P>
            {t(
              'These are all first-party — set by us, read only by us — and are required for the site to work.',
            )}
          </P>
        </LegalSection>

        <LegalSection id="analytics" title={t('Analytics')}>
          <P>
            {t(
              'With your consent, we use Google Analytics (loaded through Google Tag Manager) to understand how the site is used — which pages people read, which tours they look at, and where visitors arrive from. It helps us decide what to improve.',
            )}
          </P>
          <LegalList
            items={[
              <>
                <strong>{t('Off until you accept')}</strong>
                {t(
                  ' — analytics storage is denied when you arrive. It stays denied if you choose “Reject all”. Accepting — either by pressing “Accept all” or by continuing to scroll the page, as the banner states — turns it on.',
                )}
              </>,
              <>
                <strong>{t('What we see')}</strong>
                {t(
                  ' — aggregated visit statistics: pages viewed, approximate location, device and browser, and the site or search that referred you.',
                )}
              </>,
              <>
                <strong>{t('What we don’t')}</strong>
                {t(
                  ' — we do not use it to identify you personally, and we do not combine it with your booking details.',
                )}
              </>,
              <>
                <strong>{t('Marketing')}</strong>
                {t(
                  ' — a separate, independent choice, off unless you switch it on. It covers advertising and remarketing cookies.',
                )}
              </>,
            ]}
          />
          <P>
            {t(
              'You can change or withdraw your choice at any time, and it takes effect immediately:',
            )}
          </P>
          <div className="mt-3">
            <CookieSettingsButton />
          </div>
        </LegalSection>

        <LegalSection id="third-party" title={t('Third-party cookies')}>
          <P>
            {t(
              'Some services we embed may set their own cookies when their content loads. We don’t control these cookies; they are governed by each provider’s own policy.',
            )}
          </P>
          <LegalList
            items={[
              <>
                <strong>Google Analytics / Google Tag Manager</strong>
                {t(
                  ' — only once you accept analytics cookies (see above). Until then the tag loads in a consent-denied mode that sets no cookies.',
                )}
              </>,
              <>
                <strong>Google Maps</strong>
                {t(
                  ' — loads on activity, planner and checkout pages to show pickup points, routes and locations. Google may set its own cookies when the map loads. See ',
                )}
                <a
                  href="https://policies.google.com/technologies/cookies"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('Google’s cookie policy')}
                </a>
                .
              </>,
              <>
                <strong>Peach Payments</strong>
                {t(
                  ' — provides the secure payment widget (checkout.js) on the payment page. It may set payment-session cookies needed to process your transaction safely.',
                )}
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="retention" title={t('How long they last')}>
          <LegalList
            items={[
              <>
                <strong>{t('Preferences')}</strong>
                {t(' — your language and currency are remembered for about a year.')}
              </>,
              <>
                <strong>{t('Session & booking storage')}</strong>
                {t(
                  ' — cleared when you sign out or finish your booking, and your sign-in session expires on its own after a period of inactivity.',
                )}
              </>,
              <>
                <strong>{t('Analytics')}</strong>
                {t(
                  ' — if you accept them, Google Analytics cookies last up to two years. Rejecting or changing your choice stops them immediately.',
                )}
              </>,
              <>
                <strong>{t('Your cookie choice')}</strong>
                {t(
                  ' — remembered in your browser so we don’t ask on every visit. Clearing your browser storage resets it and the banner returns.',
                )}
              </>,
            ]}
          />
        </LegalSection>

        <LegalSection id="manage" title={t('How to manage or clear cookies')}>
          <P>
            {t(
              'The quickest route is the button in the Analytics section above — it reopens the consent panel, and any change applies straight away.',
            )}
          </P>
          <P>
            {t(
              'You can also clear or block cookies and site storage at any time through your browser settings — usually under “Privacy” or “Cookies and site data”. Blocking strictly necessary cookies will stop parts of the site, such as signing in and checkout, from working.',
            )}
          </P>
        </LegalSection>

        <LegalSection id="more" title={t('More information')}>
          <P>
            {t('For how we handle your personal data more broadly, see our ')}
            <Link href="/privacy">{t('Privacy policy')}</Link>
            {t('. For any question, contact ')}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
          </P>
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}
