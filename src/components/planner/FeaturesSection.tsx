import type { ReactNode } from 'react';
import { useT } from '@/components/site/PreferencesProvider';

interface Feature {
  iconBg: string;
  icon: ReactNode;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    iconBg: 'bg-teal-tint text-teal',
    icon: <path d="M5 13l4 4L19 7" stroke="#0E8C92" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />,
    title: 'Grounded in real data',
    body: 'Every place, opening time and drive time comes from real maps — never invented by a chatbot.',
  },
  {
    iconBg: 'bg-[#FFF3DC] text-gold',
    icon: <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="#F5A623" />,
    title: 'Instant transparent quote',
    body: 'A live price estimate as you plan, then a one-tap quote we confirm fast — not "sometime today".',
  },
  {
    iconBg: 'bg-[#FDE9E6] text-coral',
    icon: (
      <>
        <path d="M12 3a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V8a5 5 0 0 1 5-5Z" stroke="#F76C5E" strokeWidth={2} />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="#F76C5E" strokeWidth={2} strokeLinecap="round" />
      </>
    ),
    title: 'ZilAi, not a chatbot',
    body: 'Describe your day in plain words; stops drop onto the map and the route draws itself.',
  },
  {
    iconBg: 'bg-teal-tint text-teal',
    icon: (
      <>
        <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" stroke="#0E8C92" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={12} cy={10} r={2.2} fill="#0E8C92" />
      </>
    ),
    title: 'Verified local drivers',
    body: 'No random pickups. Friendly Mauritian drivers who actually know the back roads and the beaches.',
  },
  {
    iconBg: 'bg-[#FFF3DC] text-gold',
    icon: (
      <>
        <circle cx={12} cy={12} r={9} stroke="#C98A12" strokeWidth={2} />
        <path d="M12 7v5l3 2" stroke="#C98A12" strokeWidth={2} strokeLinecap="round" />
      </>
    ),
    title: 'Opening-hours boost',
    body: 'The planner warns you if a stop closes early and offers to reorder so you never arrive to locked gates.',
  },
  {
    iconBg: 'bg-[#FDE9E6] text-coral',
    icon: (
      <>
        <path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7" stroke="#F76C5E" strokeWidth={2} strokeLinecap="round" />
        <path d="M12 3v12m0-12-4 4m4-4 4 4" stroke="#F76C5E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
    title: 'Shareable & printable',
    body: "A live trip link, a clean PDF and a WhatsApp send — share the day before you've even left the hotel.",
  },
];

export function FeaturesSection() {
  const t = useT();
  return (
    <section id="how-zilai-works" className="mx-auto max-w-shell scroll-mt-24 px-[22px] pb-2 pt-14">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="mb-1.5 max-w-[560px] sm:col-span-2 lg:col-span-3">
          <p className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.04em] text-teal">{t('How ZilAi works')}</p>
          <h2 className="m-0 font-display text-[clamp(26px,4vw,38px)] font-semibold tracking-[-0.02em] text-ink">
            {t('A concierge that actually builds the plan')}
          </h2>
        </div>
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-[18px] border border-[#EEF4F3] bg-white p-[22px] shadow-[0_10px_30px_rgba(10,46,54,.05)]">
            <div className={`mb-3 grid h-10 w-10 place-items-center rounded-xl ${f.iconBg}`}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden>
                {f.icon}
              </svg>
            </div>
            <h3 className="mb-1.5 text-base font-bold text-ink">{t(f.title)}</h3>
            <p className="m-0 text-sm leading-[1.55] text-ink-muted">{t(f.body)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
