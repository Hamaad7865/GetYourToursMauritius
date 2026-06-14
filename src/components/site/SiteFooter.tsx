import Link from 'next/link';
import { Logo } from './Logo';
import { SITE } from '@/lib/seo/site';
import { IconChat } from '@/components/ui/icons';

const COLUMNS = [
  {
    title: 'Activities',
    links: [
      'Catamaran cruises',
      'Île aux Cerfs',
      'Dolphin swims',
      'Sea walks & diving',
      'Island tours',
      'Airport transfers',
    ].map((c) => ({ label: c, href: `/activities?category=${encodeURIComponent(c)}` })),
  },
  {
    title: 'Company',
    links: [
      { label: 'About Belle Mare Tours', href: '/about' },
      { label: 'Guest reviews', href: '/activities' },
      { label: 'Contact & pickups', href: '/contact' },
    ],
  },
  {
    title: 'Support',
    links: [
      { label: 'Help centre', href: '/help' },
      { label: 'FAQ', href: '/help' },
      { label: 'WhatsApp us', href: '#whatsapp' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Terms of service', href: '/terms' },
      { label: 'Privacy policy', href: '/privacy' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer id="whatsapp" className="bg-ink text-cream/80">
      <div className="mx-auto max-w-shell px-6 pb-7 pt-14">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-md">
            <div className="mb-4">
              <Logo tone="dark" />
            </div>
            <p className="m-0 text-sm leading-relaxed text-cream/70">
              {SITE.name} is the official booking platform of{' '}
              <b className="font-semibold text-cream">{SITE.operator}</b>, a licensed tour operator
              in Belle Mare, Mauritius.
            </p>
          </div>
          <a
            href="#whatsapp"
            className="inline-flex items-center gap-2.5 rounded-xl border border-teal-bright/40 bg-teal-bright/10 px-5 py-3 text-sm font-bold text-teal-bright hover:bg-teal-bright/20"
          >
            <IconChat width={18} height={18} /> Chat on WhatsApp
          </a>
        </div>

        <div className="mt-10 grid grid-cols-2 gap-7 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <div className="mb-3 text-xs font-bold uppercase tracking-wider text-gold-light">
                {col.title}
              </div>
              {col.links.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  className="block py-1.5 text-sm text-cream/70 no-underline hover:text-coral"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        <div className="mt-12 border-t border-cream/10 pt-6 text-xs text-cream/50">
          © {new Date().getFullYear()} {SITE.operator}. {SITE.street}.
        </div>
      </div>
    </footer>
  );
}
