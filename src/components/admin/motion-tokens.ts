import type { Transition } from 'framer-motion';

/* The back office's motion, ported from EasyUI (easyui.site, MIT, src/lib/motion-tokens.ts).
 *
 * Soft, physical, immediate: near-critical damping so nothing wobbles, settling in 200–450ms. Every
 * moving piece reads `useReducedMotion()` and swaps these for INSTANT when the visitor asked the OS for
 * less motion, so a pill still lands where it should, it just does not travel. */

export const spring = {
  /** Tabs, accordions, dialogs fading: ~400ms, no overshoot. */
  gentle: { type: 'spring', stiffness: 170, damping: 26, mass: 0.9 } as Transition,
  /** Buttons, switches, hover indicators: ~200ms with the slightest settle. */
  snappy: { type: 'spring', stiffness: 380, damping: 30, mass: 0.5 } as Transition,
  /** A shared-layout indicator gliding between items (tabs, segmented, the section rail). */
  morph: { type: 'spring', stiffness: 220, damping: 32, mass: 1 } as Transition,
  /** A panel or menu arriving: a tiny overshoot, then still. */
  responsive: { type: 'spring', stiffness: 320, damping: 24, mass: 0.7 } as Transition,
  /** Rolling digits in a chip or a count. */
  roll: { type: 'spring', stiffness: 520, damping: 36, mass: 0.6 } as Transition,
};

export const INSTANT: Transition = { duration: 0 };
