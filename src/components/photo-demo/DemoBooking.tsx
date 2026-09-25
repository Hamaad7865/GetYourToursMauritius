'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Price } from '@/components/site/Price';
import type { DemoPackage } from './data';

const STEPS = ['Date & extras', 'Your details', 'Payment'] as const;

function formatDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Minimal month calendar — future dates selectable, Sundays "booked" to make the demo feel real. */
function Calendar({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (iso: string) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const year = month.getFullYear();
  const monthIdx = month.getMonth();
  const firstWeekday = (new Date(year, monthIdx, 1).getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const isoFor = (day: number) =>
    `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isPast = (day: number) => {
    const d = new Date(year, monthIdx, day);
    const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d < t;
  };
  const isBooked = (day: number) => new Date(year, monthIdx, day).getDay() === 0;

  return (
    <div className="rounded-card border border-ink/10 bg-white p-5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(new Date(year, monthIdx - 1, 1))}
          disabled={year === today.getFullYear() && monthIdx === today.getMonth()}
          className="grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink transition hover:border-teal disabled:opacity-30"
          aria-label="Previous month"
        >
          ←
        </button>
        <p className="text-sm font-bold">
          {month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
        </p>
        <button
          type="button"
          onClick={() => setMonth(new Date(year, monthIdx + 1, 1))}
          className="grid h-9 w-9 place-items-center rounded-full border border-ink/10 text-ink transition hover:border-teal"
          aria-label="Next month"
        >
          →
        </button>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day, i) =>
          day == null ? (
            <span key={`empty-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              disabled={isPast(day) || isBooked(day)}
              onClick={() => onPick(isoFor(day))}
              className={`aspect-square rounded-full text-[13px] font-semibold transition ${
                value === isoFor(day)
                  ? 'bg-teal text-white'
                  : isPast(day) || isBooked(day)
                    ? 'cursor-not-allowed text-ink/25 line-through'
                    : 'text-ink hover:bg-teal-tint'
              }`}
            >
              {day}
            </button>
          ),
        )}
      </div>
      <p className="mt-3 text-xs text-ink-muted">Sundays are already booked — sorry!</p>
    </div>
  );
}

