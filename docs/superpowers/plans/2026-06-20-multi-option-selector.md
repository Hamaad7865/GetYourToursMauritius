# Multi-Option Selector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer choose between an activity's options (e.g. Half-Day €180 / Full Day €360) via GYG-style selectable cards, with the selection driving price, availability, and the booking.

**Architecture:** Widget-layer only. Add `selectedOptionId` to `BookingProvider` (default = today's auto-pick) and make pricing + availability follow it; add an `OptionSelector` card list rendered only when `options.length > 1`. The data model, admin save, and `api_get_activity` already carry all options — no DB/API/admin change.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-multi-option-selector-design.md`.

---

## Task 1: Pure option helpers

**Files:**

- Create: `src/lib/catalogue/options.ts`, `tests/unit/options.test.ts`

- [ ] **Step 1: Failing test** — `tests/unit/options.test.ts`. First READ `src/lib/validation/tours.ts` to confirm the `TourOption` / tier shape (expected: `TourOption = { id, name, description?, prices: { label, amountEur, maxGuests }[] }`; `PricingMode = 'per_person'|'per_group'|'vehicle'`). Then:

```typescript
import { describe, expect, it } from 'vitest';
import { cheapestTier, defaultOptionId, optionCardSummary } from '@/lib/catalogue/options';
import type { TourOption } from '@/lib/validation/tours';

const half: TourOption = {
  id: 'a',
  name: 'Half-Day Boat Trip',
  description: null,
  prices: [{ label: 'Adult', amountEur: 180, maxGuests: null }],
};
const full: TourOption = {
  id: 'b',
  name: 'Full Day Boat Trip',
  description: null,
  prices: [{ label: 'Adult', amountEur: 360, maxGuests: null }],
};
const tiered: TourOption = {
  id: 'c',
  name: 'Shared',
  description: null,
  prices: [
    { label: 'Child', amountEur: 40, maxGuests: 8 },
    { label: 'Adult', amountEur: 60, maxGuests: 8 },
  ],
};

describe('cheapestTier', () => {
  it('returns the lowest-priced tier', () => {
    expect(cheapestTier(tiered)?.amountEur).toBe(40);
    expect(cheapestTier(tiered)?.label).toBe('Child');
  });
  it('returns null when an option has no tiers', () => {
    expect(cheapestTier({ id: 'x', name: 'X', description: null, prices: [] })).toBeNull();
  });
});

describe('defaultOptionId', () => {
  it('picks options[0] for vehicle mode', () => {
    expect(defaultOptionId([full, half], true)).toBe('b');
  });
  it('picks the option holding the globally cheapest tier otherwise', () => {
    expect(defaultOptionId([full, half], false)).toBe('a'); // half €180 < full €360
  });
  it('returns null for no options', () => {
    expect(defaultOptionId([], false)).toBeNull();
  });
});

describe('optionCardSummary', () => {
  it('per_person: from-price = cheapest tier', () => {
    const s = optionCardSummary(full, 'per_person', 'activity');
    expect(s.fromPriceEur).toBe(360);
    expect(s.name).toBe('Full Day Boat Trip');
  });
  it('per_group: surfaces maxGuests', () => {
    expect(optionCardSummary(tiered, 'per_group', 'activity').maxGuests).toBe(8);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/unit/options.test.ts`.

- [ ] **Step 3: Implement `src/lib/catalogue/options.ts`** (adapt field names to the real `TourOption`):

```typescript
import type { PricingMode, TourOption } from '@/lib/validation/tours';
import type { TourType } from '@/lib/validation/common';

export interface TierLite {
  label: string;
  amountEur: number;
  maxGuests: number | null;
}

/** The option's lowest-priced tier, or null when it has none. */
export function cheapestTier(option: TourOption): TierLite | null {
  let best: TierLite | null = null;
  for (const p of option.prices) {
    if (!best || p.amountEur < best.amountEur)
      best = { label: p.label, amountEur: p.amountEur, maxGuests: p.maxGuests };
  }
  return best;
}

/** Default selected option: options[0] for vehicle, else the option holding the globally cheapest tier. */
export function defaultOptionId(options: TourOption[], isVehicle: boolean): string | null {
  if (options.length === 0) return null;
  if (isVehicle) return options[0].id;
  let bestId: string | null = null;
  let bestEur = Infinity;
  for (const o of options) {
    const t = cheapestTier(o);
    if (t && t.amountEur < bestEur) {
      bestEur = t.amountEur;
      bestId = o.id;
    }
  }
  return bestId ?? options[0].id;
}

export interface OptionCardSummary {
  name: string;
  fromPriceEur: number | null;
  maxGuests: number | null;
  unitNote: string;
}

/** Display fields for one option card. unitNote follows the pricing mode/type, mirroring the widget's unitLabel. */
export function optionCardSummary(
  option: TourOption,
  mode: PricingMode,
  type: TourType,
): OptionCardSummary {
  const t = cheapestTier(option);
  const maxGuests = t?.maxGuests ?? null;
  const unitNote =
    mode === 'vehicle'
      ? 'per vehicle'
      : mode === 'per_group'
        ? maxGuests
          ? `per group up to ${maxGuests}`
          : 'per group'
        : type === 'transport'
          ? 'per vehicle'
          : 'per person';
  return { name: option.name, fromPriceEur: t?.amountEur ?? null, maxGuests, unitNote };
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalogue/options.ts tests/unit/options.test.ts
git commit -m "feat(catalogue): pure option helpers (cheapestTier, defaultOptionId, optionCardSummary)"
```

---

## Task 2: Selection state drives pricing + availability in BookingProvider

**Files:**

- Modify: `src/components/gyg/detail/BookingProvider.tsx`

READ the whole file first. Today: `cheapest` (a useMemo, ~L183) scans ALL options to drive `bookingOptionId` (~L194), pricing (`baseTotal`, `unitPriceEur`, `priceLabel`, `groupSize`, `tierCap`), and availability filters on `bookingOptionId` (~L221). We make the SELECTED option drive all of it, keeping today's behaviour as the default.

- [ ] **Step 1: Add selection state.** Near the other `useState`s, add (using the Task-1 helper for the default):

```typescript
const [selectedOptionId, setSelectedOptionId] = useState<string | null>(() =>
  defaultOptionId(activity.options, activity.pricingMode === 'vehicle'),
);
const selectedOption = useMemo(
  () => activity.options.find((o) => o.id === selectedOptionId) ?? activity.options[0] ?? null,
  [activity.options, selectedOptionId],
);
const setSelectedOption = useCallback(
  (id: string) => {
    setSelectedOptionId(id);
    setDate(''); // occurrences differ per option — force a fresh date pick
    touch();
  },
  [touch],
);
```

Import `defaultOptionId` + `cheapestTier` from `@/lib/catalogue/options`.

- [ ] **Step 2: Selected-option pricing.** Replace the pricing role of `cheapest` with the cheapest tier of the SELECTED option:

```typescript
const selectedTier = useMemo(
  () => (selectedOption ? cheapestTier(selectedOption) : null),
  [selectedOption],
);
```

Then update every reader that used `cheapest` for PRICING to use `selectedTier` (keep `cheapest`-style fallbacks identical): `bookingOptionId` becomes `selectedOption?.id ?? null`; `groupSize` uses `selectedTier?.maxGuests`; `tierCap` uses `selectedTier?.maxGuests`; `baseTotal` per_group/per_person branches use `selectedTier.amountEur`; `unitPriceEur` uses `selectedTier?.amountEur ?? 0`; `priceLabel` uses `selectedTier?.label ?? ''`. The vehicle branches (`vehicleCfg`, `sightseeingQuote`, `vehicleName`) are unchanged. Confirm: when `selectedOptionId` is the default, `selectedTier` equals the old `cheapest` for a single-option activity, so existing tests stay green.

- [ ] **Step 3: Availability follows selection.** `bookingOptionId` is now `selectedOption?.id`; the availability `useEffect` dep array already keys on `bookingOptionId`, so it re-fetches on option change. No other change needed (the `s.activityOptionId !== bookingOptionId` filter now matches the selected option).

- [ ] **Step 4: Expose in context.** Add `selectedOptionId`, `setSelectedOption`, and `selectedOption` to the `BookingState` interface and the `value` object.

- [ ] **Step 5: Verify no regression** — `npm run typecheck` and `npx vitest run` (the pricing/booking tests must stay green; default selection reproduces today's numbers). Report results.

- [ ] **Step 6: Commit**

```bash
git add src/components/gyg/detail/BookingProvider.tsx
git commit -m "feat(booking): selected option drives price + availability (default unchanged)"
```

---

## Task 3: OptionSelector card UI + wire-in + label fix + green gate

**Files:**

- Create: `src/components/gyg/detail/OptionSelector.tsx`
- Modify: `src/components/gyg/detail/BookingOptionCard.tsx` (and/or `BookingWidget.tsx`), `src/lib/i18n/messages.ts`

- [ ] **Step 1: Build `OptionSelector.tsx`.** A client component that reads `useBooking()` and renders the selectable cards. Render NOTHING when `activity.options.length <= 1`. For each option, compute `optionCardSummary(option, activity.pricingMode, activity.type)` and render a selectable card (radio semantics: `role="radio"`/`aria-checked`, keyboard-operable) showing: option name, formatted from-price + `unitNote`, the option `description` if present, and "fits up to N" when `maxGuests`. The selected card (`option.id === selectedOptionId`) uses the existing teal selected border (match the styling already used for selected states in `BookingOptionCard`/the vehicle toggle — READ those for the exact classes). Clicking/selecting calls `setSelectedOption(option.id)`. Format prices with the repo's existing EUR formatter (grep for `formatEur`/`€` helper; reuse it).

- [ ] **Step 2: Wire it in.** READ `BookingOptionCard.tsx` + `BookingWidget.tsx`. Render `<OptionSelector />` at the TOP of the option card (above participants/date), so the customer picks the option first. Replace the hardcoded "1 option available" label (`BookingOptionCard.tsx` ~L96) with a dynamic count: when `options.length > 1` show e.g. `{n} options` (or the selected option's name); when 1, keep the existing single-option label.

- [ ] **Step 3: i18n** — add any new UI strings ("{count} options", "fits up to {n}", a header like "Choose your option") to the `fr` locale in `messages.ts` with real French. Do NOT translate option names / DB content.

- [ ] **Step 4: Green gate** — `npm run typecheck && npm run lint && npx vitest run` all green (report real numbers). Reason through: a 2-option per-person activity shows two cards, selecting Full Day shows €360 and reloads that option's dates; a 1-option activity shows no picker and is visually unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/components/gyg/detail/OptionSelector.tsx src/components/gyg/detail/BookingOptionCard.tsx src/components/gyg/detail/BookingWidget.tsx src/lib/i18n/messages.ts
git commit -m "feat(booking): GYG-style option selector cards on the activity page"
```

---

## Self-review (author)

**Spec coverage:** selectable cards (T3) ✓; only when 2+ options (T3 Step 1) ✓; default = current auto-pick (T2 Step 1 via `defaultOptionId`) ✓; pricing follows selection (T2 Step 2) ✓; availability follows selection (T2 Step 3) ✓; checkout threading unchanged (uses existing `bookingOptionId`/`priceLabel`) ✓; one option per booking (no mixing) ✓.

**Type consistency:** `selectedOptionId: string | null`, `setSelectedOption(id: string)`, `selectedOption: TourOption | null`, `selectedTier` via `cheapestTier`. Helpers in `@/lib/catalogue/options`. `optionCardSummary(option, mode, type)` signature matches its use in T3.

**Verify-at-execution-time:** the exact `TourOption`/tier field names (T1 — read `tours.ts`); the selected-state Tailwind classes + the EUR formatter (T3 — read the existing components); that no test hardcodes the old global-`cheapest` cross-option behaviour for a MULTI-option fixture (T2 — if one exists, the default now reproduces it; confirm).
