import type { Metadata } from 'next';
import { InfoPage } from '@/components/site/InfoPage';
import { LegalArticle, LegalSection, P, LegalList, Callout } from '@/components/site/Legal';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

const UPDATED = '20 June 2026';

export const metadata: Metadata = {
  title: `Cookie policy · ${SITE.operator}`,
  description: `Which cookies and similar browser storage ${SITE.name} uses, why, and how to manage them. We use no analytics or advertising cookies.`,
  alternates: { canonical: '/cookies' },
};

export default async function CookiesPage() {
  const t = await getT();

  const TOC = [
    { id: 'summary', label: t('In short') },
    { id: 'necessary', label: t('Strictly necessary') },
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
          <Callout tone="success" title={t('We use no analytics or advertising cookies.')}>
            {t(
              'We do not track you across the web, build advertising profiles, or share your browsing with ad networks. The only cookies and storage we use either keep the site working or are set by the maps and payment services we rely on.',
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

        <LegalSection id="third-party" title={t('Third-party cookies')}>
          <P>
            {t(
              'Two services we embed may set their own cookies when their content loads. We don’t control these cookies; they are governed by each provider’s own policy.',
            )}
          </P>
          <LegalList
            items={[
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
            ]}
          />
        </LegalSection>

        <LegalSection id="manage" title={t('How to manage or clear cookies')}>
          <P>
            {t(
              'You can clear or block cookies and site storage at any time through your browser settings — usually under “Privacy” or “Cookies and site data”. Blocking strictly necessary cookies will stop parts of the site, such as signing in and checkout, from working.',
            )}
          </P>
        </LegalSection>

        <LegalSection id="more" title={t('More information')}>
          <P>
            {t('For how we handle your personal data more broadly, see our ')}
            <a href="/privacy">{t('Privacy policy')}</a>
            {t('. For any question, contact ')}
            <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
          </P>
        </LegalSection>
      </LegalArticle>
    </InfoPage>
  );
}
