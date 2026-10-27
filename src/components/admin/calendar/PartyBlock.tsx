'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { resolvePickup } from '@/components/admin/BookingFacts';
import { fmtDate, fmtDateShort, fmtDateTime } from '@/lib/admin/format';
import {
  guestPickup,
  type DayBooking,
  type DayCustomLine,
  type DayDeparture,
  type DayReturnLeg,
} from '@/lib/admin/calendar';
import { LINE_TYPES, type LineType } from '@/lib/admin/calendar-view';
import type { BookingStatus, PaymentState } from '@/lib/admin/bookings';
import { euros, FlagTag, Ic, ICON, initials } from './parts';

/* One guest party inside an expanded calendar line. Everything staff need to run the trip without
 * leaving the calendar: who, how to reach them, where to collect them, their flight, the seats to fit,
 * the extras and the note somebody left — then what it is worth and whether it is paid. */

interface Row {
  k: string;
  v: ReactNode;
  /** Something still to be given — drawn amber on an upcoming line. */
  missing?: boolean;
}

/** The payment chip the prototype draws: paid, deposit paid, unpaid — or the ledger's own state. */
function payChip(
  status: BookingStatus,
  state: PaymentState,
  counted: boolean,
  balanceDueEur: number,
): { label: string; cls: string } {
  if (!counted) {
    return {
      label: status === 'held' ? 'Seat held' : 'Awaiting payment',
      cls: 'bg-[#fdecea] text-[#b42318]',
    };
  }
  if (state === 'refunded' || state === 'partially_refunded') {
    return {
      label: state === 'refunded' ? 'Refunded' : 'Partly refunded',
      cls: 'bg-slate-100 text-slate-600',
    };
  }
  if (state === 'failed') return { label: 'Payment failed', cls: 'bg-[#fdecea] text-[#b42318]' };
  if (balanceDueEur > 0) return { label: 'Deposit paid', cls: 'bg-[#e6eefc] text-[#1d4f9e]' };
  if (state === 'paid') return { label: 'Paid', cls: 'bg-[#e2f3ea] text-[#17663f]' };
  return { label: 'Pending', cls: 'bg-amber-50 text-amber-700' };
}

function ContactButtons({ email, phone }: { email: string; phone: string | null }) {
  const digits = phone?.replace(/\D/g, '') ?? '';
  const cls =
    'flex h-8 w-8 items-center justify-center rounded-full border border-[#dfe6e5] bg-white text-[#3c5255] hover:border-[#bfdcd9] hover:bg-[#e7f4f3] hover:text-teal-dark';
  return (
    <div className="flex shrink-0 gap-1">
      {email && (
        <a href={`mailto:${email}`} title={email} aria-label={`Email ${email}`} className={cls}>
          <Ic d={ICON.mail} size={15} stroke={1.9} />
        </a>
      )}
      {phone && (
        <a
          href={`tel:${phone.replace(/\s+/g, '')}`}
          title={phone}
          aria-label={`Call ${phone}`}
          className={cls}
        >
          <Ic d={ICON.phone} size={15} stroke={1.9} />
        </a>
      )}
      {digits.length >= 7 && (
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noopener noreferrer"
          title={`WhatsApp ${phone}`}
          aria-label={`WhatsApp ${phone}`}
          className={cls}
        >
          <Ic d={ICON.message} size={15} stroke={1.9} />
        </a>
      )}
    </div>
  );
}

