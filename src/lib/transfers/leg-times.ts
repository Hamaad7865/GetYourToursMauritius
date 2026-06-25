/**
 * Pure helpers for an airport transfer's leg timings — used by BOTH the booking-confirmation page and
 * the e-voucher PDF so they show the same thing. No I/O, no Intl/Date formatting (each render site
 * formats the returned date/time itself); only string-level time math so there are no timezone bugs.
 *
 * What we store vs. what we show:
 * - The ARRIVAL (inbound, airport→hotel) leg's DATE is the booking's service/occurrence date; its TIME is
 *   the customer-entered `arrivalTime`. The hotel DROP-OFF time isn't stored, so we ESTIMATE it as the
 *   pickup time + the drive (default 60 min, the airport-transfer duration) — always shown as approximate.
 * - The DEPARTURE (outbound, hotel→airport) leg's date+time are `returnDate`/`returnTime` (the checkout
 *   puts the departure pickup date into returnDate); its airport drop-off is likewise estimated.
 */

/** Typical airport-transfer drive used to estimate the drop-off (the airport-transfer activity is 60 min). */
export const AIRPORT_DRIVE_MINUTES = 60;

/**
 * Add `minutes` to an "HH:MM" local time on calendar date `ymd` (YYYY-MM-DD), rolling the date across
 * midnight. Returns the resulting `{ ymd, hhmm }`, or null if either input is malformed. Pure string/UTC
 * math — `ymd` is treated as a bare calendar date, never a wall-clock instant, so there's no TZ drift.
 */
export function addMinutesLocal(ymd: string, hhmm: string, minutes: number): { ymd: string; hhmm: string } | null {
  const tm = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd ?? '') || !tm) return null;
  const base = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return null;
  let total = Number(tm[1]) * 60 + Number(tm[2]) + minutes;
  let dayShift = 0;
  while (total >= 1440) {
    total -= 1440;
    dayShift += 1;
  }
  while (total < 0) {
    total += 1440;
    dayShift -= 1;
  }
  base.setUTCDate(base.getUTCDate() + dayShift);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return { ymd: base.toISOString().slice(0, 10), hhmm: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

export interface TransferLeg {
  /** 'arrival' = airport→hotel (pick up at airport); 'departure' = hotel→airport (pick up at hotel). */
  kind: 'arrival' | 'departure';
  /** Pickup calendar date (YYYY-MM-DD) and the customer-entered time (HH:MM). */
  pickupYmd: string;
  pickupTime: string;
  /** Estimated drop-off date + time (pickup + drive); null only if the math failed. APPROXIMATE. */
  dropoffYmd: string | null;
  dropoffTime: string | null;
}

/**
 * Build the leg list for a transfer booking. Arrival/return get an inbound leg from the service date +
 * arrivalTime; departure/return get an outbound leg from returnDate + returnTime. Each leg carries an
 * estimated drop-off. Legs with missing date/time are skipped, so a half-filled booking degrades cleanly.
 */
export function transferLegs(input: {
  direction?: string | null;
  /** The booking's service/occurrence date as an ISO timestamp (the arrival/inbound date). */
  serviceDateIso?: string | null;
  arrivalTime?: string | null;
  returnDate?: string | null;
  returnTime?: string | null;
  /** Drive minutes for the drop-off estimate; defaults to the airport-transfer duration. */
  driveMinutes?: number;
}): TransferLeg[] {
  const drive = input.driveMinutes ?? AIRPORT_DRIVE_MINUTES;
  const legs: TransferLeg[] = [];

  // Inbound (arrival) leg — present for 'arrival' and 'return'. The date is the occurrence/service date.
  if (input.direction !== 'departure' && input.serviceDateIso && input.arrivalTime) {
    const ymd = input.serviceDateIso.slice(0, 10);
    const drop = addMinutesLocal(ymd, input.arrivalTime, drive);
    legs.push({
      kind: 'arrival',
      pickupYmd: ymd,
      pickupTime: input.arrivalTime,
      dropoffYmd: drop?.ymd ?? null,
      dropoffTime: drop?.hhmm ?? null,
    });
  }

  // Outbound (departure) leg — present for 'departure' and 'return'. Date/time live in returnDate/returnTime.
  if (input.direction !== 'arrival' && input.returnDate && input.returnTime) {
    const drop = addMinutesLocal(input.returnDate, input.returnTime, drive);
    legs.push({
      kind: 'departure',
      pickupYmd: input.returnDate,
      pickupTime: input.returnTime,
      dropoffYmd: drop?.ymd ?? null,
      dropoffTime: drop?.hhmm ?? null,
    });
  }

  return legs;
}
