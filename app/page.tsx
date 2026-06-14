export const runtime = 'edge';

const CATEGORIES = [
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Island tours',
  'Airport transfers',
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto max-w-shell px-6 py-20">
      <p className="font-display text-sm uppercase tracking-[0.2em] text-teal-dark">
        Belle Mare Tours · East-Coast Mauritius
      </p>
      <h1 className="mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight text-ink sm:text-5xl">
        Catamaran cruises, dolphin swims and island days — booked direct.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-muted">
        The official booking platform of Belle Mare Tours. No reseller markup, instant confirmation.
      </p>

      <div className="mt-10 flex flex-wrap gap-3">
        {CATEGORIES.map((category) => (
          <span
            key={category}
            className="rounded-full border border-teal/30 bg-teal-tint px-4 py-2 text-sm font-medium text-teal-dark"
          >
            {category}
          </span>
        ))}
      </div>

      <p className="mt-16 rounded-card border border-teal/20 bg-white/60 p-6 text-sm text-ink-muted">
        Phase 0 scaffold — the full catalogue, booking flow, AI assistant and admin panel land in
        later phases. Brand tokens, edge runtime and the API-first service layer are wired and
        verified.
      </p>
    </main>
  );
}
