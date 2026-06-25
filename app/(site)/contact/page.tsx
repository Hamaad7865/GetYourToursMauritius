import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { ContactForm } from '@/components/site/ContactForm';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { IconChat, IconMail, IconPin } from '@/components/ui/icons';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `Contact ${SITE.operator}`,
  description: `Get in touch with ${SITE.operator} in Belle Mare, Mauritius — WhatsApp, phone or email. We reply fast and help you plan the perfect day.`,
  alternates: { canonical: '/contact' },
};

export default async function ContactPage() {
  const t = await getT();
  const channels = [
    {
      icon: <IconChat width={20} height={20} />,
      label: t('WhatsApp'),
      value: SITE.phone,
      href: whatsappUrl(t('Hi Belle Mare Tours! I have a question.')),
      note: t('Fastest reply'),
    },
    {
      icon: <IconMail width={20} height={20} />,
      label: t('Email'),
      value: 'bookings@getyourtoursmauritius.com',
      href: 'mailto:bookings@getyourtoursmauritius.com',
      note: t('We reply within a day'),
    },
    {
      icon: <IconPin width={20} height={20} />,
      label: t('Visit us'),
      value: `${SITE.street}, ${SITE.locality}`,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE.street}, ${SITE.locality}, Mauritius`)}`,
      note: t('East coast, Mauritius'),
    },
  ];

  return (
    <>
      <GygHeader />
      <main className="bg-white">
        <section className="relative overflow-hidden bg-[radial-gradient(120%_120%_at_50%_-20%,#13a0a6_0%,#0E8C92_42%,#0B5C63_100%)]">
          <div className="relative mx-auto max-w-shell px-6 py-14 sm:py-20">
            <p className="mb-3 text-[12.5px] font-bold uppercase tracking-[0.16em] text-white/70">
              {t('Contact us')}
            </p>
            <h1 className="max-w-3xl text-[clamp(28px,5vw,52px)] font-extrabold leading-[1.05] tracking-tight text-white">
              {t('Let’s plan your Mauritius')}
            </h1>
            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/85 sm:text-base">
              {t('Questions about a tour, a transfer or a rental? Message us — we’re a small local team and we love helping you put together the perfect day.')}
            </p>
          </div>
        </section>

        <div className="mx-auto grid max-w-shell gap-10 px-6 py-12 sm:py-16 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-ink">{t('Talk to us directly')}</h2>
            <div className="mt-5 flex flex-col gap-3">
              {channels.map((c) => (
                <a
                  key={c.label}
                  href={c.href}
                  target={c.href.startsWith('http') ? '_blank' : undefined}
                  rel={c.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="flex items-center gap-4 rounded-2xl border border-ink/10 p-4 transition hover:border-teal/40 hover:bg-teal/5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal/10 text-teal">
                    {c.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                      {c.label}
                    </span>
                    <span className="block truncate font-bold text-ink">{c.value}</span>
                    <span className="block text-[12.5px] text-ink-muted">{c.note}</span>
                  </span>
                </a>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-[20px] font-extrabold tracking-tight text-ink">{t('Send us a message')}</h2>
            <div className="mt-5">
              <ContactForm />
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
