'use client';

import { useState } from 'react';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { useT } from '@/components/site/PreferencesProvider';
import { useToast } from '@/components/site/ToastProvider';
import { Price } from '@/components/site/Price';
import { buildInquiryMessage, inquiryReady, packInquiryContact } from '@/lib/catalogue/inquiry';
import { IconCalendar, IconChat, IconMail } from '@/components/ui/icons';

export interface InquiryActivity {
  id: string;
  slug: string;
  title: string;
  fromPriceEur: number | null;
  /** English unit-label key ('per person' | 'per group' | 'per vehicle'), passed through t(). */
  unitLabel: string;
}

/**
 * Replaces BookingWidget for `extra.inquiryOnly` activities (e.g. skydiving) that need personal
 * planning instead of an instant slot pick: no hold, no availability check, no payment. Collects
 * trip details and hands them to the customer's own WhatsApp/email app to send — a lead row is
 * also captured (POST /api/v1/leads, best-effort) so the request shows up in /admin/leads even if
 * the customer's send fails or they never follow through.
 */
export function InquiryWidget({ activity }: { activity: InquiryActivity }) {
  const t = useT();
  const { showToast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState('');
  const [people, setPeople] = useState(2);
  const [company, setCompany] = useState(''); // honeypot — must stay empty for real users
  const [touched, setTouched] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  const details = { activityTitle: activity.title, name, email, phone, date, people };
  const ready = inquiryReady(details);
  const message = buildInquiryMessage(details);
  const mailHref = `mailto:${SITE.email}?subject=${encodeURIComponent(
    `Trip request — ${activity.title}`,
  )}&body=${encodeURIComponent(message)}`;

  function submitLead() {
    fetch('/api/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        contact: packInquiryContact(details),
        interestActivityId: activity.id,
        source: 'activity_inquiry',
        company,
      }),
    }).catch(() => {
      /* best-effort — the WhatsApp/email message the customer is about to send is the real channel */
    });
    showToast({
      title: t('Request noted'),
      description: t('Continue in the app that just opened — we’ll also follow up directly.'),
    });
  }

  function handleSubmitClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (!ready) {
      e.preventDefault();
      setTouched(true);
      return;
    }
    submitLead();
  }

  const inputClass =
    'w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal';
  const labelClass = 'mb-1 block text-[12.5px] font-bold text-ink';

  return (
    <div className="rounded-2xl border border-ink/10 bg-white shadow-[0_24px_50px_-30px_rgba(10,46,54,0.45)]">
      <div className="flex items-center gap-2 rounded-t-2xl bg-teal px-5 py-2.5 text-[12.5px] font-bold text-white">
        <IconCalendar width={15} height={15} /> {t('Needs personal planning')}
      </div>

      <div className="p-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] text-ink-muted">{t('From')}</span>
          <span className="text-[30px] font-extrabold tracking-tight text-ink">
            {activity.fromPriceEur != null ? (
              <Price eur={activity.fromPriceEur} />
            ) : (
              t('On request')
            )}
          </span>
        </div>
        <div className="text-[13px] text-ink-muted">{t(activity.unitLabel)}</div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink/70">
          {t(
            'This experience needs personal planning. Send us your trip details and we’ll confirm availability and the final price directly.',
          )}
        </p>

        <div className="mt-4 flex flex-col gap-2.5">
          {/* Honeypot: off-screen, not for humans. Bots that auto-fill every field trip it. */}
          <div
            aria-hidden="true"
            className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden"
          >
            <label>
              {t('Company (leave this empty)')}
              <input
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              />
            </label>
          </div>

          <label className="block">
            <span className={labelClass}>{t('Name')}</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block">
              <span className={labelClass}>{t('Preferred date')}</span>
              <input
                type="date"
                min={todayStr}
                className={inputClass}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={labelClass}>{t('People')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                className={inputClass}
                value={people}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  setPeople(Number.isNaN(n) ? 1 : Math.max(1, Math.min(99, n)));
                }}
              />
            </label>
          </div>
          <label className="block">
            <span className={labelClass}>{t('Phone / WhatsApp number')}</span>
            <input
              type="tel"
              className={inputClass}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={labelClass}>{t('Email')}</span>
            <input
              type="email"
              className={inputClass}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>

        {touched && !ready && (
          <p className="mt-3 text-[12.5px] font-medium text-coral-dark">
            {t('Fill in your name, email, phone, date and party size first.')}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2.5">
          <a
            href={ready ? whatsappUrl(message) : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!ready}
            onClick={handleSubmitClick}
            className={`gyt-press flex w-full items-center justify-center gap-2 rounded-xl px-4 py-[15px] text-base font-bold text-white ${
              ready ? 'bg-teal-dark hover:bg-teal-dark/90' : 'cursor-not-allowed bg-teal-dark/50'
            }`}
          >
            <IconChat width={18} height={18} /> {t('Send via WhatsApp')}
          </a>
          <a
            href={ready ? mailHref : undefined}
            aria-disabled={!ready}
            onClick={handleSubmitClick}
            className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-[15px] text-base font-bold ${
              ready
                ? 'border-ink/15 text-ink hover:border-teal hover:text-teal'
                : 'cursor-not-allowed border-ink/10 text-ink/40'
            }`}
          >
            <IconMail width={18} height={18} /> {t('Send by email')}
          </a>
        </div>
      </div>
    </div>
  );
}
