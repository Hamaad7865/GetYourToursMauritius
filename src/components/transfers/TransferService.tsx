import { IconCalendar, IconCheck, IconClock, IconGlobe, IconPin, IconShield, IconUsers, IconWallet } from '@/components/ui/icons';

const FEATURES = [
  {
    icon: IconPin,
    title: 'Meet & greet, every time',
    body: 'Your driver waits in the arrivals hall with a name board, helps with luggage and walks you to the vehicle — no hunting for a taxi rank.',
  },
  {
    icon: IconClock,
    title: 'Real-time flight tracking',
    body: 'We monitor your flight and shift the pickup automatically if you’re early or delayed, with generous free waiting time after you land.',
  },
  {
    icon: IconUsers,
    title: 'A vehicle to fit your party',
    body: 'From a private car for two to a family car, minibus or coaster for groups — chosen for your passengers and luggage, with optional SUV upgrade.',
  },
  {
    icon: IconGlobe,
    title: 'Island-wide coverage',
    body: 'Door-to-door to every resort, villa and town in Mauritius — north, south, east, west and central — and back to the airport for departure.',
  },
  {
    icon: IconWallet,
    title: 'Fixed price, no hidden fees',
    body: 'The price you see is the price you pay — no meter, no fuel or night surcharges, and no forced shopping stops on the way.',
  },
  {
    icon: IconCheck,
    title: 'Free first child seat',
    body: 'Travelling with little ones? Your first baby or child seat is free — just tell us the age, and add extra seats if you need them.',
  },
  {
    icon: IconShield,
    title: 'Licensed, professional drivers',
    body: 'Friendly, English- and French-speaking local drivers in clean, well-kept, air-conditioned vehicles — backed by 1,000+ five-star reviews.',
  },
  {
    icon: IconCalendar,
    title: 'Flexible & low-risk',
    body: 'Free cancellation up to 24 hours before, pay securely online in EUR (shown in your currency), and instant email confirmation.',
  },
];

/** "More about our service" — the long-form reassurance block that matches the competitor's depth. */
export function TransferService() {
  return (
    <section className="mt-12 border-t border-ink/10 pt-9">
      <h2 className="text-[22px] font-extrabold tracking-tight text-ink">More about our service</h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
        Everything you’d want from an airport transfer in Mauritius — and the reasons travellers book direct
        with Belle Mare Tours instead of a hotel desk or an airport taxi.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.title} className="flex gap-3.5 rounded-2xl border border-ink/10 bg-white p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-teal/10 text-teal">
                <Icon width={19} height={19} />
              </span>
              <div>
                <h3 className="text-[15px] font-extrabold leading-snug text-ink">{f.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-ink/70">{f.body}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