export function DemoBooking({ pkg }: { pkg: DemoPackage }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<'sunrise' | 'sunset'>('sunset');
  const [addOns, setAddOns] = useState<Set<string>>(new Set());
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [hotel, setHotel] = useState('');
  const [notes, setNotes] = useState('');
  const [card, setCard] = useState({ number: '', expiry: '', cvc: '' });
  const [paying, setPaying] = useState(false);

  const addOnTotal = useMemo(
    () =>
      pkg.addOns
        .filter((a) => addOns.has(a.name))
        .reduce((sum, a) => sum + a.priceEur, 0),
    [addOns, pkg],
  );
  const total = pkg.priceEur + addOnTotal;
  const deposit = Math.round(total / 2);

  const toggleAddOn = (name: string) =>
    setAddOns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const detailsValid = name.trim().length > 1 && /.+@.+\..+/.test(email);

  const pay = () => {
    setPaying(true);
    // Fake gateway round-trip, then the confirmation page — mirroring the real Peach redirect.
    setTimeout(() => {
      const ref = `BMT-PHOTO-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const params = new URLSearchParams({
        pkg: pkg.slug,
        ref,
        date: date ?? '',
        slot,
        name,
        total: String(total),
        deposit: String(deposit),
      });
      router.push(`/photo-demo/confirmation?${params.toString()}`);
    }, 1400);
  };

  return (
    <section aria-label="Book your photoshoot" className="space-y-6">
      <Link
        href={`/photo-demo/${pkg.slug}`}
        className="inline-block text-sm font-semibold text-teal-dark underline underline-offset-4"
      >
        Back to package
      </Link>

      <ol className="flex flex-wrap gap-x-6 gap-y-2 border-b border-ink/10 py-4 text-sm">
        {STEPS.map((label, i) => (
          <li
            key={label}
            aria-current={i === step ? 'step' : undefined}
            className={i === step ? 'font-bold text-teal-dark' : i < step ? 'font-semibold text-ink' : 'text-ink-muted'}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          {step === 0 && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold">Choose your date</h2>
              <Calendar value={date} onPick={setDate} />
              {date && (
                <fieldset>
                  <legend className="mb-2 text-sm font-bold text-ink">Which light?</legend>
                  <div className="flex gap-3">
                    {(
                      [
                        ['sunrise', 'Sunrise · soft & quiet'],
                        ['sunset', 'Sunset · golden hour'],
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSlot(value)}
                        className={`flex-1 rounded-card border-[1.5px] px-4 py-3.5 text-sm font-bold transition ${
                          slot === value
                            ? 'border-teal bg-teal-tint text-teal-dark'
                            : 'border-ink/10 bg-white text-ink hover:border-teal'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
              {pkg.addOns.length > 0 && (
                <fieldset className="space-y-1">
                  <legend className="mb-2 text-sm font-bold text-ink">Optional extras</legend>
                  {pkg.addOns.map((extra) => (
                    <label
                      key={extra.name}
                      className="flex cursor-pointer items-center gap-3 border-b border-ink/10 py-3 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={addOns.has(extra.name)}
                        onChange={() => toggleAddOn(extra.name)}
                        className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
                      />
                      <span className="flex-1">{extra.name}</span>
                      <span className="font-semibold">
                        +<Price eur={extra.priceEur} />
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <button
                type="button"
                disabled={!date}
                onClick={() => setStep(1)}
                className="flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Continue to details
              </button>
              {!date && (
                <p role="status" className="rounded-xl bg-teal/5 p-4 text-sm text-ink-muted">
                  Choose a date to continue.
                </p>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold">Your details</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold">
                  Full name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Martin"
                    className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="alex@example.com"
                    className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
              </div>
              <label className="block text-sm font-semibold">
                Hotel or meeting point
                <input
                  value={hotel}
                  onChange={(e) => setHotel(e.target.value)}
                  placeholder="e.g. LUX* Belle Mare"
                  className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                />
              </label>
              <label className="block text-sm font-semibold">
                Anything we should know? <span className="font-normal text-ink-muted">(optional)</span>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Proposal — please keep it secret…"
                  className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                />
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="rounded-full border-[1.5px] border-ink/10 px-6 py-3.5 text-sm font-bold text-ink transition hover:border-teal"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!detailsValid}
                  onClick={() => setStep(2)}
                  className="flex-1 rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Continue to payment
                </button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold">Pay the 50% deposit</h2>
              <p className="rounded-xl bg-teal/5 p-4 text-sm text-ink-muted">
                This is a demo checkout — no real charge. The balance of{' '}
                <b className="text-ink">
                  <Price eur={total - deposit} />
                </b>{' '}
                is due when your photos are delivered.
              </p>
              <label className="block text-sm font-semibold">
                Card number
                <input
                  inputMode="numeric"
                  value={card.number}
                  onChange={(e) => setCard({ ...card, number: e.target.value })}
                  placeholder="4242 4242 4242 4242"
                  className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                />
              </label>
              <div className="grid grid-cols-2 gap-4">
                <label className="block text-sm font-semibold">
                  Expiry
                  <input
                    inputMode="numeric"
                    value={card.expiry}
                    onChange={(e) => setCard({ ...card, expiry: e.target.value })}
                    placeholder="12 / 28"
                    className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
                <label className="block text-sm font-semibold">
                  CVC
                  <input
                    inputMode="numeric"
                    value={card.cvc}
                    onChange={(e) => setCard({ ...card, cvc: e.target.value })}
                    placeholder="123"
                    className="mt-1.5 w-full rounded-xl border border-ink/15 px-4 py-3 text-sm font-normal outline-none focus:border-teal"
                  />
                </label>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="rounded-full border-[1.5px] border-ink/10 px-6 py-3.5 text-sm font-bold text-ink transition hover:border-teal"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={paying}
                  onClick={pay}
                  className="flex-1 rounded-full bg-coral px-7 py-3.5 text-sm font-bold text-white transition hover:bg-coral-dark disabled:opacity-70"
                >
                  {paying ? 'Contacting your bank…' : `Pay deposit`}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Summary card */}
        <aside className="rounded-xl border border-ink/15 p-6 lg:sticky lg:top-6">
          <div className="flex gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={pkg.image}
              alt=""
              className="h-20 w-20 rounded-xl object-cover"
            />
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-dark">
                {pkg.category}
              </p>
              <h3 className="mt-0.5 font-extrabold leading-tight tracking-tight">{pkg.title}</h3>
            </div>
          </div>
          <ul className="mt-5 space-y-2 border-t border-ink/10 pt-4 text-sm">
            <li className="flex justify-between">
              <span className="text-ink-muted">Date</span>
              <b>{date ? formatDate(date) : '—'}</b>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Slot</span>
              <b className="capitalize">{slot}</b>
            </li>
            <li className="flex justify-between">
              <span className="text-ink-muted">Package</span>
              <b>
                <Price eur={pkg.priceEur} />
              </b>
            </li>
            {[...addOns].map((name) => {
              const a = pkg.addOns.find((x) => x.name === name)!;
              return (
                <li key={name} className="flex justify-between text-[13px]">
                  <span className="text-ink-muted">{name}</span>
                  <b>
                    +<Price eur={a.priceEur} />
                  </b>
                </li>
              );
            })}
          </ul>
          <div className="mt-4 space-y-1.5 border-t border-ink/10 pt-4">
            <p className="flex justify-between text-sm font-bold">
              <span>Total</span>
              <Price eur={total} />
            </p>
            <p className="flex justify-between text-sm font-bold text-teal-dark">
              <span>Due today (50%)</span>
              <Price eur={deposit} />
            </p>
            <p className="flex justify-between text-[13px] text-ink-muted">
              <span>Due on delivery</span>
              <Price eur={total - deposit} />
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
