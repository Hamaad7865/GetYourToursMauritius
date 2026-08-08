import Link from 'next/link';
import { Logo } from './Logo';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { IconChat, IconMail } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';

/**
 * Stand-in for the WhatsApp deep link in the static COLUMNS below. The real href carries a
 * pre-filled message that has to be translated, and `t()` only exists once the component runs — so
 * the link is resolved at render. It is NOT a URL and must never reach the DOM.
 */
const WHATSAPP_LINK = 'whatsapp:compose';

/** Same idea for the mailto: — the address lives in SITE, not in this static link table. */
const EMAIL_LINK = 'mailto:compose';

const COLUMNS = [
  {
    title: 'Activities',
    links: [
      { label: 'Mauritius activities', href: '/activities' },
      { label: 'Mauritius tours', href: '/mauritius-tours' },
      { label: 'Catamaran cruises', href: '/mauritius-catamaran-cruise' },
      { label: 'Île aux Cerfs', href: '/ile-aux-cerfs-tours' },
      { label: 'Dolphin swims', href: '/dolphin-swim-mauritius' },
      {
        label: 'Sea walks & diving',
        href: `/activities?category=${encodeURIComponent('Sea walks & diving')}`,
      },
      {
        label: 'Sightseeing tours',
        href: `/activities?category=${encodeURIComponent('Sightseeing tours')}`,
      },
    ],
  },
  {
    title: 'Transport & rentals',
    links: [
      { label: 'Airport transfers', href: '/airport-transfers' },
      { label: 'Car & scooter rental', href: '/rent' },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Mauritius travel guide', href: '/mauritius-travel-guide' },
      { label: 'Mauritius destinations', href: '/destinations' },
      { label: 'Things to do in Mauritius', href: '/attractions' },
      // The Belle Mare area guide is the page that ranks for the bare query "belle mare" (the
      // legacy visitemaurice.com article 301s into it). It was reachable only from /destinations,
      // the things-to-do guide and the sitemap — so the site's own indexed pages passed it nothing.
      // A footer entry links it from every page on the site.
      { label: 'Belle Mare area guide', href: '/destinations/belle-mare' },
      { label: 'Things to do in Belle Mare', href: '/things-to-do-in-belle-mare' },
      { label: 'Mauritius travel blog', href: '/blog' },
      { label: 'Belle Mare Tours', href: '/belle-mare-tours' },
      { label: 'About Belle Mare Tours', href: '/about' },
      { label: 'Contact & pickups', href: '/contact' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Guest reviews', href: '/reviews' },
      { label: 'Help centre', href: '/help' },
      { label: 'FAQ', href: '/help' },
      { label: 'WhatsApp us', href: WHATSAPP_LINK },
      { label: 'Email us', href: EMAIL_LINK },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of service', href: '/terms' },
      { label: 'Privacy policy', href: '/privacy' },
      { label: 'Cookie policy', href: '/cookies' },
      { label: 'Cancellations & refunds', href: '/refunds' },
    ],
  },
];

export async function SiteFooter() {
  const t = await getT();
  // Both WhatsApp entry points used to be href="#whatsapp" — which was this footer's OWN id, so
  // clicking "Chat on WhatsApp" scrolled to the footer and did nothing else. The id is gone with
  // them: nothing else referenced it, and a self-referencing anchor is what disguised the bug.
  const whatsapp = whatsappUrl(t('Hi Belle Mare Tours! I have a question.'));
  return (
    <footer className="bg-ink text-cream/80">
      <div className="mx-auto max-w-shell px-6 pb-7 pt-14">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-md">
            <div className="mb-4">
              <Logo tone="dark" />
            </div>
            <p className="m-0 text-sm leading-relaxed text-cream/70">
              {t('{name} is the official booking platform of', { name: SITE.name })}{' '}
              <b className="font-semibold text-cream">{SITE.operator}</b>
              {t(', a licensed tour operator in Belle Mare, Mauritius.')}
            </p>
          </div>
          {/* Two ways to reach a human, side by side. WhatsApp is how most guests actually get in
              touch, but the email address has to be VISIBLE — a booking site that only offers a
              chat bubble reads as unreachable to anyone who wants a written trail, and it is the
              address on the invoices and confirmations. */}
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-xl border border-teal-bright/40 bg-teal-bright/10 px-5 py-3 text-sm font-bold text-teal-bright hover:bg-teal-bright/20"
            >
              <IconChat width={18} height={18} /> {t('Chat on WhatsApp')}
            </a>
            <a
              href={`mailto:${SITE.email}`}
              className="inline-flex items-center gap-2.5 rounded-xl border border-cream/20 px-5 py-3 text-sm font-bold text-cream/85 no-underline hover:border-cream/40 hover:text-cream"
            >
              <IconMail width={18} height={18} /> {SITE.email}
            </a>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-7 sm:grid-cols-3 lg:grid-cols-5">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gold-light">
                {t(col.title)}
              </div>
              {col.links.map((link) => {
                const href =
                  link.href === WHATSAPP_LINK
                    ? whatsapp
                    : link.href === EMAIL_LINK
                      ? `mailto:${SITE.email}`
                      : link.href;
                const className =
                  'block py-1.5 text-sm text-cream/70 no-underline hover:text-coral';
                // Anything that leaves the site needs a plain anchor — next/link would try to
                // client-navigate it. mailto: hands off to the mail client and must NOT get
                // target="_blank", which leaves a dead blank tab behind.
                if (href.startsWith('mailto:')) {
                  return (
                    <a key={link.label} href={href} className={className}>
                      {t(link.label)}
                    </a>
                  );
                }
                return href.startsWith('http') ? (
                  <a
                    key={link.label}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={className}
                  >
                    {t(link.label)}
                  </a>
                ) : (
                  <Link key={link.label} href={href} className={className}>
                    {t(link.label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-cream/10 pt-6 text-xs text-cream/50">
          {t('© {year} {legalName}. {street}, {region}, Mauritius · BRN {brn} · VAT {vat} ·', {
            year: new Date().getFullYear(),
            legalName: SITE.legalName,
            street: SITE.street,
            region: SITE.region,
            brn: SITE.brn,
            vat: SITE.vat,
          })}{' '}
          {/* Required attribution for the EUR→MUR charge-rate feed (open tier ToS). */}
          <a
            href="https://www.exchangerate-api.com"
            rel="noopener noreferrer"
            target="_blank"
            className="underline-offset-2 hover:text-cream/80 hover:underline"
          >
            Rates by Exchange Rate API
          </a>
        </div>
      </div>
    </footer>
  );
}
