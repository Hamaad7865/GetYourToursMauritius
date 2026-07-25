/**
 * Progress model for the wait between "Pay" and a usable card form.
 *
 * That wait is long (measured 2026-07-25: our own stack is ~0.3s, but Peach's create-checkout has a
 * median of ~0.84s with roughly 1 call in 12 taking 5-10s) and it SPANS A FULL-DOCUMENT NAVIGATION —
 * the checkout page hands off to /bookings/{ref}/pay, which tears the React tree down. A component
 * that lived on either side alone would show the customer two unrelated spinners, one of which
 * restarts at zero, so the handoff below carries the position across in sessionStorage.
 *
 * HONESTY RULES — the percentage is driven by real milestones, never invented:
 *  - each stage owns a fixed band, and only an actual milestone advances to the next band;
 *  - within a band the value eases ASYMPTOTICALLY toward that band's ceiling, so a 10-second Peach
 *    call keeps visibly moving without ever claiming progress it hasn't made;
 *  - it never moves backwards, and it only reaches 100% when the card form has actually rendered.
 * The result is a truthful "how far through the known steps are we", not a fabricated ETA.
 */
export type PayStage = 'booking' | 'session' | 'form';

interface StageSpec {
  /** Percentage this stage starts at. */
  from: number;
  /** Ceiling it eases toward but never reaches until the next stage begins. */
  to: number;
  /**
   * Easing time-constant (ms) — how quickly it approaches the ceiling. Set from the MEASURED typical
   * duration of the stage, so a normal run tracks reality and a slow one decelerates instead of
   * stalling on a number.
   */
  tau: number;
}

/**
 * Bands sized by measured share of the wait. `session` gets the widest because it owns the Peach
 * create-checkout call — the one leg with a heavy tail.
 */
const STAGES: Record<PayStage, StageSpec> = {
  booking: { from: 0, to: 20, tau: 600 },
  session: { from: 20, to: 65, tau: 2600 },
  form: { from: 65, to: 99, tau: 1800 },
};

/** A customer who lands on the pay page directly (email link, new tab) never ran the earlier stages,
 *  so the form stage owns the whole bar rather than resuming at someone else's 65%. */
const FORM_ONLY: StageSpec = { from: 0, to: 99, tau: 1800 };

/**
 * Where the bar stands the instant the checkout session exists and we navigate to the pay page.
 * Taken from the band boundary rather than read off the live animation: at that moment the session
 * stage is genuinely COMPLETE, so its ceiling is the honest value to carry across.
 */
export const SESSION_COMPLETE_PERCENT = STAGES.session.to;

export function stageSpec(stage: PayStage, resumed: boolean): StageSpec {
  if (stage === 'form' && !resumed) return FORM_ONLY;
  return STAGES[stage];
}

/**
 * Kept strictly below the band ceiling. The exponential approaches it asymptotically, but at large
 * elapsed times it rounds to exactly the ceiling in floating point — and a stage sitting ON its
 * ceiling reads as "this step finished", which is the one thing an unfinished step must not claim.
 * Most importantly it keeps the form stage off 100%, which is reserved for a card form that is
 * genuinely on screen.
 */
const CEILING_EPSILON = 0.01;

/**
 * Percentage for a stage after `elapsed` ms, easing toward (never reaching) the ceiling.
 * `floor` clamps the result so the bar can never move backwards across a stage change.
 */
export function percentFor(spec: StageSpec, elapsed: number, floor = 0): number {
  const eased =
    spec.from + (spec.to - spec.from) * (1 - Math.exp(-Math.max(0, elapsed) / spec.tau));
  return Math.max(floor, Math.min(spec.to - CEILING_EPSILON, eased));
}

/** sessionStorage (not local): this is one payment attempt in one tab, and it must not outlive it. */
const HANDOFF_KEY = 'gytm:pay-progress';

export interface PayHandoff {
  /** Where the bar had reached when the checkout page navigated away. */
  percent: number;
  /** Wall-clock stamp, so a stale hand-off (customer wandered off and came back) is ignored. */
  at: number;
}

/** Beyond this the hand-off is treated as stale — a fresh page load starts its own progress. */
const HANDOFF_MAX_AGE_MS = 60_000;

/** Record where the bar had reached, immediately before a navigation tears this page down. */
export function savePayHandoff(percent: number, now: number): void {
  try {
    const payload: PayHandoff = { percent, at: now };
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    // sessionStorage unavailable (private mode / blocked) — the pay page just starts from zero.
  }
}

/**
 * Read the hand-off. Returns null when absent, unparseable or stale.
 *
 * Deliberately NON-destructive. Reading-and-deleting looks tidier but breaks under React StrictMode
 * (on by default here), which mounts, unmounts and remounts in development: the first mount would
 * swallow the value and the real one would resume from zero. The reader clears it once the form is
 * up instead, and `HANDOFF_MAX_AGE_MS` plus the explicit clear at the start of every new attempt
 * bound how long a leftover can matter. A reload while still waiting legitimately resumes.
 */
export function readPayHandoff(now: number): PayHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { percent, at } = parsed as Partial<PayHandoff>;
    if (typeof percent !== 'number' || typeof at !== 'number') return null;
    if (!Number.isFinite(percent) || !Number.isFinite(at)) return null;
    if (now - at > HANDOFF_MAX_AGE_MS || now < at) return null;
    return { percent: Math.max(0, Math.min(99, percent)), at };
  } catch {
    return null;
  }
}

export function clearPayHandoff(): void {
  try {
    window.sessionStorage.removeItem(HANDOFF_KEY);
  } catch {
    // nothing to clear
  }
}
