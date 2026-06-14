import { IconBolt, IconCalendar, IconShield, IconTag } from '@/components/ui/icons';

const ITEMS = [
  {
    Icon: IconTag,
    title: 'Book direct, pay less',
    body: 'Straight from Belle Mare Tours — no reseller markup.',
  },
  {
    Icon: IconBolt,
    title: 'Instant confirmation',
    body: 'Your spot is secured the moment you book.',
  },
  {
    Icon: IconCalendar,
    title: 'Free cancellation',
    body: 'Cancel up to 24h before for a full refund.',
  },
  {
    Icon: IconShield,
    title: 'Secure payment by Peach',
    body: 'Encrypted card payments via Peach Payments.',
  },
];

export function WhyBookDirect() {
  return (
    <section className="bg-teal-dark text-cream">
      <div className="mx-auto grid max-w-shell grid-cols-1 gap-6 px-6 py-10 sm:grid-cols-2 lg:grid-cols-4">
        {ITEMS.map(({ Icon, title, body }) => (
          <div key={title} className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-coral/15 text-coral">
              <Icon />
            </span>
            <div>
              <div className="text-[15px] font-bold">{title}</div>
              <div className="mt-1 text-[13px] leading-snug text-cream/70">{body}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
