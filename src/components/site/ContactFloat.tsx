'use client';

import { useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { whatsappUrl } from '@/lib/seo/site';
import { useT } from './PreferencesProvider';
import { useWhatsAppNumber } from './WhatsAppNumberProvider';
import { useEnquiryActivity, type EnquiryActivity } from './EnquiryContext';
import { useDialog } from '@/lib/a11y/useDialog';
import { IconChat, IconX } from '@/components/ui/icons';
import { DATE_FIELD_WRAPPER, DATE_TIME_INPUT } from '@/components/ui/date-input';
import { enquiryReady, enquiryWhatsAppMessage, packEnquiryContact } from '@/lib/catalogue/enquiry';

const PANEL_ID = 'enquiry-panel';

/**
 * Global floating enquiry button (bottom-right corner, every customer-facing page).
 *
 * It rests in the corner and lifts ONLY over a mobile sticky bottom bar that is actually on screen:
 * each such bar (MobileBookBar, the checkout CTA, the cart CTA) publishes its measured height as
 * `--gyt-bottom-bar` (see useBottomBarOffset), which this button adds to its own inset. It used to
 * carry a flat `bottom-24` for the book bar's sake — so on the home page, listings and blog, where
 * no bar exists, it hovered ~96px up the screen instead of sitting in the corner.
 *
 * Replaced the old WhatsAppFloat, which was a bare wa.me deep-link: a visitor without WhatsApp (or
 * unwilling to hand over their number to open a chat) had no way to ask a question, and nothing they
 * did was ever captured. The form posts to /api/v1/leads, which now emails the owner. WhatsApp is
 * still one tap away underneath the send button — it remains the fastest reply for people who prefer it.
 */
export function ContactFloat() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  const activity = useEnquiryActivity();

  if (pathname?.startsWith('/admin')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        aria-label={t('Message us')}
        className="gyt-wa-float animate-pop group fixed bottom-[calc(1rem+var(--gyt-bottom-bar,env(safe-area-inset-bottom)))] right-4 z-40 flex items-center rounded-full bg-teal text-white shadow-[0_14px_32px_-10px_rgba(14,140,146,0.55)] transition-[box-shadow,background-color] duration-300 hover:bg-teal-dark hover:shadow-[0_18px_38px_-8px_rgba(11,92,99,0.65)] lg:bottom-6"
      >
        <span className="relative grid h-14 w-14 shrink-0 place-items-center">
          <span aria-hidden className="gyt-wa-ring absolute inset-0 rounded-full bg-white/70" />
          <IconChat width={26} height={26} className="relative" />
        </span>
        <span className="max-w-0 overflow-hidden whitespace-nowrap pr-0 text-sm font-bold opacity-0 transition-all duration-300 group-hover:max-w-[9rem] group-hover:pr-5 group-hover:opacity-100">
          {t('Message us')}
        </span>
      </button>
      {open && (
        <EnquiryPanel
          activity={activity}
          pageUrl={pathname ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The form itself. Mounted only while open, so closing it discards the draft state — there is no
 * reset path to get wrong. On an activity page it grows a context chip plus two OPTIONAL trip fields
 * (date, party size): enough to save a round-trip when the visitor knows, never enough to block the
 * one-line question that is most of this widget's traffic.
 */
function EnquiryPanel({
  activity,
  pageUrl,
  onClose,
}: {
  activity: EnquiryActivity | null;
  pageUrl: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const waNumber = useWhatsAppNumber();
  const nameRef = useRef<HTMLInputElement>(null);
  // APG dialog behaviour: scroll-lock, Escape, focus move-in/return, and a Tab focus trap.
  const dialogRef = useDialog(true, onClose, () => nameRef.current);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [date, setDate] = useState('');
  const [people, setPeople] = useState<number | null>(null);
  const [company, setCompany] = useState(''); // honeypot — must stay empty for real users
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  const ready = enquiryReady({ name, email, message });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || state === 'sending') return;
    setState('sending');
    setError(null);
    try {
      const res = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contact: packEnquiryContact({ email, phone }),
          message: message.trim(),
          // The page is the only context a non-activity page has; the chip's activity is richer.
          pageUrl: pageUrl ?? undefined,
          interestActivityId: activity?.id,
          // Both are offered only alongside an activity, so never send them without one.
          preferredDate: activity && date ? date : undefined,
          partySize: activity && people ? people : undefined,
          source: activity ? 'float_activity' : 'float',
          company,
        }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error?.message ?? t('Could not send your message.'));
      setState('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Something went wrong.'));
      setState('error');
    }
  }

  const field =
    'w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm outline-none focus:border-teal';
  // The two-up date/number row needs the native-control fixes on top (see date-input.ts): without
  // them iOS painted the date field grey and overflowed it under "People".
  const dateField = `${field} ${DATE_TIME_INPUT}`;
  const numberField = `${field} min-w-0 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none`;
  const labelText = 'mb-1 block text-[12.5px] font-bold text-ink';

  return (
    <div
      className="fixed inset-0 z-[100] bg-ink/40 backdrop-blur-sm"
      onMouseDown={onClose}
      aria-hidden={false}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('Send us a message')}
        id={PANEL_ID}
        onMouseDown={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-4 sm:max-h-[calc(100vh-5rem)] sm:w-[380px] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 bg-teal px-5 py-3.5 text-white">
          <span className="text-[15px] font-bold">{t('Send us a message')}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-white/15"
          >
            <IconX width={18} height={18} />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {state === 'sent' ? (
            <div className="py-4 text-center">
              <p className="text-lg font-bold text-ink">{t('Thank you — message received!')}</p>
              <p className="mt-1.5 text-sm text-ink-muted">
                {t(
                  'We’ll get back to you shortly. For anything urgent, WhatsApp us for the fastest reply.',
                )}
              </p>
              <a
                href={whatsappUrl(enquiryWhatsAppMessage(activity?.title), waNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-xl bg-teal-dark px-5 py-3 text-sm font-bold text-white hover:bg-teal-dark/90"
              >
                <IconChat width={17} height={17} /> {t('Chat on WhatsApp')}
              </a>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-2.5">
              {activity && (
                <div className="flex max-w-full items-center gap-1.5 rounded-full bg-teal/10 px-3 py-1.5 text-[12.5px] text-teal-dark">
                  <span className="shrink-0 font-medium text-ink-muted">{t('About')}</span>
                  <span className="truncate font-bold">{activity.title}</span>
                </div>
              )}

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
                <span className={labelText}>{t('Name')}</span>
                <input
                  ref={nameRef}
                  className={field}
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className={labelText}>{t('Email')}</span>
                <input
                  type="email"
                  className={field}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label className="block">
                <span className={labelText}>{t('Phone / WhatsApp (optional)')}</span>
                <input
                  type="tel"
                  className={field}
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>

              {activity && (
                <div className="grid grid-cols-2 gap-2.5">
                  <label className={`block ${DATE_FIELD_WRAPPER}`}>
                    <span className={labelText}>{t('Preferred date')}</span>
                    <input
                      type="date"
                      min={todayStr}
                      className={dateField}
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </label>
                  <label className={`block ${DATE_FIELD_WRAPPER}`}>
                    <span className={labelText}>{t('People')}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      className={numberField}
                      value={people ?? ''}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10);
                        setPeople(Number.isNaN(n) ? null : Math.max(1, Math.min(99, n)));
                      }}
                    />
                  </label>
                </div>
              )}

              <label className="block">
                <span className={labelText}>{t('How can we help?')}</span>
                <textarea
                  className={field}
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={t('Ask us anything — dates, pick-up, group size…')}
                  required
                />
              </label>

              {error && <p className="text-[12.5px] font-medium text-coral-dark">{error}</p>}

              <button
                type="submit"
                disabled={!ready || state === 'sending'}
                className="gyt-press mt-1 w-full rounded-xl bg-teal px-5 py-[14px] text-base font-bold text-white hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {state === 'sending' ? t('Sending…') : t('Send message')}
              </button>

              <a
                href={whatsappUrl(enquiryWhatsAppMessage(activity?.title), waNumber)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-0.5 inline-flex items-center justify-center gap-1.5 py-1 text-[13px] font-bold text-teal hover:text-teal-dark hover:underline"
              >
                <IconChat width={15} height={15} /> {t('or chat on WhatsApp')}
              </a>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
