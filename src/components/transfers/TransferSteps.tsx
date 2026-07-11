import { IconCalendar, IconCheck, IconClock, IconPin } from '@/components/ui/icons';

const STEPS = [
  {
    icon: IconCalendar,
    title: 'Tell us your flight',
    body: 'Pick your hotel, party size and date, then add your arrival flight number and time at checkout.',
  },
  {
    icon: IconClock,
    title: 'We track your flight',
    body: 'Your driver watches your flight in real time and adjusts to delays — with free waiting after you land.',
  },
  {
    icon: IconPin,
    title: 'Meet & greet in arrivals',
    body: 'A friendly local driver greets you with a name board, helps with your bags and walks you to the car.',
  },
  {
    icon: IconCheck,
    title: 'Relax to your hotel',
    body: 'Door-to-door in a private, air-conditioned vehicle at a fixed price — no meter, no surprises.',
  },
];

/** "Save time on arrival" how-it-works band — reinforces filling the travel form when booking. */
export function TransferSteps() {
  return (
    <section className="mt-12 border-t border-ink/10 pt-9">
      <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
        Save time on arrival — fill the travel form
      </h2>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink/75">
        Share your flight details when you book and your transfer runs itself. Here’s how it works,
        start to finish.
      </p>
      <ol className="m-0 mt-6 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <li key={s.title} className="rounded-2xl border border-ink/10 bg-white p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-teal/10 text-teal">
                  <Icon width={18} height={18} />
                </span>
                <span className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">
                  Step {i + 1}
                </span>
              </div>
              <h3 className="mt-3 text-[15px] font-extrabold leading-snug text-ink">{s.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink/70">{s.body}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
