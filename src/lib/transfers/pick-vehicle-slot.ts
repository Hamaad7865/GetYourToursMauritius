/**
 * Pick the availability slot for the CHOSEN vehicle on an airport transfer.
 *
 * The airport-transfer activity carries ONE occurrence per vehicle OPTION per day (Standard car, SUV,
 * Family car, Minibus, Coaster). The booking widget must reserve the occurrence belonging to the
 * vehicle the guest picked — filing under whatever occurrence came back first is the bug that put every
 * transfer under the "SUV" option regardless of choice (a Sedan booking showing "SUV (4 seats, …)").
 *
 * The match is by PREFIX: `airportVehicleLabel` returns "Standard car" / "SUV" / "Family car" /
 * "Minibus" / "Coaster", and each option's name begins with exactly that ("SUV (4 seats, 4 suitcases)").
 * An open slot (seats left) is preferred; the fall back to any slot fires ONLY when the chosen vehicle
 * has nothing open that day, so booking never dead-ends — the fare is server-derived, not the option.
 *
 * Pure + generic over the slot shape, so it is unit-testable without a browser or the fetch.
 */
export function pickVehicleSlot<
  T extends { seatsLeft?: number | null; optionName?: string | null },
>(slots: T[], vehicle: string): T | undefined {
  const forVehicle = slots.filter((s) => (s.optionName ?? '').startsWith(vehicle));
  const pool = forVehicle.length ? forVehicle : slots;
  return pool.find((s) => (s.seatsLeft ?? 0) >= 1) ?? pool[0];
}