function Shell({
  type,
  name,
  ref_,
  paxLabel,
  email,
  phone,
  rows,
  flags,
  money,
  valueEur,
  chip,
  balanceDueEur,
  bookedAt,
  source,
  bookingId,
  upcoming,
  footerAction,
  children,
}: {
  type: LineType;
  name: string;
  ref_: string;
  paxLabel: string | null;
  email: string;
  phone: string | null;
  rows: Row[];
  flags: string[];
  money: boolean;
  valueEur: number | null;
  chip: { label: string; cls: string };
  balanceDueEur: number;
  bookedAt: string;
  source: string;
  bookingId: string;
  upcoming: boolean;
  footerAction?: ReactNode;
  children?: ReactNode;
}) {
  const T = LINE_TYPES[type];
  return (
    <div className="flex flex-col gap-3 border-b border-[#e9eeed] p-3.5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
          style={{ background: T.tint, color: T.ink }}
        >
          {initials(name || 'Guest')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-ink">{name || 'Guest'}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] text-ink-muted">
            <span className="shrink-0 font-mono text-[11.5px]">{ref_}</span>
            {paxLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{paxLabel}</span>
              </>
            )}
          </p>
        </div>
        <ContactButtons email={email} phone={phone} />
      </div>

      {flags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {flags.map((f) => (
            <FlagTag key={f}>{f}</FlagTag>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <dl className="flex flex-col gap-[7px]">
          {rows.map((r) => (
            <div
              key={r.k}
              className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 text-[13px] leading-[1.45]"
            >
              <dt className="pt-0.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7c7e]">
                {r.k}
              </dt>
              <dd
                className={`min-w-0 [overflow-wrap:anywhere] ${
                  r.missing ? (upcoming ? 'text-[#a15c07]' : 'text-[#6b7c7e]') : 'text-ink'
                }`}
              >
                {r.v}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {money && valueEur != null && (
          <span className="text-[14px] font-bold tabular-nums text-ink">
            {euros(valueEur, true)}
          </span>
        )}
        <span
          className={`inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-semibold ${chip.cls}`}
        >
          {chip.label}
        </span>
        {money && balanceDueEur > 0 && (
          <span className="text-[12px] text-ink-muted">{euros(balanceDueEur)} balance due</span>
        )}
      </div>

      {children}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[12px] text-[#6b7c7e]">
          Booked {fmtDateTime(bookedAt)} · via {source}
        </span>
        <span className="flex items-center gap-3">
          {footerAction}
          <Link
            href={`/admin/bookings?open=${bookingId}`}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-teal-dark hover:text-ink"
          >
            Open booking
            <Ic d={ICON.arrowRight} size={14} />
          </Link>
        </span>
      </div>
    </div>
  );
}

function missingValue(upcoming: boolean): string {
  return upcoming ? 'Not provided yet' : 'Not recorded';
}

/** Pickup + drop-off through the shared reading (airport-departure flip, round-trip transfer fold). */
function pickupRows(
  b: Pick<
    DayBooking,
    'pickupLocation' | 'dropoffLocation' | 'pickupPending' | 'transportPickup' | 'transportDropoff'
  > & { direction: string | null },
  pickupTimeLabel: string | null,
  upcoming: boolean,
): Row[] {
  const { pickup, dropoff } = resolvePickup({
    pickupLocation: b.pickupLocation,
    dropoffLocation: b.dropoffLocation,
    pickupPending: b.pickupPending,
    transportPickup: b.transportPickup,
    transportDropoff: b.transportDropoff,
    transferDirection: b.direction,
  });
  const rows: Row[] = [];
  const at = pickupTimeLabel ? `${pickupTimeLabel} · ` : '';
  if (pickup.kind === 'text') {
    rows.push({
      k: 'Pickup',
      v: (
        <>
          {at}
          {pickup.text}
          {pickup.roundTrip && (
            <span className="block text-[12px] font-medium text-teal-dark">
              Round-trip transfer
            </span>
          )}
        </>
      ),
    });
  } else if (pickup.kind === 'pending') {
    rows.push({ k: 'Pickup', v: upcoming ? 'To be arranged' : 'Not recorded', missing: true });
  } else {
    rows.push({ k: 'Pickup', v: <span className="text-ink-muted">Makes own way</span> });
  }
  if (dropoff.kind === 'text') rows.push({ k: 'Drop-off', v: dropoff.text });
  else if (dropoff.kind === 'same') rows.push({ k: 'Drop-off', v: 'Same as pickup' });
  return rows;
}

/** A party on a booked departure. */
export function DeparturePartyBlock({
  booking: b,
  departure,
  type,
  flags,
  money,
  upcoming,
  footerAction,
  children,
}: {
  booking: DayBooking;
  departure: DayDeparture;
  type: LineType;
  flags: string[];
  money: boolean;
  upcoming: boolean;
  footerAction?: ReactNode;
  children?: ReactNode;
}) {
  const t = b.transfer;
  const pickup = guestPickup(b, departure);
  const rows: Row[] = pickupRows(
    { ...b, direction: t?.direction ?? null },
    pickup?.label ?? null,
    upcoming,
  );
  if (b.roomOrCabin) rows.push({ k: 'Room', v: b.roomOrCabin });
  if (t) {
    const inbound = [t.flightNumber, t.arrivalTime && `lands ${t.arrivalTime}`]
      .filter(Boolean)
      .join(' · ');
    const outbound = [
      t.departureFlightNumber,
      [t.returnDate ? fmtDate(t.returnDate) : null, t.returnTime].filter(Boolean).join(' '),
    ]
      .filter(Boolean)
      .join(' · ');
    if (t.direction !== 'departure') {
      rows.push(
        t.flightNumber
          ? { k: 'Flight', v: inbound }
          : { k: 'Flight', v: missingValue(upcoming), missing: true },
      );
    }
    if (t.direction === 'departure' || t.direction === 'return') {
      rows.push(
        t.departureFlightNumber
          ? { k: t.direction === 'return' ? 'Return' : 'Flight', v: outbound }
          : {
              k: t.direction === 'return' ? 'Return' : 'Flight',
              v: outbound || missingValue(upcoming),
              missing: true,
            },
      );
    }
    if (t.luggageDetails) rows.push({ k: 'Luggage', v: t.luggageDetails });
  }
  if (b.childSeats > 0) {
    rows.push({
      k: 'Child seats',
      v: `${b.childSeats} seat${b.childSeats === 1 ? '' : 's'} to fit${
        t?.childSeatAge != null ? ` · child aged ${t.childSeatAge}` : ''
      }`,
    });
  }
  if (b.supplements.length > 0) {
    rows.push({ k: 'Extras', v: b.supplements.map((s) => `${s.qty} × ${s.name}`).join(', ') });
  }
  if (b.customItinerary && b.customItinerary.length > 0) {
    rows.push({
      k: 'Route',
      v: b.customItinerary.map((s) => (s.area ? `${s.title} (${s.area})` : s.title)).join(' → '),
    });
  }
  if (b.staffNote)
    rows.push({ k: 'Notes', v: <span className="whitespace-pre-wrap">{b.staffNote}</span> });
  rows.push({
    k: 'Contact',
    v: (
      <span className="text-[#3c5255]">
        {[b.customerEmail, b.customerPhone].filter(Boolean).join(' · ')}
      </span>
    ),
  });

  return (
    <Shell
      type={type}
      name={b.customerName}
      ref_={b.ref}
      paxLabel={b.lines.map((l) => `${l.quantity} × ${l.label}`).join(' · ') || `${b.pax} pax`}
      email={b.customerEmail}
      phone={b.customerPhone}
      rows={rows}
      flags={flags}
      money={money}
      valueEur={b.counted ? b.valueEur : null}
      chip={payChip(b.status, b.paymentState, b.counted, b.balanceDueEur)}
      balanceDueEur={b.balanceDueEur}
      bookedAt={b.bookedAt}
      source={b.source}
      bookingId={b.id}
      upcoming={upcoming}
      footerAction={footerAction}
    >
      {children}
    </Shell>
  );
}

/** The one party on a quote's custom or rental line. */
export function CustomPartyBlock({
  line,
  type,
  flags,
  money,
  upcoming,
}: {
  line: DayCustomLine;
  type: LineType;
  flags: string[];
  money: boolean;
  upcoming: boolean;
}) {
  const rental = line.lineKind === 'rental';
  const rows: Row[] = [];
  if (!rental) {
    rows.push(
      ...pickupRows(
        {
          pickupLocation: line.pickupLabel,
          dropoffLocation: null,
          pickupPending: false,
          transportPickup: line.transportPickup,
          transportDropoff: line.transportDropoff,
          direction: null,
        },
        null,
        upcoming,
      ),
    );
  } else if (line.endsAt) {
    rows.push({ k: 'Return', v: fmtDateShort(line.endsAt) });
  }
  if (line.quantity > 1) {
    rows.push({ k: rental ? 'Vehicles' : 'Quantity', v: String(line.quantity) });
  }
  if (line.roomOrCabin) rows.push({ k: 'Room', v: line.roomOrCabin });
  rows.push({ k: 'Booked as', v: line.description });
  if (line.staffNote)
    rows.push({ k: 'Notes', v: <span className="whitespace-pre-wrap">{line.staffNote}</span> });
  rows.push({
    k: 'Contact',
    v: (
      <span className="text-[#3c5255]">
        {[line.customerEmail, line.customerPhone].filter(Boolean).join(' · ')}
      </span>
    ),
  });
  return (
    <Shell
      type={type}
      name={line.customerName}
      ref_={line.ref}
      paxLabel={line.guests != null ? `${line.guests} guest${line.guests === 1 ? '' : 's'}` : null}
      email={line.customerEmail}
      phone={line.customerPhone}
      rows={rows}
      flags={flags}
      money={money}
      valueEur={line.valueEur}
      chip={payChip(line.status, line.paymentState, line.counted, line.balanceDueEur)}
      balanceDueEur={line.balanceDueEur}
      bookedAt={line.bookedAt}
      source={line.source}
      bookingId={line.bookingId}
      upcoming={upcoming}
    />
  );
}

/** The one party on a return transfer's departure leg: hotel → airport. */
export function ReturnLegPartyBlock({
  leg,
  flags,
  money,
  upcoming,
}: {
  leg: DayReturnLeg;
  flags: string[];
  money: boolean;
  upcoming: boolean;
}) {
  const rows: Row[] = [
    leg.pickup
      ? { k: 'Pickup', v: `${leg.departureTime ? `${leg.departureTime} · ` : ''}${leg.pickup}` }
      : { k: 'Pickup', v: missingValue(upcoming), missing: true },
    {
      k: 'Drop-off',
      v: leg.dropoff ? leg.dropoff.replace(/\(\s*arrivals\s*\)/i, '(departures)') : 'Airport',
    },
    leg.flightNumber
      ? { k: 'Flight', v: leg.flightNumber }
      : { k: 'Flight', v: missingValue(upcoming), missing: true },
  ];
  if (leg.roomOrCabin) rows.push({ k: 'Room', v: leg.roomOrCabin });
  if (leg.staffNote)
    rows.push({ k: 'Notes', v: <span className="whitespace-pre-wrap">{leg.staffNote}</span> });
  rows.push({
    k: 'Contact',
    v: (
      <span className="text-[#3c5255]">
        {[leg.customerEmail, leg.customerPhone].filter(Boolean).join(' · ')}
      </span>
    ),
  });
  return (
    <Shell
      type="transfer"
      name={leg.customerName}
      ref_={leg.ref}
      paxLabel={[leg.vehicleLabel, leg.pax ? `${leg.pax} pax` : null].filter(Boolean).join(' · ')}
      email={leg.customerEmail}
      phone={leg.customerPhone}
      rows={rows}
      flags={flags}
      money={money}
      // Its fare is on the arrival departure that carries the booking line.
      valueEur={null}
      chip={payChip(leg.status, leg.paymentState, leg.counted, leg.balanceDueEur)}
      balanceDueEur={leg.balanceDueEur}
      bookedAt={leg.bookedAt}
      source={leg.source}
      bookingId={leg.bookingId}
      upcoming={upcoming}
    />
  );
}
