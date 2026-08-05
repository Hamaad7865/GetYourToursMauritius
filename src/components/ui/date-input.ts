/**
 * Utilities every native `<input type="date">` / `type="time"` needs, and the wrapper class their
 * grid/flex parent needs with them.
 *
 * Two iOS Safari behaviours break these controls, and both were visible on the live site — the
 * enquiry form's "Preferred date" and the transfer widget's "Arrival date / Arrival time" rendered
 * as grey slabs, the left one sliding underneath the right one:
 *
 *  1. They carry a WIDE intrinsic width (the platform's own date UI). A grid/flex item defaults to
 *     `min-width: auto`, which refuses to shrink below that, so `w-full` cannot stop it overflowing
 *     its column — hence `min-w-0` on BOTH the input and its wrapper ({@link DATE_FIELD_WRAPPER}).
 *  2. They ignore the page's styling and paint the native grey face unless `appearance` is cleared,
 *     and they centre their value; `bg-white` + the `::-webkit-date-and-time-value` rules put them
 *     back in line with every other field on the form. The min-height keeps an EMPTY control the
 *     same height as a filled one (iOS collapses it otherwise).
 *
 * Append to the field's own class string; it only adds, never restyles the border/padding.
 */
export const DATE_TIME_INPUT =
  'min-w-0 appearance-none bg-white [&::-webkit-date-and-time-value]:min-h-[1.25rem] [&::-webkit-date-and-time-value]:text-left';

/** The grid/flex item that holds a {@link DATE_TIME_INPUT}. Without it the track itself is forced
 *  wide by the input's intrinsic size and the fix above has nothing to shrink into. */
export const DATE_FIELD_WRAPPER = 'min-w-0';
