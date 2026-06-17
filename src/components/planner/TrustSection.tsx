interface Testimonial {
  quote: string;
  name: string;
  country: string;
  avatar: string;
}

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "\"Told it 'chilled south coast, back by 5' and it built the whole day. Our driver Ashok was brilliant — knew exactly where to stop for photos.\"",
    name: 'Hannah & Tom',
    country: 'United Kingdom',
    avatar: 'linear-gradient(135deg,#13A0A6,#0B5C63)',
  },
  {
    quote:
      '"The drive times were spot on. It even warned us Chamarel closes at five and reshuffled the stops. Quote came back in minutes."',
    name: 'Lena Brandt',
    country: 'Germany',
    avatar: 'linear-gradient(135deg,#F76C5E,#C98A12)',
  },
  {
    quote:
      '"Way better than emailing five companies. Planned the east coast with the kids in ten minutes and shared it to WhatsApp."',
    name: 'Priya & Sanjay',
    country: 'India',
    avatar: 'linear-gradient(135deg,#0E8C92,#13A0A6)',
  },
];

function Star() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#F5A623" aria-hidden>
      <path d="M12 2l2.6 6.3L21 9l-5 4.3L17.5 21 12 17.2 6.5 21 8 13.3 3 9l6.4-.7L12 2Z" />
    </svg>
  );
}

export function TrustSection() {
  return (
    <section className="mt-14 text-white" style={{ background: 'linear-gradient(180deg,#0B5C63,#0A2E36)' }}>
      <div className="mx-auto max-w-shell px-[22px] py-[52px]">
        <div className="flex flex-wrap items-center justify-between gap-3.5">
          <div className="flex items-center gap-3.5">
            <div className="flex gap-0.5" aria-hidden>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} />
              ))}
            </div>
            <div className="text-xl font-extrabold">
              4.9<span className="text-sm font-semibold opacity-60"> / 5</span>
            </div>
            <div className="text-[13.5px] opacity-70">from 2,300+ planned trips</div>
          </div>
          <div className="inline-flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.08] px-3.5 py-2 text-[13px] font-semibold">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 2l7 3v6c0 4.5-3 8.4-7 9-4-.6-7-4.5-7-9V5l7-3Z" stroke="#13A0A6" strokeWidth={2} strokeLinejoin="round" />
              <path d="M9 12l2 2 4-4" stroke="#13A0A6" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            No random drivers — verified locals
          </div>
        </div>
        <div className="mt-[30px] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure key={t.name} className="m-0 rounded-[18px] border border-white/10 bg-white/[0.06] p-[22px]">
              <blockquote className="mb-3.5 text-[15px] leading-[1.6] text-teal-tint">{t.quote}</blockquote>
              <figcaption className="flex items-center gap-2.5 text-[13px]">
                <span className="h-[34px] w-[34px] rounded-full" style={{ background: t.avatar }} aria-hidden />
                <span>
                  <strong className="block">{t.name}</strong>
                  <span className="opacity-60">{t.country}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
