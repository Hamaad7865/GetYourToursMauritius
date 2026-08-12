import { describe, it, expect } from 'vitest';
import { pickVehicleSlot } from '@/lib/transfers/pick-vehicle-slot';

/* The airport-transfer widget used to reserve whatever occurrence came back first, so every transfer
 * was filed under the "SUV" option regardless of the vehicle the guest picked (a Sedan booking showing
 * "SUV (4 seats, 4 suitcases) · 1 × Sedan"). pickVehicleSlot must reserve the CHOSEN vehicle's option. */

type Slot = { occurrenceId: string; optionName: string; seatsLeft: number };

// Deliberately in a different order than the vehicle picker asks for, so a first-match implementation fails.
const slots: Slot[] = [
  { occurrenceId: 'suv', optionName: 'SUV (4 seats, 4 suitcases)', seatsLeft: 5 },
  { occurrenceId: 'std', optionName: 'Standard car (4 seats, 2 suitcases)', seatsLeft: 5 },
  { occurrenceId: 'fam', optionName: 'Family car (6 seats, 4 suitcases)', seatsLeft: 5 },
  { occurrenceId: 'bus', optionName: 'Minibus (14 seats)', seatsLeft: 5 },
  { occurrenceId: 'coa', optionName: 'Coaster (22 seats)', seatsLeft: 5 },
];

describe('pickVehicleSlot', () => {
  it('reserves the occurrence for the CHOSEN vehicle, not the first slot', () => {
    // "Standard car" chosen but SUV is first in the list — the bug picked SUV; the fix picks Standard car.
    expect(pickVehicleSlot(slots, 'Standard car')?.occurrenceId).toBe('std');
    expect(pickVehicleSlot(slots, 'SUV')?.occurrenceId).toBe('suv');
    expect(pickVehicleSlot(slots, 'Family car')?.occurrenceId).toBe('fam');
    expect(pickVehicleSlot(slots, 'Minibus')?.occurrenceId).toBe('bus');
    expect(pickVehicleSlot(slots, 'Coaster')?.occurrenceId).toBe('coa');
  });

  it('matches the option name by prefix (option carries the seat/suitcase suffix)', () => {
    expect(pickVehicleSlot(slots, 'SUV')?.optionName).toBe('SUV (4 seats, 4 suitcases)');
  });

  it('prefers an OPEN slot for the vehicle over a full one', () => {
    const s: Slot[] = [
      { occurrenceId: 'std-full', optionName: 'Standard car (4 seats, 2 suitcases)', seatsLeft: 0 },
      { occurrenceId: 'std-open', optionName: 'Standard car (4 seats, 2 suitcases)', seatsLeft: 3 },
    ];
    expect(pickVehicleSlot(s, 'Standard car')?.occurrenceId).toBe('std-open');
  });

  it('falls back to a slot when the chosen vehicle has none open (never dead-ends booking)', () => {
    const noCoaster = slots.filter((s) => !s.optionName.startsWith('Coaster'));
    expect(pickVehicleSlot(noCoaster, 'Coaster')).toBeDefined();
  });

  it('returns undefined only when there are no slots at all', () => {
    expect(pickVehicleSlot([], 'SUV')).toBeUndefined();
  });
});
