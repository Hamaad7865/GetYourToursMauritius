const FAQS: Array<[string, string]> = [
  [
    'How accurate are the drive times?',
    'Every distance and drive time comes from real map data, recalculated each time you change the plan — no chatbot guesswork. Totals always add up.',
  ],
  [
    'Can I change a plan the AI made?',
    'Completely. Drag to reorder, drop a stop, add a beach, or just tell the co-pilot — the route and price update live.',
  ],
  [
    'How fast is a quote, really?',
    'A verified local driver confirms your quote within minutes by WhatsApp, not "sometime today".',
  ],
  ['Who actually drives?', 'Friendly, licensed Mauritian drivers we know personally. No random pickups — ever.'],
  [
    'Do I pay to get a quote?',
    'No. Planning and quoting are free; you only confirm once the price and driver are agreed.',
  ],
];

export function FaqSection() {
  return (
    <section className="mx-auto max-w-[820px] px-[22px] pb-2.5 pt-14">
      <h2 className="m-0 mb-[22px] text-center font-display text-[clamp(26px,4vw,38px)] font-semibold tracking-[-0.02em] text-ink">
        Good to know
      </h2>
      <div className="flex flex-col gap-2.5">
        {FAQS.map(([q, a]) => (
          <details key={q} className="group rounded-[14px] border border-[#EEF4F3] bg-white px-[18px] shadow-[0_4px_14px_rgba(10,46,54,.04)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-[15px] text-[15.5px] font-bold text-ink [&::-webkit-details-marker]:hidden">
              {q}
              <span className="text-xl font-normal text-teal transition-transform group-open:rotate-45" aria-hidden>
                +
              </span>
            </summary>
            <p className="m-0 mb-4 text-sm leading-[1.6] text-ink-muted">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
